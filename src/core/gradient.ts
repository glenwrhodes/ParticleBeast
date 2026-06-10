/** Color gradients with separate color and alpha keys, pre-sampled to a LUT. */

export interface ColorKey {
  t: number;
  /** RGB 0..1 */
  color: [number, number, number];
}

export interface AlphaKey {
  t: number;
  alpha: number;
}

export interface GradientJSON {
  colorKeys: ColorKey[];
  alphaKeys: AlphaKey[];
}

const LUT_SIZE = 64;

export class Gradient {
  /** RGBA interleaved, LUT_SIZE entries. */
  readonly lut: Float32Array;

  constructor(json: GradientJSON | undefined) {
    this.lut = new Float32Array(LUT_SIZE * 4);
    const colorKeys = (json?.colorKeys?.length ? [...json.colorKeys] : [{ t: 0, color: [1, 1, 1] as [number, number, number] }])
      .sort((a, b) => a.t - b.t);
    const alphaKeys = (json?.alphaKeys?.length ? [...json.alphaKeys] : [{ t: 0, alpha: 1 }])
      .sort((a, b) => a.t - b.t);
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      const c = sampleColorKeys(colorKeys, t);
      this.lut[i * 4] = c[0];
      this.lut[i * 4 + 1] = c[1];
      this.lut[i * 4 + 2] = c[2];
      this.lut[i * 4 + 3] = sampleAlphaKeys(alphaKeys, t);
    }
  }

  /** Write RGBA at normalized t into out[offset..offset+3]. */
  sample(t: number, out: Float32Array | number[], offset: number): void {
    const tc = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const f = tc * (LUT_SIZE - 1);
    const i = f | 0;
    const fr = f - i;
    const j = Math.min(i + 1, LUT_SIZE - 1);
    for (let k = 0; k < 4; k++) {
      out[offset + k] = this.lut[i * 4 + k] + (this.lut[j * 4 + k] - this.lut[i * 4 + k]) * fr;
    }
  }
}

function sampleColorKeys(keys: ColorKey[], t: number): [number, number, number] {
  if (t <= keys[0].t) return keys[0].color;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.color;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1e-6);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * u,
        a.color[1] + (b.color[1] - a.color[1]) * u,
        a.color[2] + (b.color[2] - a.color[2]) * u,
      ];
    }
  }
  return last.color;
}

function sampleAlphaKeys(keys: AlphaKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].alpha;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.alpha;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1e-6);
      return a.alpha + (b.alpha - a.alpha) * u;
    }
  }
  return last.alpha;
}
