/** Minimal vector / matrix math. Matrices are column-major Float32Array(16), WebGL convention. */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export const DEG2RAD = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vec3Set(out: Float32Array | number[], x: number, y: number, z: number): void {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

export function vec3Length(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function mat4Identity(out?: Float32Array): Float32Array {
  const m = out ?? new Float32Array(16);
  m.fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function mat4Perspective(
  out: Float32Array,
  fovYRad: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fovYRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4LookAt(out: Float32Array, eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = vec3Length(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = vec3Length(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/** Compose translation * rotation(Euler XYZ, degrees) * uniform scale. */
export function mat4Compose(
  out: Float32Array,
  pos: ArrayLike<number>,
  eulerDeg: ArrayLike<number>,
  scale: number
): Float32Array {
  const rx = eulerDeg[0] * DEG2RAD, ry = eulerDeg[1] * DEG2RAD, rz = eulerDeg[2] * DEG2RAD;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
  const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
  out[0] = r00 * scale; out[1] = r10 * scale; out[2] = r20 * scale; out[3] = 0;
  out[4] = r01 * scale; out[5] = r11 * scale; out[6] = r21 * scale; out[7] = 0;
  out[8] = r02 * scale; out[9] = r12 * scale; out[10] = r22 * scale; out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
  return out;
}

export function mat4TransformPoint(out: number[] | Float32Array, m: Float32Array, x: number, y: number, z: number): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

export function mat4TransformDir(out: number[] | Float32Array, m: Float32Array, x: number, y: number, z: number): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
}

/** Camera world position from a view matrix (inverse translation). */
export function mat4CameraPosition(out: number[] | Float32Array, view: Float32Array): void {
  // R^T * -t
  const tx = view[12], ty = view[13], tz = view[14];
  out[0] = -(view[0] * tx + view[1] * ty + view[2] * tz);
  out[1] = -(view[4] * tx + view[5] * ty + view[6] * tz);
  out[2] = -(view[8] * tx + view[9] * ty + view[10] * tz);
}

/** Invert a TRS matrix (rotation + translation + uniform scale). */
export function mat4InvertTRS(out: Float32Array, m: Float32Array): Float32Array {
  const sx2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const inv = sx2 > 1e-12 ? 1 / sx2 : 1;
  const r00 = m[0] * inv, r01 = m[4] * inv, r02 = m[8] * inv;
  const r10 = m[1] * inv, r11 = m[5] * inv, r12 = m[9] * inv;
  const r20 = m[2] * inv, r21 = m[6] * inv, r22 = m[10] * inv;
  const tx = m[12], ty = m[13], tz = m[14];
  out[0] = r00; out[1] = r01; out[2] = r02; out[3] = 0;
  out[4] = r10; out[5] = r11; out[6] = r12; out[7] = 0;
  out[8] = r20; out[9] = r21; out[10] = r22; out[11] = 0;
  out[12] = -(r00 * tx + r10 * ty + r20 * tz);
  out[13] = -(r01 * tx + r11 * ty + r21 * tz);
  out[14] = -(r02 * tx + r12 * ty + r22 * tz);
  out[15] = 1;
  return out;
}

/** Rotate point p around axis (unit) through origin by angle (radians). Rodrigues. */
export function rotateAroundAxis(
  out: number[] | Float32Array,
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  angle: number
): void {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const dot = ax * px + ay * py + az * pz;
  const crx = ay * pz - az * py;
  const cry = az * px - ax * pz;
  const crz = ax * py - ay * px;
  out[0] = px * c + crx * s + ax * dot * t;
  out[1] = py * c + cry * s + ay * dot * t;
  out[2] = pz * c + crz * s + az * dot * t;
}
