/**
 * ScalarValue: Unity-style "MinMaxCurve". A value can be a constant, a random
 * range, a curve over a normalized 0-1 parameter, or a random blend between
 * two curves. Curves are pre-sampled into lookup tables for fast evaluation.
 */

export interface CurveKey {
  /** Normalized time 0..1 */
  t: number;
  /** Value at this key */
  v: number;
}

export type ScalarValueJSON =
  | number
  | { type: 'constant'; value: number }
  | { type: 'random'; min: number; max: number }
  | { type: 'curve'; keys: CurveKey[]; scale?: number }
  | { type: 'randomCurves'; min: CurveKey[]; max: CurveKey[]; scale?: number };

const LUT_SIZE = 64;

/** Catmull-Rom interpolation through sorted keys, clamped at the ends. */
export function sampleCurveKeys(keys: CurveKey[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1) return keys[0].v;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const span = k2.t - k1.t || 1e-6;
  const u = (t - k1.t) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * k1.v +
      (-k0.v + k2.v) * u +
      (2 * k0.v - 5 * k1.v + 4 * k2.v - k3.v) * u2 +
      (-k0.v + 3 * k1.v - 3 * k2.v + k3.v) * u3)
  );
}

function buildLut(keys: CurveKey[]): Float32Array {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const lut = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    lut[i] = sampleCurveKeys(sorted, i / (LUT_SIZE - 1));
  }
  return lut;
}

function sampleLut(lut: Float32Array, t: number): number {
  if (t <= 0) return lut[0];
  if (t >= 1) return lut[LUT_SIZE - 1];
  const f = t * (LUT_SIZE - 1);
  const i = f | 0;
  const fr = f - i;
  return lut[i] + (lut[i + 1] - lut[i]) * fr;
}

export class ScalarValue {
  private mode: 0 | 1 | 2 | 3; // constant | random | curve | randomCurves
  private a = 0;
  private b = 0;
  private lutA: Float32Array | null = null;
  private lutB: Float32Array | null = null;
  private scale = 1;

  constructor(json: ScalarValueJSON | undefined, fallback: number) {
    if (json === undefined || json === null) {
      this.mode = 0;
      this.a = fallback;
      return;
    }
    if (typeof json === 'number') {
      this.mode = 0;
      this.a = json;
      return;
    }
    // Infer the type when omitted, so hand-written presets can be terse:
    // {keys} -> curve, {min: [...], max: [...]} -> randomCurves, {min, max} -> random
    const obj = json as Record<string, unknown>;
    const type =
      (obj.type as string | undefined) ??
      (Array.isArray(obj.keys) ? 'curve' : Array.isArray(obj.min) ? 'randomCurves' : obj.min !== undefined ? 'random' : 'constant');

    if (type === 'constant') {
      this.mode = 0;
      this.a = (obj.value as number) ?? fallback;
    } else if (type === 'random') {
      this.mode = 1;
      this.a = (obj.min as number) ?? fallback;
      this.b = (obj.max as number) ?? fallback;
    } else if (type === 'curve') {
      this.mode = 2;
      this.lutA = buildLut((obj.keys as CurveKey[]) ?? [{ t: 0, v: fallback }]);
      this.scale = (obj.scale as number) ?? 1;
    } else {
      this.mode = 3;
      this.lutA = buildLut((obj.min as CurveKey[]) ?? [{ t: 0, v: fallback }]);
      this.lutB = buildLut((obj.max as CurveKey[]) ?? [{ t: 0, v: fallback }]);
      this.scale = (obj.scale as number) ?? 1;
    }
  }

  /**
   * Evaluate. `t` is the normalized parameter (life fraction or emitter time),
   * `r` is the particle's persistent random factor in [0,1).
   */
  eval(t: number, r: number): number {
    switch (this.mode) {
      case 0:
        return this.a;
      case 1:
        return this.a + (this.b - this.a) * r;
      case 2:
        return sampleLut(this.lutA!, t) * this.scale;
      case 3: {
        const lo = sampleLut(this.lutA!, t);
        const hi = sampleLut(this.lutB!, t);
        return (lo + (hi - lo) * r) * this.scale;
      }
    }
  }

  /** True if this value never changes with t (constant or random). */
  get isStatic(): boolean {
    return this.mode <= 1;
  }
}
