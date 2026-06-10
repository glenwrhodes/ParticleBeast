/**
 * 3D simplex noise (Stefan Gustavson's public-domain reference, condensed)
 * plus a curl-noise helper used by the turbulence module.
 */

const grad3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const perm = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fixed shuffle (deterministic across runs)
  let seed = 47;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

const F3 = 1 / 3;
const G3 = 1 / 6;

export function simplex3(xin: number, yin: number, zin: number): number {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);

  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) {
    const gi = (perm[ii + perm[jj + perm[kk]]] % 12) * 3;
    t0 *= t0;
    n += t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0 + grad3[gi + 2] * z0);
  }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) {
    const gi = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12) * 3;
    t1 *= t1;
    n += t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1 + grad3[gi + 2] * z1);
  }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) {
    const gi = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12) * 3;
    t2 *= t2;
    n += t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2 + grad3[gi + 2] * z2);
  }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) {
    const gi = (perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12) * 3;
    t3 *= t3;
    n += t3 * t3 * (grad3[gi] * x3 + grad3[gi + 1] * y3 + grad3[gi + 2] * z3);
  }
  return 32 * n; // roughly [-1, 1]
}

const EPS = 0.1;
const INV2EPS = 1 / (2 * EPS);
// Offsets decorrelate the three potential components
const O2 = 31.416;
const O3 = -47.853;

function psi1(x: number, y: number, z: number, t: number): number {
  return simplex3(x, y, z + t);
}
function psi2(x: number, y: number, z: number, t: number): number {
  return simplex3(x + O2, y + O2, z + O2 + t);
}
function psi3(x: number, y: number, z: number, t: number): number {
  return simplex3(x + O3, y + O3, z + O3 + t);
}

/**
 * Divergence-free curl noise field (curl of a 3-component noise potential).
 * Writes a vector (roughly unit magnitude) into out[0..2]. `t` scrolls the field.
 */
export function curl3(x: number, y: number, z: number, t: number, out: number[] | Float32Array): void {
  const dp3dy = (psi3(x, y + EPS, z, t) - psi3(x, y - EPS, z, t)) * INV2EPS;
  const dp2dz = (psi2(x, y, z + EPS, t) - psi2(x, y, z - EPS, t)) * INV2EPS;
  const dp1dz = (psi1(x, y, z + EPS, t) - psi1(x, y, z - EPS, t)) * INV2EPS;
  const dp3dx = (psi3(x + EPS, y, z, t) - psi3(x - EPS, y, z, t)) * INV2EPS;
  const dp2dx = (psi2(x + EPS, y, z, t) - psi2(x - EPS, y, z, t)) * INV2EPS;
  const dp1dy = (psi1(x, y + EPS, z, t) - psi1(x, y - EPS, z, t)) * INV2EPS;
  out[0] = dp3dy - dp2dz;
  out[1] = dp1dz - dp3dx;
  out[2] = dp2dx - dp1dy;
}
