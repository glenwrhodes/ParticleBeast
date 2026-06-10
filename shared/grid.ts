/** A subtle grid floor rendered with plain WebGL2 lines, with distance fade. */

const VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_view;
uniform mat4 u_proj;
out vec3 v_world;
void main() {
  v_world = a_pos;
  gl_Position = u_proj * u_view * vec4(a_pos, 1.0);
}
`;

const FS = `#version 300 es
precision mediump float;
in vec3 v_world;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  float d = length(v_world.xz);
  float fade = 1.0 - smoothstep(6.0, 16.0, d);
  fragColor = vec4(u_color.rgb, u_color.a * fade);
}
`;

export class GridFloor {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private uView: WebGLUniformLocation | null;
  private uProj: WebGLUniformLocation | null;
  private uColor: WebGLUniformLocation | null;
  color: [number, number, number, number] = [0.45, 0.55, 0.62, 0.28];

  constructor(gl: WebGL2RenderingContext, extent = 16, step = 1) {
    this.gl = gl;
    const verts: number[] = [];
    for (let i = -extent; i <= extent; i += step) {
      verts.push(i, 0, -extent, i, 0, extent);
      verts.push(-extent, 0, i, extent, 0, i);
    }
    this.count = verts.length / 3;

    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'grid shader');
      return sh;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.program);
    this.uView = gl.getUniformLocation(this.program, 'u_view');
    this.uProj = gl.getUniformLocation(this.program, 'u_proj');
    this.uColor = gl.getUniformLocation(this.program, 'u_color');

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  render(view: Float32Array, proj: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.uniform4fv(this.uColor, this.color);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, this.count);
    gl.depthMask(true);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }
}
