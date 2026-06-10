/**
 * Transform-feedback update shader for GPU-simulated emitters.
 *
 * Particle state lives in two ping-pong GPU buffers. Each frame this vertex
 * shader reads the previous state, (re)spawns ring-buffer slots, integrates
 * all simulation modules, and writes the new state via transform feedback —
 * the CPU never touches per-particle data.
 *
 * The first 16 floats of each particle's state match the CPU renderer's
 * instance layout exactly (pos, size, rot, color, vel, lifeT/seed/pad), so the
 * regular render program draws GPU emitters unchanged. The remaining floats
 * are simulation-only (age, life, start size, angular velocity, start color).
 */

/** Floats per particle in the GPU state buffer (16 render + 9 sim). */
export const GPU_FLOATS = 25;

/** Transform feedback varyings, in exact interleaved buffer order. */
export const UPDATE_VARYINGS = [
  'v_pos', 'v_size', 'v_rot', 'v_color', 'v_vel', 'v_misc',
  'v_sim0', 'v_sim1', 'v_sim2',
];

export const CURVE_TEX_WIDTH = 64;
export const CURVE_TEX_ROWS = 6;

export const UPDATE_VERT_SRC = `#version 300 es
precision highp float;
precision highp int;

layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_size;
layout(location=2) in float a_rot;
layout(location=3) in vec4 a_color;
layout(location=4) in vec3 a_vel;
layout(location=5) in vec3 a_misc;   // lifeT, seed, pad
layout(location=6) in vec4 a_sim0;   // age, life, startSizeX, startSizeY
layout(location=7) in vec4 a_sim1;   // angVel, startColor.rgb
layout(location=8) in float a_sim2;  // startColor.a

out vec3 v_pos;
out vec2 v_size;
out float v_rot;
out vec4 v_color;
out vec3 v_vel;
out vec3 v_misc;
out vec4 v_sim0;
out vec4 v_sim1;
out float v_sim2;

// Module LUT texture (${CURVE_TEX_WIDTH}x${CURVE_TEX_ROWS}):
// row 0: colorOverLife RGBA
// row 1: sizeOverLife, rotationOverLife (rad/s), drag, limitSpeed
// row 2: velocityOverLife xyz, turbulence strength
// row 3: forceOverLife xyz, vortex strength (rad/s)
// row 4: attractor strength, orbit speed (rad/s), -, -
// row 5: startColor gradient RGBA
uniform sampler2D u_curves;

uniform float u_dt;
uniform float u_noiseT;
uniform vec3 u_spawnInfo;      // ring start, spawn count, maxParticles
uniform float u_frameSeed;
uniform mat4 u_emitterMat;     // emitter world matrix (world-space spawning)
uniform float u_worldSpace;
uniform vec3 u_inheritVel;
uniform vec3 u_gravity;        // sim-space, pre-scaled
uniform mat3 u_invRot;         // world -> sim rotation
uniform float u_velWorld;      // velocityOverLife is in world space
uniform vec4 u_spawnLife;      // lifeMin, lifeMax, speedMin, speedMax
uniform vec4 u_spawnSize;      // sizeMin, sizeMax, sizeYMin, sizeYMax
uniform float u_hasSizeY;
uniform vec4 u_spawnRot;       // rotMin, rotMax, angVelMin, angVelMax (radians)
uniform vec4 u_startColorA;
uniform vec4 u_startColorB;
uniform float u_startColorMode; // 0 constant, 1 random lerp, 2 gradient row 5
uniform float u_randomizeDir;
uniform float u_shapeType;     // 0 point 1 sphere 2 cone 3 circle 4 box 5 donut 6 edge
uniform vec4 u_shapeA;
uniform vec4 u_turb;           // frequency, positional, enabled, -
uniform vec4 u_vortexA;        // axis.xyz, radialPull
uniform vec4 u_vortexB;        // center.xyz, enabled
uniform vec4 u_attrA;          // pos.xyz, radius
uniform vec4 u_attrB;          // killRadius, enabled, limitDampen, -
uniform vec4 u_orbitA;         // axis.xyz, enabled
uniform vec3 u_orbitB;         // center

const float TAU = 6.28318530718;

// ---- Random ----
uint pcgHash(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(inout uint st) {
  st = pcgHash(st);
  return float(st) * (1.0 / 4294967296.0);
}
vec3 randomUnit(inout uint st) {
  float z = 1.0 - 2.0 * rnd(st);
  float ph = TAU * rnd(st);
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(ph), r * sin(ph), z);
}

// ---- Module LUT ----
vec4 curveRow(float row, float t) {
  float u = (clamp(t, 0.0, 1.0) * ${(CURVE_TEX_WIDTH - 1).toFixed(1)} + 0.5) / ${CURVE_TEX_WIDTH.toFixed(1)};
  return texture(u_curves, vec2(u, (row + 0.5) / ${CURVE_TEX_ROWS.toFixed(1)}));
}

// ---- Rodrigues rotation ----
vec3 rotAxis(vec3 v, vec3 axis, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// ---- Simplex noise (Ashima Arts / Stefan Gustavson, public domain) ----
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Divergence-free curl noise, same potential layout as the CPU version
const float NEPS = 0.1;
float psi1(vec3 p, float t) { return snoise(vec3(p.xy, p.z + t)); }
float psi2(vec3 p, float t) { return snoise(p + vec3(31.416, 31.416, 31.416 + t)); }
float psi3(vec3 p, float t) { return snoise(p + vec3(-47.853, -47.853, -47.853 + t)); }

vec3 curlNoise(vec3 p, float t) {
  float inv2e = 1.0 / (2.0 * NEPS);
  vec3 dx = vec3(NEPS, 0.0, 0.0);
  vec3 dy = vec3(0.0, NEPS, 0.0);
  vec3 dz = vec3(0.0, 0.0, NEPS);
  float dp3dy = (psi3(p + dy, t) - psi3(p - dy, t)) * inv2e;
  float dp2dz = (psi2(p + dz, t) - psi2(p - dz, t)) * inv2e;
  float dp1dz = (psi1(p + dz, t) - psi1(p - dz, t)) * inv2e;
  float dp3dx = (psi3(p + dx, t) - psi3(p - dx, t)) * inv2e;
  float dp2dx = (psi2(p + dx, t) - psi2(p - dx, t)) * inv2e;
  float dp1dy = (psi1(p + dy, t) - psi1(p - dy, t)) * inv2e;
  return vec3(dp3dy - dp2dz, dp1dz - dp3dx, dp2dx - dp1dy);
}

// ---- Emission shapes (ports of src/core/shapes.ts) ----
void spawnShape(inout uint st, out vec3 pos, out vec3 dir) {
  int type = int(u_shapeType + 0.5);
  if (type == 1) {
    // sphere: radius, hemisphere, shell
    dir = randomUnit(st);
    if (u_shapeA.y > 0.5 && dir.y < 0.0) dir.y = -dir.y;
    float r = u_shapeA.z > 0.5 ? u_shapeA.x : u_shapeA.x * pow(rnd(st), 1.0 / 3.0);
    pos = dir * r;
  } else if (type == 2) {
    // cone: angle (rad), radius, length, fromVolume
    float theta = rnd(st) * TAU;
    float radFrac = sqrt(rnd(st));
    float r = u_shapeA.y * radFrac;
    float ct = cos(theta);
    float sn = sin(theta);
    float a = u_shapeA.x * radFrac;
    dir = vec3(sin(a) * ct, cos(a), sin(a) * sn);
    pos = vec3(ct * r, 0.0, sn * r);
    if (u_shapeA.w > 0.5) pos += dir * (rnd(st) * u_shapeA.z);
  } else if (type == 3) {
    // circle: radius, arc (rad), shell
    float theta = rnd(st) * u_shapeA.y;
    float r = u_shapeA.z > 0.5 ? u_shapeA.x : u_shapeA.x * sqrt(rnd(st));
    float ct = cos(theta);
    float sn = sin(theta);
    pos = vec3(ct * r, 0.0, sn * r);
    dir = vec3(ct, 0.0, sn);
  } else if (type == 4) {
    // box: hx, hy, hz, mode (0 volume, 1 shell, 2 edge)
    vec3 h = u_shapeA.xyz;
    pos = (vec3(rnd(st), rnd(st), rnd(st)) * 2.0 - 1.0) * h;
    if (u_shapeA.w > 1.5) {
      int e = int(rnd(st) * 12.0);
      float tt = rnd(st) * 2.0 - 1.0;
      pos = vec3((e & 1) != 0 ? h.x : -h.x, (e & 2) != 0 ? h.y : -h.y, (e & 4) != 0 ? h.z : -h.z);
      int axis = e % 3;
      if (axis == 0) pos.x = tt * h.x;
      else if (axis == 1) pos.y = tt * h.y;
      else pos.z = tt * h.z;
    } else if (u_shapeA.w > 0.5) {
      int face = int(rnd(st) * 6.0);
      if (face == 0) pos.x = h.x;
      else if (face == 1) pos.x = -h.x;
      else if (face == 2) pos.y = h.y;
      else if (face == 3) pos.y = -h.y;
      else if (face == 4) pos.z = h.z;
      else pos.z = -h.z;
    }
    dir = vec3(0.0, 1.0, 0.0);
  } else if (type == 5) {
    // donut: radius, tube
    float theta = rnd(st) * TAU;
    float phi = rnd(st) * TAU;
    float ct = cos(theta);
    float sn = sin(theta);
    float cp = cos(phi);
    float sp = sin(phi);
    float r = u_shapeA.x + u_shapeA.y * cp * sqrt(rnd(st));
    pos = vec3(ct * r, u_shapeA.y * sp, sn * r);
    dir = vec3(ct * cp, sp, sn * cp);
  } else if (type == 6) {
    // edge: half length
    pos = vec3((rnd(st) * 2.0 - 1.0) * u_shapeA.x, 0.0, 0.0);
    dir = vec3(0.0, 1.0, 0.0);
  } else {
    // point
    pos = vec3(0.0);
    dir = randomUnit(st);
  }
}

void main() {
  vec3 pos = a_pos;
  vec3 vel = a_vel;
  float rot = a_rot;
  float age = a_sim0.x;
  float life = a_sim0.y;
  vec2 startSize = a_sim0.zw;
  float angVel = a_sim1.x;
  vec4 startColor = vec4(a_sim1.yzw, a_sim2);
  float seed = a_misc.y;

  float idx = float(gl_VertexID);
  float rel = mod(idx - u_spawnInfo.x + u_spawnInfo.z, u_spawnInfo.z);
  bool dead = age >= life;

  if (dead && rel < u_spawnInfo.y) {
    // ---- Spawn ----
    uint st = pcgHash(uint(gl_VertexID) ^ floatBitsToUint(u_frameSeed));
    seed = rnd(st);
    vec3 dir;
    spawnShape(st, pos, dir);
    if (u_randomizeDir > 0.0) {
      vec3 mixed = mix(dir, randomUnit(st), u_randomizeDir);
      float len = length(mixed);
      dir = len > 1e-5 ? mixed / len : dir;
    }
    float speed = mix(u_spawnLife.z, u_spawnLife.w, rnd(st));
    if (u_worldSpace > 0.5) {
      pos = (u_emitterMat * vec4(pos, 1.0)).xyz;
      dir = mat3(u_emitterMat) * dir;
      vel = dir * speed + u_inheritVel;
    } else {
      vel = dir * speed;
    }
    age = 0.0;
    life = max(0.01, mix(u_spawnLife.x, u_spawnLife.y, rnd(st)));
    startSize.x = mix(u_spawnSize.x, u_spawnSize.y, rnd(st));
    startSize.y = u_hasSizeY > 0.5 ? mix(u_spawnSize.z, u_spawnSize.w, rnd(st)) : startSize.x;
    rot = mix(u_spawnRot.x, u_spawnRot.y, rnd(st));
    angVel = mix(u_spawnRot.z, u_spawnRot.w, rnd(st));
    if (u_startColorMode < 0.5) startColor = u_startColorA;
    else if (u_startColorMode < 1.5) startColor = mix(u_startColorA, u_startColorB, rnd(st));
    else startColor = curveRow(5.0, rnd(st));
    dead = false;
  } else if (!dead) {
    // ---- Simulate ----
    age += u_dt;
    float t = age / life;
    if (t >= 1.0) {
      dead = true;
    } else {
      vec4 modA = curveRow(1.0, t); // sizeOL, rotOL, drag, limitSpeed
      vec4 modV = curveRow(2.0, t); // velocityOL.xyz, turbulence strength
      vec4 modF = curveRow(3.0, t); // forceOL.xyz, vortex strength
      vec4 modX = curveRow(4.0, t); // attractor strength, orbit speed

      vec3 force = u_gravity + modF.xyz;

      if (u_turb.z > 0.5) {
        vec3 c = curlNoise(pos * u_turb.x, u_noiseT);
        if (u_turb.y > 0.5) pos += c * modV.w * u_dt;
        else force += c * modV.w;
      }

      if (u_attrB.y > 0.5) {
        vec3 d = u_attrA.xyz - pos;
        float dist = length(d);
        if (u_attrB.x > 0.0 && dist < u_attrB.x) {
          dead = true;
        } else if (dist > 1e-5) {
          float s = modX.x;
          if (u_attrA.w > 0.0) s *= max(0.0, 1.0 - dist / u_attrA.w);
          force += (d / dist) * s;
        }
      }

      if (!dead) {
        if (u_vortexB.w > 0.5 && u_vortexA.w != 0.0) {
          vec3 c = pos - u_vortexB.xyz;
          float along = dot(c, u_vortexA.xyz);
          vec3 r = c - u_vortexA.xyz * along;
          float rl = length(r);
          if (rl > 1e-5) force -= r * (u_vortexA.w / rl);
        }

        vel += force * u_dt;
        vel *= max(0.0, 1.0 - modA.z * u_dt); // drag

        float sp = length(vel);
        if (sp > modA.w && sp > 1e-6) {
          vel *= 1.0 - (1.0 - modA.w / sp) * u_attrB.z;
        }

        vec3 add = modV.xyz;
        if (u_velWorld > 0.5) add = u_invRot * add;
        pos += (vel + add) * u_dt;

        if (u_vortexB.w > 0.5) {
          float ang = modF.w * u_dt;
          pos = u_vortexB.xyz + rotAxis(pos - u_vortexB.xyz, u_vortexA.xyz, ang);
          vel = rotAxis(vel, u_vortexA.xyz, ang);
        }
        if (u_orbitA.w > 0.5) {
          float ang = modX.y * u_dt;
          pos = u_orbitB + rotAxis(pos - u_orbitB, u_orbitA.xyz, ang);
          vel = rotAxis(vel, u_orbitA.xyz, ang);
        }

        rot += (angVel + modA.y) * u_dt;
      }
    }
  }

  // ---- Write state ----
  v_pos = pos;
  v_vel = vel;
  v_rot = rot;
  v_sim1 = vec4(angVel, startColor.rgb);
  v_sim2 = startColor.a;
  if (dead) {
    v_size = vec2(0.0);
    v_color = vec4(0.0);
    v_misc = vec3(1.0, seed, 0.0);
    v_sim0 = vec4(life + 1.0, life, startSize);
  } else {
    float t = age / life;
    v_size = startSize * curveRow(1.0, t).x;
    v_color = startColor * curveRow(0.0, t);
    v_misc = vec3(t, seed, 0.0);
    v_sim0 = vec4(age, life, startSize);
  }
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export const UPDATE_FRAG_SRC = `#version 300 es
precision mediump float;
void main() {}
`;
