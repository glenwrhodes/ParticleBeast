/**
 * CompiledEmitter: an EmitterJSON with all value types compiled, ready to simulate.
 * EmitterRuntime: per-instance particle pool + simulation state.
 */

import { DEG2RAD, mat4Compose, mat4Identity, mat4Multiply, mat4TransformDir, mat4TransformPoint, rotateAroundAxis, clamp } from './math';
import { Rng } from './rng';
import { ScalarValue } from './value';
import { Gradient } from './gradient';
import { curl3 } from './noise';
import { compileShape, randomUnit, type ShapeSampler } from './shapes';
import type { BlendMode, EmitterJSON, RenderMode, StartColorJSON } from './types';

export const INSTANCE_FLOATS = 16;
const GRAVITY = -9.81;

interface CompiledBurst {
  time: number;
  count: ScalarValue;
  cycles: number;
  interval: number;
  probability: number;
}

interface CompiledSubEmitter {
  targetName: string;
  targetIndex: number;
  trigger: 'birth' | 'death';
  count: number;
  inheritVelocity: number;
  probability: number;
}

export class CompiledEmitter {
  readonly json: EmitterJSON;
  readonly name: string;
  readonly enabled: boolean;
  /** Simulate on the GPU via transform feedback */
  readonly gpu: boolean;
  readonly isSubEmitter: boolean;
  readonly delay: number;
  readonly duration: number;
  readonly looping: boolean;
  readonly maxParticles: number;
  readonly worldSpace: boolean;
  readonly gravity: number;
  readonly inheritVelocity: number;
  readonly localMatrix: Float32Array;

  readonly rateOverTime: ScalarValue;
  readonly rateOverDistance: number;
  readonly bursts: CompiledBurst[];

  readonly shape: ShapeSampler;
  readonly randomizeDirection: number;

  readonly lifetime: ScalarValue;
  readonly speed: ScalarValue;
  readonly size: ScalarValue;
  readonly sizeY: ScalarValue | null;
  readonly startRotation: ScalarValue;
  readonly angularVelocity: ScalarValue;
  readonly startColor: StartColorJSON;
  readonly startColorGradient: Gradient | null;

  readonly sizeOverLife: ScalarValue | null;
  readonly colorOverLife: Gradient | null;
  readonly rotationOverLife: ScalarValue | null;
  readonly velX: ScalarValue | null;
  readonly velY: ScalarValue | null;
  readonly velZ: ScalarValue | null;
  readonly velWorld: boolean;
  readonly forceX: ScalarValue | null;
  readonly forceY: ScalarValue | null;
  readonly forceZ: ScalarValue | null;
  readonly drag: ScalarValue | null;
  readonly limitSpeed: ScalarValue | null;
  readonly limitDampen: number;
  readonly turbStrength: ScalarValue | null;
  readonly turbFrequency: number;
  readonly turbScroll: number;
  readonly turbPositional: boolean;
  readonly vortexStrength: ScalarValue | null;
  readonly vortexAxis: [number, number, number];
  readonly vortexCenter: [number, number, number];
  readonly vortexPull: number;
  readonly attractorStrength: ScalarValue | null;
  readonly attractorPos: [number, number, number];
  readonly attractorRadius: number;
  readonly attractorKillRadius: number;
  readonly orbitSpeed: ScalarValue | null;
  readonly orbitAxis: [number, number, number];
  readonly orbitCenter: [number, number, number];

  readonly subEmitters: CompiledSubEmitter[];

  readonly sprite: string;
  readonly blend: BlendMode;
  readonly renderMode: RenderMode;
  readonly stretchFactor: number;
  readonly lengthScale: number;
  readonly applyTint: boolean;
  readonly flipbookRows: number;
  readonly flipbookCols: number;
  readonly flipbookRandom: boolean;

  constructor(json: EmitterJSON, emitterNames: string[]) {
    this.json = json;
    this.name = json.name;
    this.enabled = json.enabled !== false;
    this.isSubEmitter = !!json.isSubEmitter;
    this.delay = json.delay ?? 0;
    this.duration = Math.max(0.01, json.duration ?? 5);
    this.looping = json.looping !== false;
    this.maxParticles = Math.max(1, json.maxParticles ?? 1000);
    this.worldSpace = json.simulationSpace === 'world';
    this.gravity = json.gravity ?? 0;
    this.inheritVelocity = json.inheritVelocity ?? 0;
    this.localMatrix = mat4Compose(new Float32Array(16), json.position ?? [0, 0, 0], json.rotation ?? [0, 0, 0], 1);

    const em = json.emission ?? {};
    this.rateOverTime = new ScalarValue(em.rateOverTime, 10);
    this.rateOverDistance = em.rateOverDistance ?? 0;
    this.bursts = (em.bursts ?? []).map((b) => ({
      time: b.time,
      count: new ScalarValue(b.count, 10),
      cycles: b.cycles ?? 1,
      interval: Math.max(0.01, b.interval ?? 1),
      probability: b.probability ?? 1,
    }));

    this.shape = compileShape(json.shape);
    this.randomizeDirection = clamp(json.randomizeDirection ?? 0, 0, 1);

    this.lifetime = new ScalarValue(json.lifetime, 1);
    this.speed = new ScalarValue(json.speed, 1);
    this.size = new ScalarValue(json.size, 0.25);
    this.sizeY = json.sizeY !== undefined ? new ScalarValue(json.sizeY, 0.25) : null;
    this.startRotation = new ScalarValue(json.startRotation, 0);
    this.angularVelocity = new ScalarValue(json.angularVelocity, 0);
    this.startColor = json.startColor ?? [1, 1, 1, 1];
    this.startColorGradient =
      typeof this.startColor === 'object' && !Array.isArray(this.startColor) && this.startColor.type === 'gradient'
        ? new Gradient(this.startColor.gradient)
        : null;

    const m = json.modules ?? {};
    const on = <T extends { enabled?: boolean }>(mod: T | undefined): T | null =>
      mod && mod.enabled !== false ? mod : null;

    const sol = on(m.sizeOverLife);
    this.sizeOverLife = sol ? new ScalarValue(sol.curve, 1) : null;
    const col = on(m.colorOverLife);
    this.colorOverLife = col ? new Gradient(col.gradient) : null;
    const rol = on(m.rotationOverLife);
    this.rotationOverLife = rol ? new ScalarValue(rol.curve, 0) : null;
    const vol = on(m.velocityOverLife);
    this.velX = vol && vol.x !== undefined ? new ScalarValue(vol.x, 0) : null;
    this.velY = vol && vol.y !== undefined ? new ScalarValue(vol.y, 0) : null;
    this.velZ = vol && vol.z !== undefined ? new ScalarValue(vol.z, 0) : null;
    this.velWorld = vol?.space === 'world';
    const fol = on(m.forceOverLife);
    this.forceX = fol && fol.x !== undefined ? new ScalarValue(fol.x, 0) : null;
    this.forceY = fol && fol.y !== undefined ? new ScalarValue(fol.y, 0) : null;
    this.forceZ = fol && fol.z !== undefined ? new ScalarValue(fol.z, 0) : null;
    const drag = on(m.drag);
    this.drag = drag ? new ScalarValue(drag.coefficient, 0) : null;
    const lim = on(m.limitVelocity);
    this.limitSpeed = lim ? new ScalarValue(lim.speed, 1) : null;
    this.limitDampen = lim?.dampen ?? 1;
    const turb = on(m.turbulence);
    this.turbStrength = turb ? new ScalarValue(turb.strength, 1) : null;
    this.turbFrequency = turb?.frequency ?? 1;
    this.turbScroll = turb?.scrollSpeed ?? 0.5;
    this.turbPositional = !!turb?.positional;
    const vort = on(m.vortex);
    this.vortexStrength = vort ? new ScalarValue(vort.strength, 90) : null;
    this.vortexAxis = normalized(vort?.axis ?? [0, 1, 0]);
    this.vortexCenter = vort?.center ?? [0, 0, 0];
    this.vortexPull = vort?.radialPull ?? 0;
    const att = on(m.attractor);
    this.attractorStrength = att ? new ScalarValue(att.strength, 5) : null;
    this.attractorPos = att?.position ?? [0, 0, 0];
    this.attractorRadius = att?.radius ?? 0;
    this.attractorKillRadius = att?.killRadius ?? 0;
    const orb = on(m.orbit);
    this.orbitSpeed = orb ? new ScalarValue(orb.speed, 90) : null;
    this.orbitAxis = normalized(orb?.axis ?? [0, 1, 0]);
    this.orbitCenter = orb?.center ?? [0, 0, 0];

    this.subEmitters = (json.subEmitters ?? []).map((s) => ({
      targetName: s.target,
      targetIndex: emitterNames.indexOf(s.target),
      trigger: s.trigger,
      count: s.count ?? 1,
      inheritVelocity: s.inheritVelocity ?? 0,
      probability: s.probability ?? 1,
    }));

    let gpu = json.simulation === 'gpu';
    if (gpu && (this.isSubEmitter || this.subEmitters.length > 0)) {
      console.warn(`ParticleBeast: emitter "${this.name}" uses sub-emitters, which GPU simulation does not support; falling back to CPU.`);
      gpu = false;
    }
    this.gpu = gpu;

    const r = json.render ?? {};
    this.sprite = r.sprite ?? '';
    this.blend = r.blend ?? 'additive';
    this.renderMode = r.mode ?? 'billboard';
    this.stretchFactor = r.stretchFactor ?? 0.1;
    this.lengthScale = r.lengthScale ?? 1;
    this.applyTint = r.applyTint !== false;
    this.flipbookRows = r.flipbook?.rows ?? 1;
    this.flipbookCols = r.flipbook?.cols ?? 1;
    this.flipbookRandom = r.flipbook?.mode === 'random';
  }
}

function normalized(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Context passed from the EffectInstance each update. */
export interface EmitterUpdateContext {
  effectMatrix: Float32Array;
  effectScale: number;
  /** Effect instance velocity (world units/s) */
  velX: number;
  velY: number;
  velZ: number;
  onTrigger: (
    sub: CompiledSubEmitter,
    worldX: number, worldY: number, worldZ: number,
    velX: number, velY: number, velZ: number
  ) => void;
}

interface SpawnRequest {
  count: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

const tmpPos = [0, 0, 0];
const tmpDir = [0, 0, 0];
const tmpRnd = [0, 0, 0];
const tmpVec = [0, 0, 0];
const tmpColor = new Float32Array(4);
const tmpColor2 = new Float32Array(4);

export class EmitterRuntime {
  readonly def: CompiledEmitter;
  private readonly rng: Rng;

  // SoA particle pool
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly lifeInv: Float32Array;
  private readonly size0: Float32Array;
  private readonly sizeY0: Float32Array;
  private readonly rot: Float32Array;
  private readonly angVel: Float32Array;
  private readonly cr: Float32Array;
  private readonly cg: Float32Array;
  private readonly cb: Float32Array;
  private readonly ca: Float32Array;
  private readonly seed: Float32Array;

  alive = 0;

  /** Interleaved per-instance render data, filled during update. */
  readonly renderData: Float32Array;

  /** World (model) matrix used for rendering local-space particles. */
  readonly modelMatrix = mat4Identity();
  private readonly worldMatrix = mat4Identity();
  private readonly invRot = new Float32Array(9); // world->sim-space rotation

  time = 0;
  emitting = true;
  private emitAccum = 0;
  private distAccum = 0;
  private burstCycle: Int32Array;
  private burstNext: Float32Array;
  private prevWorldX = 0;
  private prevWorldY = 0;
  private prevWorldZ = 0;
  private hasPrevWorld = false;
  private spawnRequests: SpawnRequest[] = [];

  constructor(def: CompiledEmitter, seed: number) {
    this.def = def;
    this.rng = new Rng(seed);
    const n = def.maxParticles;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.lifeInv = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.sizeY0 = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.angVel = new Float32Array(n);
    this.cr = new Float32Array(n); this.cg = new Float32Array(n); this.cb = new Float32Array(n); this.ca = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.renderData = new Float32Array(n * INSTANCE_FLOATS);
    this.burstCycle = new Int32Array(def.bursts.length);
    this.burstNext = new Float32Array(def.bursts.length);
    this.resetBursts();
  }

  private resetBursts(): void {
    for (let i = 0; i < this.def.bursts.length; i++) {
      this.burstCycle[i] = 0;
      this.burstNext[i] = this.def.bursts[i].time;
    }
  }

  restart(): void {
    this.time = 0;
    this.alive = 0;
    this.emitting = true;
    this.emitAccum = 0;
    this.distAccum = 0;
    this.hasPrevWorld = false;
    this.spawnRequests.length = 0;
    this.resetBursts();
  }

  /** Queue particles spawned by a sub-emitter trigger. Position/velocity in world space. */
  requestSpawn(count: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.spawnRequests.push({ count, x, y, z, vx, vy, vz });
  }

  /** True when a non-looping emitter has played through and all particles died. */
  get finished(): boolean {
    if (this.alive > 0) return false;
    if (this.def.isSubEmitter) return this.spawnRequests.length === 0;
    if (this.def.looping) return !this.emitting;
    return !this.emitting || this.time >= this.def.delay + this.def.duration;
  }

  update(dt: number, ctx: EmitterUpdateContext): void {
    const def = this.def;

    // Resolve this emitter's world matrix for the frame
    mat4Multiply(this.worldMatrix, ctx.effectMatrix, def.localMatrix);
    if (def.worldSpace) {
      mat4Identity(this.modelMatrix);
    } else {
      this.modelMatrix.set(this.worldMatrix);
    }
    this.computeInvRot(def.worldSpace);

    // ---- Emission ----
    if (def.enabled) {
      if (!def.isSubEmitter && this.emitting) {
        this.updateTimelineEmission(dt, ctx);
      }
      // Sub-emitter trigger spawns (also allowed on regular emitters)
      if (this.spawnRequests.length > 0) {
        for (const req of this.spawnRequests) {
          this.spawnBatch(req.count, ctx, req);
        }
        this.spawnRequests.length = 0;
      }
    }

    // ---- Simulate ----
    this.simulate(dt, ctx);
  }

  private computeInvRot(worldSpace: boolean): void {
    const r = this.invRot;
    if (worldSpace) {
      r[0] = 1; r[1] = 0; r[2] = 0;
      r[3] = 0; r[4] = 1; r[5] = 0;
      r[6] = 0; r[7] = 0; r[8] = 1;
      return;
    }
    // Inverse rotation of worldMatrix (transpose / scale^2)
    const m = this.worldMatrix;
    const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
    const inv = s2 > 1e-12 ? 1 / s2 : 1;
    r[0] = m[0] * inv; r[1] = m[4] * inv; r[2] = m[8] * inv;
    r[3] = m[1] * inv; r[4] = m[5] * inv; r[5] = m[9] * inv;
    r[6] = m[2] * inv; r[7] = m[6] * inv; r[8] = m[10] * inv;
  }

  private worldDirToSim(x: number, y: number, z: number, out: number[]): void {
    const r = this.invRot;
    out[0] = r[0] * x + r[1] * y + r[2] * z;
    out[1] = r[3] * x + r[4] * y + r[5] * z;
    out[2] = r[6] * x + r[7] * y + r[8] * z;
  }

  private updateTimelineEmission(dt: number, ctx: EmitterUpdateContext): void {
    const def = this.def;
    const prevTime = this.time;
    this.time += dt;
    const t0 = prevTime - def.delay;
    const t1 = this.time - def.delay;
    if (t1 <= 0) return;

    if (!def.looping && t0 >= def.duration) {
      this.emitting = false;
      return;
    }

    const cycleT = def.looping ? t1 % def.duration : Math.min(t1, def.duration);
    const tNorm = cycleT / def.duration;

    // Rate over time
    const rate = Math.max(0, def.rateOverTime.eval(tNorm, this.rng.next()));
    this.emitAccum += rate * dt;

    // Rate over distance (uses emitter world position delta)
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

    // Bursts
    for (let i = 0; i < def.bursts.length; i++) {
      const b = def.bursts[i];
      while (
        (b.cycles === 0 || this.burstCycle[i] < b.cycles) &&
        t1 >= this.burstNext[i]
      ) {
        if (this.rng.next() <= b.probability) {
          toSpawn += Math.max(0, Math.round(b.count.eval(tNorm, this.rng.next())));
        }
        this.burstCycle[i]++;
        this.burstNext[i] += b.interval;
      }
    }
    // Re-arm bursts on loop boundary
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

    if (toSpawn > 0) this.spawnBatch(toSpawn, ctx, null);
  }

  private spawnBatch(count: number, ctx: EmitterUpdateContext, base: SpawnRequest | null): void {
    const def = this.def;
    const rng = this.rng;
    for (let n = 0; n < count; n++) {
      if (this.alive >= def.maxParticles) return;
      const i = this.alive++;
      const r1 = rng.next();

      def.shape(rng, tmpPos, tmpDir);
      if (def.randomizeDirection > 0) {
        randomUnit(rng, tmpRnd);
        const k = def.randomizeDirection;
        tmpDir[0] += (tmpRnd[0] - tmpDir[0]) * k;
        tmpDir[1] += (tmpRnd[1] - tmpDir[1]) * k;
        tmpDir[2] += (tmpRnd[2] - tmpDir[2]) * k;
        const len = Math.sqrt(tmpDir[0] ** 2 + tmpDir[1] ** 2 + tmpDir[2] ** 2) || 1;
        tmpDir[0] /= len; tmpDir[1] /= len; tmpDir[2] /= len;
      }

      const speed = def.speed.eval(0, rng.next());
      let posX: number, posY: number, posZ: number;
      let velX: number, velY: number, velZ: number;

      if (def.worldSpace) {
        // Transform spawn position & direction into world space
        mat4TransformPoint(tmpVec, this.worldMatrix, tmpPos[0], tmpPos[1], tmpPos[2]);
        posX = tmpVec[0]; posY = tmpVec[1]; posZ = tmpVec[2];
        mat4TransformDir(tmpVec, this.worldMatrix, tmpDir[0], tmpDir[1], tmpDir[2]);
        velX = tmpVec[0] * speed; velY = tmpVec[1] * speed; velZ = tmpVec[2] * speed;
        if (def.inheritVelocity !== 0) {
          velX += ctx.velX * def.inheritVelocity;
          velY += ctx.velY * def.inheritVelocity;
          velZ += ctx.velZ * def.inheritVelocity;
        }
      } else {
        posX = tmpPos[0]; posY = tmpPos[1]; posZ = tmpPos[2];
        velX = tmpDir[0] * speed; velY = tmpDir[1] * speed; velZ = tmpDir[2] * speed;
      }

      // Sub-emitter spawn base (world space request -> sim space)
      if (base) {
        if (def.worldSpace) {
          posX += base.x; posY += base.y; posZ += base.z;
          velX += base.vx; velY += base.vy; velZ += base.vz;
        } else {
          // convert world point into this emitter's local frame
          this.worldPointToSim(base.x, base.y, base.z, tmpVec);
          posX += tmpVec[0]; posY += tmpVec[1]; posZ += tmpVec[2];
          this.worldDirToSim(base.vx, base.vy, base.vz, tmpVec);
          velX += tmpVec[0]; velY += tmpVec[1]; velZ += tmpVec[2];
        }
      }

      this.px[i] = posX; this.py[i] = posY; this.pz[i] = posZ;
      this.vx[i] = velX; this.vy[i] = velY; this.vz[i] = velZ;
      this.age[i] = 0;
      const life = Math.max(0.01, def.lifetime.eval(0, rng.next()));
      this.lifeInv[i] = 1 / life;
      this.size0[i] = def.size.eval(0, rng.next());
      this.sizeY0[i] = def.sizeY ? def.sizeY.eval(0, rng.next()) : this.size0[i];
      this.rot[i] = def.startRotation.eval(0, rng.next()) * DEG2RAD;
      this.angVel[i] = def.angularVelocity.eval(0, rng.next()) * DEG2RAD;
      this.seed[i] = r1;

      // Start color
      const sc = def.startColor;
      if (Array.isArray(sc)) {
        this.cr[i] = sc[0]; this.cg[i] = sc[1]; this.cb[i] = sc[2]; this.ca[i] = sc[3];
      } else if (sc.type === 'randomColor') {
        const t = rng.next();
        this.cr[i] = sc.a[0] + (sc.b[0] - sc.a[0]) * t;
        this.cg[i] = sc.a[1] + (sc.b[1] - sc.a[1]) * t;
        this.cb[i] = sc.a[2] + (sc.b[2] - sc.a[2]) * t;
        this.ca[i] = sc.a[3] + (sc.b[3] - sc.a[3]) * t;
      } else {
        def.startColorGradient!.sample(rng.next(), tmpColor, 0);
        this.cr[i] = tmpColor[0]; this.cg[i] = tmpColor[1]; this.cb[i] = tmpColor[2]; this.ca[i] = tmpColor[3];
      }

      // Birth triggers
      for (const sub of def.subEmitters) {
        if (sub.trigger === 'birth' && (sub.probability >= 1 || rng.next() <= sub.probability)) {
          this.emitTrigger(sub, i, ctx);
        }
      }
    }
  }

  private worldPointToSim(x: number, y: number, z: number, out: number[]): void {
    const m = this.worldMatrix;
    const dx = x - m[12], dy = y - m[13], dz = z - m[14];
    this.worldDirToSim(dx, dy, dz, out);
  }

  private emitTrigger(sub: CompiledSubEmitter, i: number, ctx: EmitterUpdateContext): void {
    // Particle position/velocity in world space
    let wx: number, wy: number, wz: number, wvx: number, wvy: number, wvz: number;
    if (this.def.worldSpace) {
      wx = this.px[i]; wy = this.py[i]; wz = this.pz[i];
      wvx = this.vx[i]; wvy = this.vy[i]; wvz = this.vz[i];
    } else {
      mat4TransformPoint(tmpVec, this.worldMatrix, this.px[i], this.py[i], this.pz[i]);
      wx = tmpVec[0]; wy = tmpVec[1]; wz = tmpVec[2];
      mat4TransformDir(tmpVec, this.worldMatrix, this.vx[i], this.vy[i], this.vz[i]);
      wvx = tmpVec[0]; wvy = tmpVec[1]; wvz = tmpVec[2];
    }
    ctx.onTrigger(sub, wx, wy, wz, wvx * sub.inheritVelocity, wvy * sub.inheritVelocity, wvz * sub.inheritVelocity);
  }

  private simulate(dt: number, ctx: EmitterUpdateContext): void {
    const def = this.def;
    const rd = this.renderData;
    const noiseT = this.time * def.turbScroll;

    // Gravity in sim space
    let gX = 0, gY = 0, gZ = 0;
    if (def.gravity !== 0) {
      this.worldDirToSim(0, GRAVITY * def.gravity, 0, tmpVec);
      gX = tmpVec[0]; gY = tmpVec[1]; gZ = tmpVec[2];
    }

    let i = 0;
    while (i < this.alive) {
      this.age[i] += dt;
      const t = this.age[i] * this.lifeInv[i];
      let killed = false;

      if (t >= 1) {
        killed = true;
      } else {
        const seed = this.seed[i];
        let fx = gX, fy = gY, fz = gZ;

        if (def.forceX || def.forceY || def.forceZ) {
          if (def.forceX) fx += def.forceX.eval(t, seed);
          if (def.forceY) fy += def.forceY.eval(t, seed);
          if (def.forceZ) fz += def.forceZ.eval(t, seed);
        }

        if (def.turbStrength) {
          const s = def.turbStrength.eval(t, seed);
          const f = def.turbFrequency;
          curl3(this.px[i] * f, this.py[i] * f, this.pz[i] * f, noiseT, tmpRnd);
          if (def.turbPositional) {
            this.px[i] += tmpRnd[0] * s * dt;
            this.py[i] += tmpRnd[1] * s * dt;
            this.pz[i] += tmpRnd[2] * s * dt;
          } else {
            fx += tmpRnd[0] * s;
            fy += tmpRnd[1] * s;
            fz += tmpRnd[2] * s;
          }
        }

        if (def.attractorStrength) {
          const dx = def.attractorPos[0] - this.px[i];
          const dy = def.attractorPos[1] - this.py[i];
          const dz = def.attractorPos[2] - this.pz[i];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (def.attractorKillRadius > 0 && d < def.attractorKillRadius) {
            killed = true;
          } else if (d > 1e-5) {
            let s = def.attractorStrength.eval(t, seed);
            if (def.attractorRadius > 0) s *= Math.max(0, 1 - d / def.attractorRadius);
            fx += (dx / d) * s;
            fy += (dy / d) * s;
            fz += (dz / d) * s;
          }
        }

        if (!killed) {
          if (def.vortexPull !== 0 && def.vortexStrength) {
            // radial pull toward vortex axis
            const cx = this.px[i] - def.vortexCenter[0];
            const cy = this.py[i] - def.vortexCenter[1];
            const cz = this.pz[i] - def.vortexCenter[2];
            const ax = def.vortexAxis[0], ay = def.vortexAxis[1], az = def.vortexAxis[2];
            const along = cx * ax + cy * ay + cz * az;
            const rx = cx - ax * along, ry = cy - ay * along, rz = cz - az * along;
            const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
            if (rl > 1e-5) {
              const p = def.vortexPull / rl;
              fx -= rx * p; fy -= ry * p; fz -= rz * p;
            }
          }

          this.vx[i] += fx * dt;
          this.vy[i] += fy * dt;
          this.vz[i] += fz * dt;

          if (def.drag) {
            const d = Math.max(0, 1 - def.drag.eval(t, seed) * dt);
            this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
          }

          if (def.limitSpeed) {
            const max = def.limitSpeed.eval(t, seed);
            const sp = Math.sqrt(this.vx[i] ** 2 + this.vy[i] ** 2 + this.vz[i] ** 2);
            if (sp > max && sp > 1e-6) {
              const k = 1 - (1 - max / sp) * clamp(def.limitDampen, 0, 1);
              this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
            }
          }

          let mvx = this.vx[i], mvy = this.vy[i], mvz = this.vz[i];
          if (def.velX || def.velY || def.velZ) {
            let ax = def.velX ? def.velX.eval(t, seed) : 0;
            let ay = def.velY ? def.velY.eval(t, seed) : 0;
            let az = def.velZ ? def.velZ.eval(t, seed) : 0;
            if (def.velWorld && !def.worldSpace) {
              this.worldDirToSim(ax, ay, az, tmpVec);
              ax = tmpVec[0]; ay = tmpVec[1]; az = tmpVec[2];
            }
            mvx += ax; mvy += ay; mvz += az;
          }

          this.px[i] += mvx * dt;
          this.py[i] += mvy * dt;
          this.pz[i] += mvz * dt;

          // Vortex / orbital rotation around an axis
          if (def.vortexStrength) {
            const ang = def.vortexStrength.eval(t, seed) * DEG2RAD * dt;
            this.rotateAround(i, def.vortexCenter, def.vortexAxis, ang, true);
          }
          if (def.orbitSpeed) {
            const ang = def.orbitSpeed.eval(t, seed) * DEG2RAD * dt;
            this.rotateAround(i, def.orbitCenter, def.orbitAxis, ang, true);
          }

          let av = this.angVel[i];
          if (def.rotationOverLife) av += def.rotationOverLife.eval(t, seed) * DEG2RAD;
          this.rot[i] += av * dt;
        }
      }

      if (killed) {
        // Death triggers
        for (const sub of def.subEmitters) {
          if (sub.trigger === 'death' && (sub.probability >= 1 || this.rng.next() <= sub.probability)) {
            this.emitTrigger(sub, i, ctx);
          }
        }
        this.killAt(i);
        continue; // re-process swapped-in particle
      }

      // ---- Fill render data ----
      const o = i * INSTANCE_FLOATS;
      const t2 = this.age[i] * this.lifeInv[i];
      const seed = this.seed[i];
      let sx = this.size0[i];
      let sy = this.sizeY0[i];
      if (def.sizeOverLife) {
        const m = def.sizeOverLife.eval(t2, seed);
        sx *= m; sy *= m;
      }
      rd[o] = this.px[i];
      rd[o + 1] = this.py[i];
      rd[o + 2] = this.pz[i];
      rd[o + 3] = sx;
      rd[o + 4] = sy;
      rd[o + 5] = this.rot[i];
      if (def.colorOverLife) {
        def.colorOverLife.sample(t2, tmpColor2, 0);
        rd[o + 6] = this.cr[i] * tmpColor2[0];
        rd[o + 7] = this.cg[i] * tmpColor2[1];
        rd[o + 8] = this.cb[i] * tmpColor2[2];
        rd[o + 9] = this.ca[i] * tmpColor2[3];
      } else {
        rd[o + 6] = this.cr[i];
        rd[o + 7] = this.cg[i];
        rd[o + 8] = this.cb[i];
        rd[o + 9] = this.ca[i];
      }
      rd[o + 10] = this.vx[i];
      rd[o + 11] = this.vy[i];
      rd[o + 12] = this.vz[i];
      rd[o + 13] = t2;
      rd[o + 14] = seed;
      rd[o + 15] = 0;

      i++;
    }
  }

  private rotateAround(
    i: number,
    center: [number, number, number],
    axis: [number, number, number],
    angle: number,
    rotateVelocity: boolean
  ): void {
    const ox = this.px[i] - center[0];
    const oy = this.py[i] - center[1];
    const oz = this.pz[i] - center[2];
    rotateAroundAxis(tmpVec, ox, oy, oz, axis[0], axis[1], axis[2], angle);
    this.px[i] = tmpVec[0] + center[0];
    this.py[i] = tmpVec[1] + center[1];
    this.pz[i] = tmpVec[2] + center[2];
    if (rotateVelocity) {
      rotateAroundAxis(tmpVec, this.vx[i], this.vy[i], this.vz[i], axis[0], axis[1], axis[2], angle);
      this.vx[i] = tmpVec[0];
      this.vy[i] = tmpVec[1];
      this.vz[i] = tmpVec[2];
    }
  }

  private killAt(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.age[i] = this.age[last];
    this.lifeInv[i] = this.lifeInv[last];
    this.size0[i] = this.size0[last];
    this.sizeY0[i] = this.sizeY0[last];
    this.rot[i] = this.rot[last];
    this.angVel[i] = this.angVel[last];
    this.cr[i] = this.cr[last]; this.cg[i] = this.cg[last]; this.cb[i] = this.cb[last]; this.ca[i] = this.ca[last];
    this.seed[i] = this.seed[last];
  }
}