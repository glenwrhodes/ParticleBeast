/**
 * The JSON preset schema. Everything the editor saves and `loadEffect()` consumes.
 * All fields with defaults are optional so hand-written presets stay terse.
 */

import type { ScalarValueJSON } from './value';
import type { GradientJSON } from './gradient';

export type Vec3JSON = [number, number, number];
export type ColorJSON = [number, number, number, number];

export type BlendMode = 'additive' | 'alpha' | 'multiply';
export type RenderMode = 'billboard' | 'stretched' | 'horizontal' | 'vertical';
export type SimulationSpace = 'local' | 'world';

export interface EffectJSON {
  version: 1;
  name: string;
  /** Hint for players/editors: does the effect loop by design? */
  looping?: boolean;
  emitters: EmitterJSON[];
}

export interface BurstJSON {
  /** Time within emitter duration, seconds */
  time: number;
  count: ScalarValueJSON;
  /** 0 = infinite cycles while looping */
  cycles?: number;
  /** Seconds between cycles */
  interval?: number;
  /** 0..1 */
  probability?: number;
}

export interface EmissionJSON {
  rateOverTime?: ScalarValueJSON;
  rateOverDistance?: number;
  bursts?: BurstJSON[];
}

export type ShapeJSON =
  | { type: 'point' }
  | { type: 'sphere'; radius?: number; hemisphere?: boolean; shell?: boolean }
  | { type: 'cone'; angle?: number; radius?: number; length?: number; emitFrom?: 'base' | 'volume' }
  | { type: 'circle'; radius?: number; arc?: number; shell?: boolean }
  | { type: 'box'; size?: Vec3JSON; emitFrom?: 'volume' | 'shell' | 'edge' }
  | { type: 'donut'; radius?: number; tube?: number }
  | { type: 'edge'; length?: number };

export type StartColorJSON =
  | ColorJSON
  | { type: 'randomColor'; a: ColorJSON; b: ColorJSON }
  | { type: 'gradient'; gradient: GradientJSON };

export interface SubEmitterJSON {
  /** Name of another emitter in this effect, which must have `isSubEmitter: true` */
  target: string;
  trigger: 'birth' | 'death';
  /** Particles spawned per trigger event */
  count?: number;
  /** Fraction of parent particle velocity inherited */
  inheritVelocity?: number;
  /** 0..1 chance per event */
  probability?: number;
}

export interface ModulesJSON {
  sizeOverLife?: { enabled?: boolean; curve: ScalarValueJSON };
  colorOverLife?: { enabled?: boolean; gradient: GradientJSON };
  /** Angular velocity (deg/s) over life, added to start angular velocity */
  rotationOverLife?: { enabled?: boolean; curve: ScalarValueJSON };
  /** Additive velocity (units/s) evaluated over life */
  velocityOverLife?: { enabled?: boolean; x?: ScalarValueJSON; y?: ScalarValueJSON; z?: ScalarValueJSON; space?: SimulationSpace };
  /** Acceleration (units/s^2) over life */
  forceOverLife?: { enabled?: boolean; x?: ScalarValueJSON; y?: ScalarValueJSON; z?: ScalarValueJSON };
  /** Velocity damping; higher = stronger drag */
  drag?: { enabled?: boolean; coefficient: ScalarValueJSON };
  /** Clamp speed to a max, optionally dampening toward it */
  limitVelocity?: { enabled?: boolean; speed: ScalarValueJSON; dampen?: number };
  /** Curl-noise turbulence force */
  turbulence?: { enabled?: boolean; strength: ScalarValueJSON; frequency?: number; scrollSpeed?: number; positional?: boolean };
  /** Swirl around an axis (tornado, vortex). Strength in deg/s of angular motion. */
  vortex?: { enabled?: boolean; strength: ScalarValueJSON; axis?: Vec3JSON; center?: Vec3JSON; /** radial pull, units/s^2, negative = inward */ radialPull?: number };
  /** Point force field; positive strength attracts, negative repels */
  attractor?: { enabled?: boolean; position?: Vec3JSON; strength: ScalarValueJSON; radius?: number; /** kill particles entering this radius */ killRadius?: number };
  /** Rotate particle positions around an axis through `center` (deg/s) */
  orbit?: { enabled?: boolean; speed: ScalarValueJSON; axis?: Vec3JSON; center?: Vec3JSON };
}

export interface FlipbookJSON {
  rows: number;
  cols: number;
  mode?: 'overLife' | 'random';
}

export interface RenderJSON {
  /** Texture path, resolved relative to the preset URL (or basePath option) */
  sprite?: string;
  blend?: BlendMode;
  mode?: RenderMode;
  /** Stretched mode: extra length per unit of speed */
  stretchFactor?: number;
  /** Stretched mode: base length multiplier */
  lengthScale?: number;
  /** Multiply by the effect instance tint (default true) */
  applyTint?: boolean;
  flipbook?: FlipbookJSON;
}

export interface EmitterJSON {
  name: string;
  enabled?: boolean;
  /** Sub-emitters do not run on their own timeline; they only spawn via triggers */
  isSubEmitter?: boolean;
  position?: Vec3JSON;
  /** Euler degrees */
  rotation?: Vec3JSON;
  /** Seconds before this emitter starts */
  delay?: number;
  duration?: number;
  looping?: boolean;
  maxParticles?: number;
  simulationSpace?: SimulationSpace;
  /** Gravity multiplier (1 = -9.81 on Y) */
  gravity?: number;
  /** Fraction of effect-instance velocity given to new particles */
  inheritVelocity?: number;

  emission?: EmissionJSON;
  shape?: ShapeJSON;
  /** 0..1, blends shape direction toward a random direction */
  randomizeDirection?: number;

  lifetime?: ScalarValueJSON;
  speed?: ScalarValueJSON;
  size?: ScalarValueJSON;
  /** Optional separate Y size (else uniform) */
  sizeY?: ScalarValueJSON;
  /** Start rotation, degrees */
  startRotation?: ScalarValueJSON;
  /** Start angular velocity, deg/s */
  angularVelocity?: ScalarValueJSON;
  startColor?: StartColorJSON;

  modules?: ModulesJSON;
  subEmitters?: SubEmitterJSON[];
  render?: RenderJSON;
}

/** Options for spawning an effect instance. */
export interface SpawnOptions {
  position?: Vec3JSON;
  /** Euler degrees */
  rotation?: Vec3JSON;
  scale?: number;
  /** CSS hex color or rgba array; multiplies emitters with applyTint */
  tint?: string | ColorJSON;
  /** Degrees of hue rotation applied to tinted emitters */
  hueShift?: number;
  /** Random seed; omit for auto */
  seed?: number;
  /** Remove the instance automatically when finished (default true) */
  autoDispose?: boolean;
}
