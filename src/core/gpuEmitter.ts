/**
 * GpuEmitterRuntime: per-instance state for a GPU-simulated emitter.
 *
 * The CPU side only handles emission timing (rate, bursts, rate-over-distance),
 * frame uniforms (matrices, gravity) and an approximate alive count; all
 * per-particle work happens in the transform-feedback update shader
 * (src/render/gpuShaders.ts). Module curves and gradients are baked into a
 * small float LUT texture at construction.
 *
 * Spawning uses a ring buffer over the particle pool: each frame's spawn count
 * claims the next slots, and the shader respawns those slots if they are dead.
 * Size maxParticles comfortably above rate x max lifetime so slots have died
 * by the time the cursor wraps around.
 */

import { DEG2RAD, mat4Identity, mat4Multiply, mat4TransformPoint } from './math';
import { Rng } from './rng';
import { Gradient } from './gradient';
import type { CompiledEmitter, EmitterUpdateContext } from './emitter';
import type { ShapeJSON } from './types';

export { GPU_FLOATS } from '../render/gpuShaders';
import { CURVE_TEX_WIDTH, CURVE_TEX_ROWS } from '../render/gpuShaders';

const GRAVITY = -9.81;
/** "No speed limit" sentinel that still fits in a half-float texture. */
const NO_LIMIT = 65000;

const tmpPos = [0, 0, 0];
const tmpColor = new Float32Array(4);

/** Per-frame data the renderer consumes to run the update pass. */
export interface GpuFrame {
  dt: number;
  spawnStart: number;
  spawnCount: number;
  seed: number;
  reset: boolean;
}

export class GpuEmitterRuntime {
  readonly def: CompiledEmitter;
  private readonly rng: Rng;

  /** World (model) matrix used for rendering local-space particles. */
  readonly modelMatrix = mat4Identity();
  readonly worldMatrix = mat4Identity();
  readonly invRot = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  readonly gravitySim = new Float32Array(3);
  readonly inheritVel = new Float32Array(3);

  // Baked uniform packs
  readonly curveData: Float32Array;
  readonly spawnLife = new Float32Array(4);
  readonly spawnSize = new Float32Array(4);
  readonly spawnRot = new Float32Array(4);
  readonly startColorA = new Float32Array(4);
  readonly startColorB = new Float32Array(4);
  startColorMode = 0;
  shapeType = 0;
  readonly shapeA = new Float32Array(4);
  readonly turb = new Float32Array(4);
  readonly vortexA = new Float32Array(4);
  readonly vortexB = new Float32Array(4);
  readonly attrA = new Float32Array(4);
  readonly attrB = new Float32Array(4);
  readonly orbitA = new Float32Array(4);
  readonly orbitB = new Float32Array(3);

  time = 0;
  emitting = true;

  private readonly lifeMax: number;
  private pendingDt = 0;
  private pendingSpawnStart = 0;
  private pendingSpawnCount = 0;
  private spawnCursor = 0;
  private frameSeed = 0;
  private needsReset = false;

  private emitAccum = 0;
  private distAccum = 0;
  private readonly burstCycle: Int32Array;
  private readonly burstNext: Float32Array;
  private prevWorldX = 0;
  private prevWorldY = 0;
  private prevWorldZ = 0;
  private hasPrevWorld = false;
  private warnedSpawnRequest = false;

  // Approximate alive count via a spawn ledger (count, estimated death time)
  private readonly ledger: { death: number; count: number }[] = [];
  private aliveApprox = 0;

  constructor(def: CompiledEmitter, seed: number) {
    this.def = def;
    this.rng = new Rng(seed);
    this.lifeMax = Math.max(0.01, def.lifetime.maxValue);
    this.burstCycle = new Int32Array(def.bursts.length);
    this.burstNext = new Float32Array(def.bursts.length);
    this.resetBursts();

    // ---- Spawn value ranges (eval(0, r) like the CPU path: min at r=0, max at r=1) ----
    this.spawnLife.set([
      def.lifetime.eval(0, 0), def.lifetime.eval(0, 1),
      def.speed.eval(0, 0), def.speed.eval(0, 1),
    ]);
    this.spawnSize.set([
      def.size.eval(0, 0), def.size.eval(0, 1),
      def.sizeY ? def.sizeY.eval(0, 0) : 0, def.sizeY ? def.sizeY.eval(0, 1) : 0,
    ]);
    this.spawnRot.set([
      def.startRotation.eval(0, 0) * DEG2RAD, def.startRotation.eval(0, 1) * DEG2RAD,
      def.angularVelocity.eval(0, 0) * DEG2RAD, def.angularVelocity.eval(0, 1) * DEG2RAD,
    ]);

    const sc = def.startColor;
    if (Array.isArray(sc)) {
      this.startColorMode = 0;
      this.startColorA.set(sc);
    } else if (sc.type === 'randomColor') {
      this.startColorMode = 1;
      this.startColorA.set(sc.a);
      this.startColorB.set(sc.b);
    } else {
      this.startColorMode = 2;
    }

    this.packShape(def.json.shape);

    // ---- Module uniform packs ----
    this.turb.set([def.turbFrequency, def.turbPositional ? 1 : 0, def.turbStrength ? 1 : 0, 0]);
    this.vortexA.set([def.vortexAxis[0], def.vortexAxis[1], def.vortexAxis[2], def.vortexPull]);
    this.vortexB.set([def.vortexCenter[0], def.vortexCenter[1], def.vortexCenter[2], def.vortexStrength ? 1 : 0]);
    this.attrA.set([def.attractorPos[0], def.attractorPos[1], def.attractorPos[2], def.attractorRadius]);
    this.attrB.set([
      def.attractorKillRadius, def.attractorStrength ? 1 : 0,
      Math.min(Math.max(def.limitDampen, 0), 1), 0,
    ]);
    this.orbitA.set([def.orbitAxis[0], def.orbitAxis[1], def.orbitAxis[2], def.orbitSpeed ? 1 : 0]);
    this.orbitB.set(def.orbitCenter);

    this.curveData = this.bakeCurves();
  }

  /** Bake over-life module curves/gradients into the LUT texture rows. */
  private bakeCurves(): Float32Array {
    const def = this.def;
    const W = CURVE_TEX_WIDTH;
    const data = new Float32Array(W * CURVE_TEX_ROWS * 4);
    const white = new Gradient(undefined);
    const colGrad = def.colorOverLife ?? white;
    const startGrad = def.startColorGradient ?? white;
    for (let i = 0; i < W; i++) {
      const t = i / (W - 1);
      // Over-life curves are baked at the random midpoint (r=0.5); per-particle
      // randomness in over-life modules is not supported on the GPU path.
      colGrad.sample(t, tmpColor, 0);
      data.set(tmpColor, i * 4);
      const r1 = (W + i) * 4;
      data[r1] = def.sizeOverLife ? def.sizeOverLife.eval(t, 0.5) : 1;
      data[r1 + 1] = def.rotationOverLife ? def.rotationOverLife.eval(t, 0.5) * DEG2RAD : 0;
      data[r1 + 2] = def.drag ? def.drag.eval(t, 0.5) : 0;
      data[r1 + 3] = def.limitSpeed ? def.limitSpeed.eval(t, 0.5) : NO_LIMIT;
      const r2 = (W * 2 + i) * 4;
      data[r2] = def.velX ? def.velX.eval(t, 0.5) : 0;
      data[r2 + 1] = def.velY ? def.velY.eval(t, 0.5) : 0;
      data[r2 + 2] = def.velZ ? def.velZ.eval(t, 0.5) : 0;
      data[r2 + 3] = def.turbStrength ? def.turbStrength.eval(t, 0.5) : 0;
      const r3 = (W * 3 + i) * 4;
      data[r3] = def.forceX ? def.forceX.eval(t, 0.5) : 0;
      data[r3 + 1] = def.forceY ? def.forceY.eval(t, 0.5) : 0;
      data[r3 + 2] = def.forceZ ? def.forceZ.eval(t, 0.5) : 0;
      data[r3 + 3] = def.vortexStrength ? def.vortexStrength.eval(t, 0.5) * DEG2RAD : 0;
      const r4 = (W * 4 + i) * 4;
      data[r4] = def.attractorStrength ? def.attractorStrength.eval(t, 0.5) : 0;
      data[r4 + 1] = def.orbitSpeed ? def.orbitSpeed.eval(t, 0.5) * DEG2RAD : 0;
      startGrad.sample(t, tmpColor, 0);
      data.set(tmpColor, (W * 5 + i) * 4);
    }
    return data;
  }

  private packShape(shape: ShapeJSON | undefined): void {
    const s = shape ?? { type: 'point' as const };
    const a = this.shapeA;
    switch (s.type) {
      case 'sphere':
        this.shapeType = 1;
        a.set([s.radius ?? 0.5, s.hemisphere ? 1 : 0, s.shell ? 1 : 0, 0]);
        break;
      case 'cone':
        this.shapeType = 2;
        a.set([(s.angle ?? 25) * DEG2RAD, s.radius ?? 0.2, s.length ?? 1, s.emitFrom === 'volume' ? 1 : 0]);
        break;
      case 'circle':
        this.shapeType = 3;
        a.set([s.radius ?? 0.5, (s.arc ?? 360) * DEG2RAD, s.shell ? 1 : 0, 0]);
        break;
      case 'box': {
        this.shapeType = 4;
        const size = s.size ?? [1, 1, 1];
        a.set([size[0] / 2, size[1] / 2, size[2] / 2, s.emitFrom === 'shell' ? 1 : s.emitFrom === 'edge' ? 2 : 0]);
        break;
      }
      case 'donut':
        this.shapeType = 5;
        a.set([s.radius ?? 1, s.tube ?? 0.2, 0, 0]);
        break;
      case 'edge':
        this.shapeType = 6;
        a.set([(s.length ?? 1) / 2, 0, 0, 0]);
        break;
      default:
        this.shapeType = 0;
    }
  }

  private resetBursts(): void {
    for (let i = 0; i < this.def.bursts.length; i++) {
      this.burstCycle[i] = 0;
      this.burstNext[i] = this.def.bursts[i].time;
    }
  }

  restart(): void {
    this.time = 0;
    this.emitting = true;
    this.emitAccum = 0;
    this.distAccum = 0;
    this.hasPrevWorld = false;
    this.pendingDt = 0;
    this.pendingSpawnCount = 0;
    this.spawnCursor = 0;
    this.ledger.length = 0;
    this.aliveApprox = 0;
    this.needsReset = true;
    this.resetBursts();
  }

  /** Approximate live particle count (GPU state is not read back). */
  get alive(): number {
    return this.aliveApprox;
  }

  /** Only `alive = 0` is meaningful: clears all particles (used by stop(true)). */
  set alive(v: number) {
    if (v === 0) {
      this.ledger.length = 0;
      this.aliveApprox = 0;
      this.pendingSpawnCount = 0;
      this.needsReset = true;
    }
  }

  /** Sub-emitter triggers are not supported on GPU emitters (args ignored). */
  requestSpawn(..._args: number[]): void {
    if (!this.warnedSpawnRequest) {
      this.warnedSpawnRequest = true;
      console.warn(`ParticleBeast: emitter "${this.def.name}" is GPU-simulated and ignores sub-emitter trigger spawns.`);
    }
  }

  get finished(): boolean {
    if (this.aliveApprox > 0) return false;
    if (this.def.looping) return !this.emitting;
    return !this.emitting || this.time >= this.def.delay + this.def.duration;
  }

  update(dt: number, ctx: EmitterUpdateContext): void {
    const def = this.def;

    mat4Multiply(this.worldMatrix, ctx.effectMatrix, def.localMatrix);
    if (def.worldSpace) {
      mat4Identity(this.modelMatrix);
    } else {
      this.modelMatrix.set(this.worldMatrix);
    }
    this.computeInvRot(def.worldSpace);

    // Gravity in sim space
    if (def.gravity !== 0) {
      const g = GRAVITY * def.gravity;
      const r = this.invRot;
      this.gravitySim[0] = r[3] * g;
      this.gravitySim[1] = r[4] * g;
      this.gravitySim[2] = r[5] * g;
    } else {
      this.gravitySim.fill(0);
    }

    if (def.worldSpace && def.inheritVelocity !== 0) {
      this.inheritVel[0] = ctx.velX * def.inheritVelocity;
      this.inheritVel[1] = ctx.velY * def.inheritVelocity;
      this.inheritVel[2] = ctx.velZ * def.inheritVelocity;
    } else {
      this.inheritVel.fill(0);
    }

    let toSpawn = 0;
    if (def.enabled && !def.isSubEmitter && this.emitting) {
      toSpawn = this.updateTimelineEmission(dt);
    } else {
      this.time += dt;
    }

    if (toSpawn > 0) {
      toSpawn = Math.min(toSpawn, def.maxParticles);
      if (this.pendingSpawnCount === 0) this.pendingSpawnStart = this.spawnCursor;
      this.pendingSpawnCount = Math.min(this.pendingSpawnCount + toSpawn, def.maxParticles);
      this.spawnCursor = (this.spawnCursor + toSpawn) % def.maxParticles;
      this.ledger.push({ death: this.time + this.lifeMax, count: toSpawn });
      this.aliveApprox = Math.min(this.aliveApprox + toSpawn, def.maxParticles);
    }

    // Expire the alive ledger
    while (this.ledger.length > 0 && this.ledger[0].death <= this.time) {
      this.aliveApprox = Math.max(0, this.aliveApprox - this.ledger.shift()!.count);
    }

    this.pendingDt += dt;
    this.frameSeed = this.rng.next();
  }

  /** Mirrors EmitterRuntime.updateTimelineEmission; returns the spawn count. */
  private updateTimelineEmission(dt: number): number {
    const def = this.def;
    const rng = this.rng;
    const prevTime = this.time;
    this.time += dt;
    const t0 = prevTime - def.delay;
    const t1 = this.time - def.delay;
    if (t1 <= 0) return 0;

    if (!def.looping && t0 >= def.duration) {
      this.emitting = false;
      return 0;
    }

    const cycleT = def.looping ? t1 % def.duration : Math.min(t1, def.duration);
    const tNorm = cycleT / def.duration;

    const rate = Math.max(0, def.rateOverTime.eval(tNorm, rng.next()));
    this.emitAccum += rate * dt;

    if (def.rateOverDistance > 0) {
      mat4TransformPoint(tmpPos, this.worldMatrix, 0, 0, 0);
      if (this.hasPrevWorld) {
        const dx = tmpPos[0] - this.prevWorldX;
        const dy = tmpPos[1] - this.prevWorldY;
        const dz = tmpPos[2] - this.prevWorldZ;
        this.distAccum += Math.sqrt(dx * dx + dy * dy + dz * dz) * def.rateOverDistance;
      }
      this.prevWorldX = tmpPos[0]; this.prevWorldY = tmpPos[1]; this.prevWorldZ = tmpPos[2];
      this.hasPrevWorld = true;
      this.emitAccum += this.distAccum;
      this.distAccum = 0;
    }

    let toSpawn = Math.floor(this.emitAccum);
    this.emitAccum -= toSpawn;

    for (let i = 0; i < def.bursts.length; i++) {
      const b = def.bursts[i];
      while ((b.cycles === 0 || this.burstCycle[i] < b.cycles) && t1 >= this.burstNext[i]) {
        if (rng.next() <= b.probability) {
          toSpawn += Math.max(0, Math.round(b.count.eval(tNorm, rng.next())));
        }
        this.burstCycle[i]++;
        this.burstNext[i] += b.interval;
      }
    }
    if (def.looping) {
      const cyclesDone0 = Math.floor(t0 / def.duration);
      const cyclesDone1 = Math.floor(t1 / def.duration);
      if (cyclesDone1 > cyclesDone0 && cyclesDone0 >= 0) {
        for (let i = 0; i < def.bursts.length; i++) {
          this.burstCycle[i] = 0;
          this.burstNext[i] = cyclesDone1 * def.duration + def.bursts[i].time;
        }
      }
    }

    if (!def.looping && t1 >= def.duration) {
      this.emitting = false;
    }
    return toSpawn;
  }

  /**
   * Inverse (world -> sim) rotation, stored column-major for direct mat3 upload.
   * The inverse of a rotation+uniform-scale 3x3 is its transpose / scale^2, and
   * the transpose in column-major order is just the world matrix's 3x3 as-is.
   */
  private computeInvRot(worldSpace: boolean): void {
    const r = this.invRot;
    if (worldSpace) {
      r[0] = 1; r[1] = 0; r[2] = 0;
      r[3] = 0; r[4] = 1; r[5] = 0;
      r[6] = 0; r[7] = 0; r[8] = 1;
      return;
    }
    const m = this.worldMatrix;
    const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const inv = s2 > 1e-12 ? 1 / s2 : 1;
    r[0] = m[0] * inv; r[1] = m[1] * inv; r[2] = m[2] * inv;
    r[3] = m[4] * inv; r[4] = m[5] * inv; r[5] = m[6] * inv;
    r[6] = m[8] * inv; r[7] = m[9] * inv; r[8] = m[10] * inv;
  }

  /** Renderer pulls accumulated dt + spawn range, then clears them. */
  consumeFrame(): GpuFrame {
    const frame: GpuFrame = {
      dt: this.pendingDt,
      spawnStart: this.pendingSpawnStart,
      spawnCount: this.pendingSpawnCount,
      seed: this.frameSeed,
      reset: this.needsReset,
    };
    this.pendingDt = 0;
    this.pendingSpawnCount = 0;
    this.needsReset = false;
    return frame;
  }
}
