/**
 * ParticleBeast three.js addon.
 *
 * Wraps the core engine so effects live in your three.js scene graph:
 * each spawned effect is an `Object3D` you can add to the scene, parent to
 * meshes, move, rotate and scale — particles follow automatically (including
 * inherit-velocity and rate-over-distance for moving emitters).
 *
 * ```ts
 * import { ParticleBeastThree } from 'particle-beast/three';
 *
 * const particles = new ParticleBeastThree(renderer);   // your THREE.WebGLRenderer
 * const explosion = await particles.loadEffect('presets/explosion.json');
 *
 * const fx = particles.spawn(explosion, { parent: scene, tint: '#ff8833' });
 * fx.position.set(0, 1, 0);          // it's a regular Object3D
 *
 * // each frame:
 * particles.update(dt);
 * renderer.render(scene, camera);
 * particles.render(camera);          // draws into the same canvas + depth buffer
 * ```
 *
 * The engine renders with raw WebGL2 into the renderer's context and restores
 * every piece of GL state it touches, so it composes with three.js without
 * `resetState()` calls.
 */

import { Matrix4, Object3D, type Camera, type WebGLRenderer } from 'three';
import { ParticleBeast, type ParticleBeastOptions } from '../index';
import type { EffectDefinition, EffectInstance } from '../core/effect';
import type { ColorJSON, EffectJSON, SpawnOptions } from '../core/types';
import { DEG2RAD } from '../core/math';

export interface ThreeSpawnOptions extends SpawnOptions {
  /** Object3D to parent the effect under (your scene, or a moving mesh). You can also `add()` it yourself later. */
  parent?: Object3D;
}

/**
 * A playing particle effect that lives in the three.js scene graph.
 * Move/rotate/scale it like any Object3D; the simulation follows its world
 * transform. Exposes the full EffectInstance API (play, stop, tint, …).
 */
export class ParticleEffect extends Object3D {
  /** The underlying core EffectInstance, for anything not proxied here. */
  readonly instance: EffectInstance;
  private readonly system: ParticleBeastThree;

  /** @internal — use {@link ParticleBeastThree.spawn} */
  constructor(instance: EffectInstance, system: ParticleBeastThree) {
    super();
    this.instance = instance;
    this.system = system;
  }

  /** Resume a paused effect. */
  play(): void {
    this.instance.play();
  }

  /** Pause the simulation (particles freeze in place). */
  pause(): void {
    this.instance.pause();
  }

  /** Stop emitting; existing particles finish their lives. Pass true to also clear them. */
  stop(clear = false): void {
    this.instance.stop(clear);
  }

  /** Restart the effect from time zero. */
  restart(): void {
    this.instance.restart();
  }

  /** Recolor all emitters that have `applyTint` (CSS hex or rgba array). */
  setTint(color: string | ColorJSON): void {
    this.instance.setTint(color);
  }

  /** Rotate hues of tinted emitters (degrees). */
  setHueShift(degrees: number): void {
    this.instance.setHueShift(degrees);
  }

  get playbackSpeed(): number {
    return this.instance.playbackSpeed;
  }

  set playbackSpeed(v: number) {
    this.instance.playbackSpeed = v;
  }

  get isPaused(): boolean {
    return this.instance.isPaused;
  }

  /** All emitters done and no particles alive (looping effects never finish unless stopped). */
  get finished(): boolean {
    return this.instance.finished;
  }

  /** Live particles in this effect. */
  get particleCount(): number {
    return this.instance.particleCount;
  }

  /** Remove from the scene and free GPU buffers. The effect must not be used afterwards. */
  dispose(): void {
    this.system.disposeEffect(this);
  }
}

/**
 * The three.js front-end for ParticleBeast. Create one per WebGLRenderer,
 * spawn effects as scene-graph objects, then call `update(dt)` once per frame
 * and `render(camera)` after `renderer.render()`.
 */
export class ParticleBeastThree {
  /** The wrapped core engine (shared textures, renderer, etc.). */
  readonly beast: ParticleBeast;

  private readonly effects = new Set<ParticleEffect>();
  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly invView = new Matrix4();

  constructor(renderer: WebGLRenderer, options: ParticleBeastOptions = {}) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error('ParticleBeast: the three.js addon requires a WebGL2 rendering context');
    }
    this.beast = new ParticleBeast(gl, options);
  }

  /** Load an effect from a URL or a parsed JSON object. Pre-warms textures. */
  loadEffect(src: string | EffectJSON): Promise<EffectDefinition> {
    return this.beast.loadEffect(src);
  }

  /** Compile a parsed JSON effect synchronously (textures stream in as they load). */
  compileEffect(json: EffectJSON): EffectDefinition {
    return this.beast.compileEffect(json);
  }

  /**
   * Create a playing effect as an Object3D. `position` / `rotation` (Euler
   * degrees) / `scale` set the object's local transform; pass `parent` to add
   * it to the scene immediately.
   */
  spawn(definition: EffectDefinition, opts: ThreeSpawnOptions = {}): ParticleEffect {
    const instance = this.beast.spawn(definition, {
      tint: opts.tint,
      hueShift: opts.hueShift,
      seed: opts.seed,
      autoDispose: opts.autoDispose,
    });
    const fx = new ParticleEffect(instance, this);
    fx.name = definition.name;
    if (opts.position) fx.position.set(opts.position[0], opts.position[1], opts.position[2]);
    if (opts.rotation) {
      // Core convention: Euler degrees applied Rz·Ry·Rx — three.js 'ZYX' order
      fx.rotation.set(opts.rotation[0] * DEG2RAD, opts.rotation[1] * DEG2RAD, opts.rotation[2] * DEG2RAD, 'ZYX');
    }
    if (opts.scale !== undefined) fx.scale.setScalar(opts.scale);
    opts.parent?.add(fx);
    this.effects.add(fx);
    fx.updateWorldMatrix(true, false);
    instance.setWorldMatrix(fx.matrixWorld.elements);
    return fx;
  }

  /**
   * Advance all effects. Call once per frame with seconds (e.g. from
   * `THREE.Clock.getDelta()`), before `render()`.
   */
  update(dt: number): void {
    for (const fx of this.effects) {
      fx.updateWorldMatrix(true, false);
      fx.instance.setWorldMatrix(fx.matrixWorld.elements);
    }
    this.beast.update(dt);
    // Prune instances the core auto-disposed (finished one-shots)
    for (const fx of this.effects) {
      if (fx.instance.isDisposed) {
        this.effects.delete(fx);
        fx.removeFromParent();
      }
    }
  }

  /**
   * Draw all particles with the given camera. Call after
   * `renderer.render(scene, camera)` so particles depth-test against the scene.
   */
  render(camera: Camera): void {
    camera.updateWorldMatrix(true, false);
    this.invView.copy(camera.matrixWorld).invert();
    this.view.set(this.invView.elements);
    this.proj.set(camera.projectionMatrix.elements);
    this.beast.render(this.view, this.proj);
  }

  /** Remove an effect and free its GPU buffers (same as `effect.dispose()`). */
  disposeEffect(fx: ParticleEffect): void {
    this.beast.dispose(fx.instance);
    this.effects.delete(fx);
    fx.removeFromParent();
  }

  /** Total live particles across all effects. */
  get particleCount(): number {
    return this.beast.particleCount;
  }

  get effectCount(): number {
    return this.effects.size;
  }

  /** Stop and remove every effect. */
  clear(): void {
    for (const fx of [...this.effects]) this.disposeEffect(fx);
  }

  /** Free all GL resources. The instance must not be used afterwards. */
  destroy(): void {
    this.clear();
    this.beast.destroy();
  }
}

// Re-export the full core API so addon users need a single import.
export * from '../index';
