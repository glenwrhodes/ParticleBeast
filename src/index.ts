/**
 * ParticleBeast — a zero-dependency WebGL2 particle engine.
 *
 * Quick start:
 * ```ts
 * const beast = new ParticleBeast(canvasOrGl);
 * const fx = await beast.loadEffect('presets/explosion.json');
 * beast.spawn(fx, { position: [0, 1, 0], tint: '#ff8833' });
 * // each frame:
 * beast.update(dt);
 * beast.render(viewMatrix, projMatrix);
 * ```
 */

import { EffectDefinition, EffectInstance } from './core/effect';
import { ParticleRenderer, type EmitterDrawCall } from './render/renderer';
import type { TextureLoader } from './render/textures';
import type { EffectJSON, SpawnOptions } from './core/types';

export interface ParticleBeastOptions {
  /** Base URL for resolving relative sprite paths when loading parsed JSON objects */
  basePath?: string;
  /** Custom texture loader */
  textureLoader?: TextureLoader;
  /** Max simulation step in seconds; larger dt is clamped (default 0.1) */
  maxDelta?: number;
}

export class ParticleBeast {
  readonly gl: WebGL2RenderingContext;
  /** True if ParticleBeast created the context itself from a canvas */
  readonly ownsContext: boolean;

  private readonly renderer: ParticleRenderer;
  private readonly instances = new Set<EffectInstance>();
  private readonly basePath: string;
  private readonly maxDelta: number;
  private readonly drawCalls: EmitterDrawCall[] = [];

  constructor(target: HTMLCanvasElement | WebGL2RenderingContext, options: ParticleBeastOptions = {}) {
    if (typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement) {
      const gl = target.getContext('webgl2', { alpha: true, antialias: true, depth: true });
      if (!gl) throw new Error('ParticleBeast: WebGL2 not supported');
      this.gl = gl;
      this.ownsContext = true;
    } else {
      this.gl = target as WebGL2RenderingContext;
      this.ownsContext = false;
    }
    this.renderer = new ParticleRenderer(this.gl, options.textureLoader);
    this.basePath = options.basePath ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/');
    this.maxDelta = options.maxDelta ?? 0.1;
  }

  /** Load an effect from a URL or a parsed JSON object. Pre-warms textures. */
  async loadEffect(src: string | EffectJSON): Promise<EffectDefinition> {
    let json: EffectJSON;
    let base: string;
    if (typeof src === 'string') {
      const url = new URL(src, this.basePath).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ParticleBeast: failed to fetch effect "${src}" (${res.status})`);
      json = (await res.json()) as EffectJSON;
      base = url;
    } else {
      json = src;
      base = this.basePath;
    }
    const def = new EffectDefinition(json, base);
    await Promise.all(def.spriteUrls.filter(Boolean).map((u) => this.renderer.textures.preload(u).catch(() => null)));
    return def;
  }

  /** Compile a parsed JSON effect synchronously (textures stream in as they load). */
  compileEffect(json: EffectJSON): EffectDefinition {
    return new EffectDefinition(json, this.basePath);
  }

  /** Create a playing instance of an effect. */
  spawn(definition: EffectDefinition, opts: SpawnOptions = {}): EffectInstance {
    const inst = new EffectInstance(definition, opts);
    inst.setOwner(this);
    this.instances.add(inst);
    return inst;
  }

  /** Remove an instance and free its GPU buffers. */
  dispose(instance: EffectInstance): void {
    if (!this.instances.has(instance)) return;
    instance.markDisposed();
    for (const r of instance.runtimes) this.renderer.releaseEmitter(r);
    this.instances.delete(instance);
  }

  /** Advance all effect instances. Call once per frame with seconds. */
  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), this.maxDelta);
    for (const inst of this.instances) {
      inst.update(step);
      if (inst.autoDispose && inst.finished) {
        this.dispose(inst);
      }
    }
  }

  /** Render all instances. Pass column-major view and projection matrices. */
  render(view: Float32Array, proj: Float32Array): void {
    const calls = this.drawCalls;
    calls.length = 0;
    for (const inst of this.instances) {
      const def = inst.definition;
      for (let i = 0; i < inst.runtimes.length; i++) {
        calls.push({
          runtime: inst.runtimes[i],
          spriteUrl: def.spriteUrls[i],
          tint: inst.tint,
          hueShift: inst.hueShift,
          scale: inst.getScale(),
        });
      }
    }
    this.renderer.render(calls, view, proj);
  }

  /** Total live particles across all instances. */
  get particleCount(): number {
    let n = 0;
    for (const inst of this.instances) n += inst.particleCount;
    return n;
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  /** Stop and remove every effect instance. */
  clear(): void {
    for (const inst of [...this.instances]) this.dispose(inst);
  }

  /** Free all GL resources. The ParticleBeast must not be used afterwards. */
  destroy(): void {
    this.clear();
    this.renderer.dispose();
  }
}

// ---- Public exports ----
export { EffectDefinition, EffectInstance, parseColor } from './core/effect';
export { ScalarValue, sampleCurveKeys } from './core/value';
export type { ScalarValueJSON, CurveKey } from './core/value';
export { Gradient } from './core/gradient';
export type { GradientJSON, ColorKey, AlphaKey } from './core/gradient';
export { simplex3, curl3 } from './core/noise';
export type {
  EffectJSON, EmitterJSON, EmissionJSON, BurstJSON, ShapeJSON, ModulesJSON,
  RenderJSON, FlipbookJSON, SubEmitterJSON, StartColorJSON, SpawnOptions,
  BlendMode, RenderMode, SimulationSpace, Vec3JSON, ColorJSON,
} from './core/types';
export type { TextureLoader } from './render/textures';
export {
  mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt, mat4Compose,
  mat4InvertTRS, mat4CameraPosition, DEG2RAD,
} from './core/math';
