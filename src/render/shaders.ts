export const VERT_SRC = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec3 a_ipos;
layout(location=2) in vec2 a_isize;
layout(location=3) in float a_irot;
layout(location=4) in vec4 a_icolor;
layout(location=5) in vec3 a_ivel;
layout(location=6) in vec3 a_imisc; // lifeT, seed, unused

uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_model;
uniform vec3 u_camPos;
uniform int u_mode;       // 0 billboard, 1 stretched, 2 horizontal, 3 vertical
uniform vec2 u_stretch;   // stretchFactor, lengthScale
uniform vec3 u_flipbook;  // cols, rows, randomFlag
uniform float u_scale;

out vec2 v_uv;
out vec4 v_color;

void main() {
  vec3 center = (u_model * vec4(a_ipos, 1.0)).xyz;
  vec2 size = a_isize * u_scale;
  float c = cos(a_irot);
  float s = sin(a_irot);
  vec2 corner = vec2(a_corner.x * c - a_corner.y * s, a_corner.x * s + a_corner.y * c);
  vec3 pos;

  if (u_mode == 1) {
    // Stretched billboard: align quad along velocity, width faces the camera
    vec3 vel = mat3(u_model) * a_ivel;
    float speed = length(vel);
    vec3 dir = speed > 1e-5 ? vel / speed : vec3(0.0, 1.0, 0.0);
    float len = size.y * u_stretch.y + speed * u_stretch.x * u_scale;
    vec3 toCam = normalize(u_camPos - center);
    vec3 side = cross(dir, toCam);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
    pos = center + dir * (a_corner.y * len) + side * (a_corner.x * size.x);
  } else if (u_mode == 2) {
    // Horizontal: flat on the XZ plane (floor decals)
    pos = center + vec3(corner.x * size.x, 0.0, -corner.y * size.y);
  } else if (u_mode == 3) {
    // Vertical: cylindrical billboard around Y
    vec3 toCam = u_camPos - center;
    toCam.y = 0.0;
    float tl = length(toCam);
    vec3 fwd = tl > 1e-5 ? toCam / tl : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    pos = center + right * (corner.x * size.x) + vec3(0.0, corner.y * size.y, 0.0);
  } else {
    // Camera-facing billboard
    vec3 right = vec3(u_view[0][0], u_view[1][0], u_view[2][0]);
    vec3 up = vec3(u_view[0][1], u_view[1][1], u_view[2][1]);
    pos = center + right * (corner.x * size.x) + up * (corner.y * size.y);
  }

  vec2 uv = a_corner + 0.5;
  float frames = u_flipbook.x * u_flipbook.y;
  if (frames > 1.5) {
    float f = u_flipbook.z > 0.5 ? floor(a_imisc.y * frames) : floor(a_imisc.x * frames);
    f = clamp(f, 0.0, frames - 1.0);
    float col = mod(f, u_flipbook.x);
    float row = floor(f / u_flipbook.x);
    uv = (uv + vec2(col, u_flipbook.y - 1.0 - row)) / vec2(u_flipbook.x, u_flipbook.y);
  }

  v_uv = uv;
  v_color = a_icolor;
  gl_Position = u_proj * u_view * vec4(pos, 1.0);
}
`;

export const FRAG_SRC = `#version 300 es
precision mediump float;

in vec2 v_uv;
in vec4 v_color;

uniform sampler2D u_tex;
uniform vec4 u_tint;
uniform float u_hueShift; // radians
uniform int u_blendMode;  // 0 additive/subtractive, 1 alpha, 2 multiply, 3 screen

out vec4 fragColor;

vec3 hueShift(vec3 color, float a) {
  const vec3 k = vec3(0.57735026919);
  float c = cos(a);
  return color * c + cross(k, color) * sin(a) + k * dot(k, color) * (1.0 - c);
}

void main() {
  vec4 tex = texture(u_tex, v_uv);
  vec4 col = tex * v_color * u_tint;
  if (u_hueShift != 0.0) {
    col.rgb = clamp(hueShift(col.rgb, u_hueShift), 0.0, 4.0);
  }
  if (u_blendMode == 2) {
    // Multiply blend: fade toward white so alpha=0 has no effect
    fragColor = vec4(mix(vec3(1.0), col.rgb, col.a), col.a);
  } else if (u_blendMode == 3) {
    // Screen blend: premultiply so alpha fades the contribution
    if (col.a <= 0.003) discard;
    fragColor = vec4(col.rgb * col.a, col.a);
  } else {
    if (col.a <= 0.003) discard;
    fragColor = col;
  }
}
`;
