/**
 * WebGL2 instanced particle renderer. One shader, one draw call per emitter.
 * Saves and restores all GL state it touches so it can share a host's context.
 */

import { VERT_SRC, FRAG_SRC } from './shaders';
import { TextureCache, type TextureLoader } from './textures';
import { INSTANCE_FLOATS, type EmitterRuntime } from '../core/emitter';
import { mat4CameraPosition } from '../core/math';
import type { BlendMode, RenderMode } from '../core/types';

const MODE_INDEX: Record<RenderMode, number> = {
  billboard: 0,
  stretched: 1,
  horizontal: 2,
  vertical: 3,
};

interface EmitterGL {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  capacity: number;
}

export interface EmitterDrawCall {
  runtime: EmitterRuntime;
  /** Resolved sprite URL */
  spriteUrl: string;
  tint: Float32Array;
  hueShift: number;
  scale: number;
}

export class ParticleRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly textures: TextureCache;

  private program: WebGLProgram;
  private quadVbo: WebGLBuffer;
  private emitterGL = new Map<EmitterRuntime, EmitterGL>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private camPos = new Float32Array(3);

  constructor(gl: WebGL2RenderingContext, textureLoader?: TextureLoader) {
    this.gl = gl;
    this.textures = new TextureCache(gl, textureLoader);
    this.program = this.buildProgram();
    this.quadVbo = gl.createBuffer()!;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
  }

  private buildProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('ParticleBeast shader error: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('ParticleBeast link error: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    for (const name of [
      'u_view', 'u_proj', 'u_model', 'u_camPos', 'u_mode', 'u_stretch',
      'u_flipbook', 'u_scale', 'u_tex', 'u_tint', 'u_hueShift', 'u_blendMode',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }
    return prog;
  }

  private getEmitterGL(runtime: EmitterRuntime): EmitterGL {
    let res = this.emitterGL.get(runtime);
    if (res) return res;
    const gl = this.gl;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;

    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, runtime.renderData.byteLength, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    const attribs: [number, number, number][] = [
      [1, 3, 0],   // pos
      [2, 2, 12],  // size
      [3, 1, 20],  // rot
      [4, 4, 24],  // color
      [5, 3, 40],  // vel
      [6, 3, 52],  // misc
    ];
    for (const [loc, size, offset] of attribs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.bindVertexArray(prevVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);

    res = { vao, vbo, capacity: runtime.renderData.length };
    this.emitterGL.set(runtime, res);
    return res;
  }

  releaseEmitter(runtime: EmitterRuntime): void {
    const res = this.emitterGL.get(runtime);
    if (!res) return;
    this.gl.deleteVertexArray(res.vao);
    this.gl.deleteBuffer(res.vbo);
    this.emitterGL.delete(runtime);
  }

  /** Render a list of emitter draw calls with the given camera. */
  render(calls: EmitterDrawCall[], view: Float32Array, proj: Float32Array): void {
    if (calls.length === 0) return;
    const gl = this.gl;
    const u = this.uniforms;

    // ---- Save state ----
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevArrayBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB) as number;
    const prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB) as number;
    const prevBlendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
    const prevBlendDstA = gl.getParameter(gl.BLEND_DST_ALPHA) as number;
    const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const prevCull = gl.isEnabled(gl.CULL_FACE);

    // ---- Common state ----
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.uniformMatrix4fv(u.u_view, false, view);
    gl.uniformMatrix4fv(u.u_proj, false, proj);
    mat4CameraPosition(this.camPos, view);
    gl.uniform3fv(u.u_camPos, this.camPos);
    gl.uniform1i(u.u_tex, 0);

    let currentBlend: BlendMode | null = null;

    for (const call of calls) {
      const runtime = call.runtime;
      if (runtime.alive === 0) continue;
      const def = runtime.def;
      const res = this.getEmitterGL(runtime);

      if (def.blend !== currentBlend) {
        currentBlend = def.blend;
        if (def.blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        else if (def.blend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      }

      gl.bindVertexArray(res.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, runtime.renderData, 0, runtime.alive * INSTANCE_FLOATS);

      gl.uniformMatrix4fv(u.u_model, false, runtime.modelMatrix);
      gl.uniform1i(u.u_mode, MODE_INDEX[def.renderMode]);
      gl.uniform2f(u.u_stretch, def.stretchFactor, def.lengthScale);
      gl.uniform3f(u.u_flipbook, def.flipbookCols, def.flipbookRows, def.flipbookRandom ? 1 : 0);
      gl.uniform1f(u.u_scale, call.scale);
      gl.uniform1i(u.u_blendMode, def.blend === 'multiply' ? 2 : def.blend === 'alpha' ? 1 : 0);
      if (def.applyTint) {
        gl.uniform4fv(u.u_tint, call.tint);
        gl.uniform1f(u.u_hueShift, call.hueShift);
      } else {
        gl.uniform4f(u.u_tint, 1, 1, 1, 1);
        gl.uniform1f(u.u_hueShift, 0);
      }

      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(call.spriteUrl));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, runtime.alive);
    }

    // ---- Restore state ----
    gl.bindVertexArray(prevVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuf);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActiveTex);
    gl.useProgram(prevProgram);
    if (!prevBlend) gl.disable(gl.BLEND);
    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcA, prevBlendDstA);
    if (!prevDepthTest) gl.disable(gl.DEPTH_TEST);
    gl.depthMask(prevDepthMask);
    if (prevCull) gl.enable(gl.CULL_FACE);
  }

  dispose(): void {
    for (const res of this.emitterGL.values()) {
      this.gl.deleteVertexArray(res.vao);
      this.gl.deleteBuffer(res.vbo);
    }
    this.emitterGL.clear();
    this.gl.deleteBuffer(this.quadVbo);
    this.gl.deleteProgram(this.program);
    this.textures.dispose();
  }
}
