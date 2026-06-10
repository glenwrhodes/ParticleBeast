/** EffectDefinition (compiled preset) and EffectInstance (a playing copy in the world). */

import { CompiledEmitter, EmitterRuntime, type EmitterUpdateContext } from './emitter';
import { DEG2RAD, mat4Compose } from './math';
import { autoSeed, Rng } from './rng';
import type { ColorJSON, EffectJSON, SpawnOptions, Vec3JSON } from './types';

export class EffectDefinition {
  readonly json: EffectJSON;
  readonly name: string;
  readonly emitters: CompiledEmitter[];
  /** Resolved absolute sprite URLs, parallel to emitters */
  readonly spriteUrls: string[];

  constructor(json: EffectJSON, baseUrl: string) {
    if (!json || !Array.isArray(json.emitters)) {
      throw new Error('ParticleBeast: invalid effect JSON');
    }
    this.json = json;
    this.name = json.name ?? 'effect';
    const names = json.emitters.map((e) => e.name);
    this.emitters = json.emitters.map((e) => new CompiledEmitter(e, names));
    this.spriteUrls = this.emitters.map((e) => (e.sprite ? new URL(e.sprite, baseUrl).href : ''));
  }
}

export function parseColor(c: string | ColorJSON | undefined): Float32Array {
  const out = new Float32Array([1, 1, 1, 1]);
  if (!c) return out;
  if (Array.isArray(c)) {
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3] ?? 1;
    return out;
  }
  let hex = c.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
  if (hex.length >= 6) {
    out[0] = parseInt(hex.slice(0, 2), 16) / 255;
    out[1] = parseInt(hex.slice(2, 4), 16) / 255;
    out[2] = parseInt(hex.slice(4, 6), 16) / 255;
    if (hex.length === 8) out[3] = parseInt(hex.slice(6, 8), 16) / 255;
  }
  return out;
}

export class EffectInstance {
  readonly definition: EffectDefinition;
  readonly runtimes: EmitterRuntime[];
  readonly tint: Float32Array;
  hueShift = 0; // radians
  autoDispose: boolean;
  playbackSpeed = 1;

  private readonly position: Vec3JSON;
  private readonly rotation: Vec3JSON;
  private scale: number;
  private readonly effectMatrix = new Float32Array(16);
  private prevX: number;
  private prevY: number;
  private prevZ: number;
  private hasPrev = false;
  private paused = false;
  private disposed = false;
  private readonly ctx: EmitterUpdateContext;

  constructor(definition: EffectDefinition, opts: SpawnOptions = {}) {
    this.definition = definition;
    this.position = [...(opts.position ?? [0, 0, 0])] as Vec3JSON;
    this.rotation = [...(opts.rotation ?? [0, 0, 0])] as Vec3JSON;
    this.scale = opts.scale ?? 1;
    this.tint = parseColor(opts.tint);
    this.hueShift = (opts.hueShift ?? 0) * DEG2RAD;
    this.autoDispose = opts.autoDispose !== false;
    this.prevX = this.position[0];
    this.prevY = this.position[1];
    this.prevZ = this.position[2];

    const baseSeed = opts.seed ?? autoSeed();
    const seedRng = new Rng(baseSeed);
    this.runtimes = definition.emitters.map((e) => new EmitterRuntime(e, (seedRng.next() * 0xffffffff) >>> 0));

    this.ctx = {
      effectMatrix: this.effectMatrix,
      effectScale: this.scale,
      velX: 0,
      velY: 0,
      velZ: 0,
      onTrigger: (sub, wx, wy, wz, vx, vy, vz) => {
        if (sub.targetIndex < 0 || sub.targetIndex >= this.runtimes.length) return;
        this.runtimes[sub.targetIndex].requestSpawn(sub.count, wx, wy, wz, vx, vy, vz);
      },
    };
    this.updateMatrix();
  }

  private updateMatrix(): void {
    mat4Compose(this.effectMatrix, this.position, this.rotation, this.scale);
  }

  setPosition(x: number, y: number, z: number): void {
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
    this.updateMatrix();
  }

  getPosition(): Vec3JSON {
    return [...this.position] as Vec3JSON;
  }

  setRotation(xDeg: number, yDeg: number, zDeg: number): void {
    this.rotation[0] = xDeg;
    this.rotation[1] = yDeg;
    this.rotation[2] = zDeg;
    this.updateMatrix();
  }

  setScale(s: number): void {
    this.scale = s;
    this.ctx.effectScale = s;
    this.updateMatrix();
  }

  getScale(): number {
    return this.scale;
  }

  setTint(color: string | ColorJSON): void {
    this.tint.set(parseColor(color));
  }

  setHueShift(degrees: number): void {
    this.hueShift = degrees * DEG2RAD;
  }

  pause(): void {
    this.paused = true;
  }

  play(): void {
    this.paused = false;
  }

  /** Stop emitting; existing particles finish their lives. Pass true to also clear them. */
  stop(clear = false): void {
    for (const r of this.runtimes) {
      r.emitting = false;
      if (clear) r.alive = 0;
    }
  }

  restart(): void {
    for (const r of this.runtimes) r.restart();
    this.hasPrev = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** All emitters done emitting and no particles alive. Looping effects never finish unless stopped. */
  get finished(): boolean {
    return this.runtimes.every((r) => r.finished);
  }

  get particleCount(): number {
    let n = 0;
    for (const r of this.runtimes) n += r.alive;
    return n;
  }

  private owner: { dispose(i: EffectInstance): void } | null = null;

  /** @internal */
  setOwner(owner: { dispose(i: EffectInstance): void }): void {
    this.owner = owner;
  }

  /** Remove this instance from its ParticleBeast and free its GPU buffers. */
  dispose(): void {
    this.owner?.dispose(this);
  }

  /** @internal */
  markDisposed(): void {
    this.disposed = true;
  }

  /** @internal */
  update(dt: number): void {
    if (this.paused || this.disposed) return;
    const step = dt * this.playbackSpeed;
    if (step <= 0) return;

    // Effect velocity from movement since last frame (for inherit velocity)
    if (this.hasPrev && dt > 0) {
      this.ctx.velX = (this.position[0] - this.prevX) / dt;
      this.ctx.velY = (this.position[1] - this.prevY) / dt;
      this.ctx.velZ = (this.position[2] - this.prevZ) / dt;
    }
    this.prevX = this.position[0];
    this.prevY = this.position[1];
    this.prevZ = this.position[2];
    this.hasPrev = true;

    for (const r of this.runtimes) {
      r.update(step, this.ctx);
    }
  }
}
