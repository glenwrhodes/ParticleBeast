/**
 * WebGL2 instanced particle renderer. One shader, one draw call per emitter.
 * Saves and restores all GL state it touches so it can share a host's context.
 *
 * CPU-simulated emitters stream their instance data into a VBO each frame.
 * GPU-simulated emitters keep their state in ping-pong buffers advanced by a
 * transform-feedback update pass (see gpuShaders.ts); the first 16 floats of
 * their state match the CPU instance layout, so both paths share the render
 * program, blend modes and all per-emitter uniforms.
 */

import { VERT_SRC, FRAG_SRC } from './shaders';
import { UPDATE_VERT_SRC, UPDATE_FRAG_SRC, UPDATE_VARYINGS, GPU_FLOATS, CURVE_TEX_WIDTH, CURVE_TEX_ROWS } from './gpuShaders';
import { TextureCache, type TextureLoader } from './textures';
import { INSTANCE_FLOATS, type EmitterRuntime } from '../core/emitter';
import { GpuEmitterRuntime } from '../core/gpuEmitter';
import { mat4CameraPosition } from '../core/math';
import type { BlendMode, RenderMode } from '../core/types';

const MODE_INDEX: Record<RenderMode, number> = {
  billboard: 0,
  stretched: 1,
  horizontal: 2,
  vertical: 3,
};

/** Fragment shader u_blendMode index. Subtractive shares the additive path. */
const BLEND_INDEX: Record<BlendMode, number> = {
  additive: 0,
  alpha: 1,
  multiply: 2,
  screen: 3,
  subtractive: 0,
};

// Instanced attributes shared by both render paths: [location, size, byte offset]
const RENDER_ATTRIBS: [number, number, number][] = [
  [1, 3, 0],   // pos
  [2, 2, 12],  // size
  [3, 1, 20],  // rot
  [4, 4, 24],  // color
  [5, 3, 40],  // vel
  [6, 3, 52],  // misc
];

// Update-pass attributes covering the full GPU state: [location, size, byte offset]
const UPDATE_ATTRIBS: [number, number, number][] = [
  [0, 3, 0],   // pos
  [1, 2, 12],  // size
  [2, 1, 20],  // rot
  [3, 4, 24],  // color
  [4, 3, 40],  // vel
  [5, 3, 52],  // misc
  [6, 4, 64],  // sim0: age, life, startSize
  [7, 4, 80],  // sim1: angVel, startColor.rgb
  [8, 1, 96],  // sim2: startColor.a
];

interface EmitterGL {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  capacity: number;
}

interface GpuEmitterGL {
  buffers: [WebGLBuffer, WebGLBuffer];
  tf: [WebGLTransformFeedback, WebGLTransformFeedback];
  updateVao: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  renderVao: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  curveTex: WebGLTexture;
  byteLength: number;
  /** Index of the buffer holding the current (latest) state */
  cur: number;
}

export interface EmitterDrawCall {
  runtime: EmitterRuntime | GpuEmitterRuntime;
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
  private gpuEmitterGL = new Map<GpuEmitterRuntime, GpuEmitterGL>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private updateProgram: WebGLProgram | null = null;
  private updateUniforms: Record<string, WebGLUniformLocation | null> = {};
  private camPos = new Float32Array(3);

  constructor(gl: WebGL2RenderingContext, textureLoader?: TextureLoader) {
    this.gl = gl;
    this.textures = new TextureCache(gl, textureLoader);
    this.program = this.buildRenderProgram();
    this.quadVbo = gl.createBuffer()!;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('ParticleBeast shader error: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  private buildRenderProgram(): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
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

  /** Built lazily, only when the first GPU-simulated emitter shows up. */
  private buildUpdateProgram(): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, UPDATE_VERT_SRC);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, UPDATE_FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.transformFeedbackVaryings(prog, UPDATE_VARYINGS, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('ParticleBeast update-shader link error: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    for (const name of [
      'u_curves', 'u_dt', 'u_noiseT', 'u_spawnInfo', 'u_frameSeed', 'u_emitterMat',
      'u_worldSpace', 'u_inheritVel', 'u_gravity', 'u_invRot', 'u_velWorld',
      'u_spawnLife', 'u_spawnSize', 'u_hasSizeY', 'u_spawnRot',
      'u_startColorA', 'u_startColorB', 'u_startColorMode', 'u_randomizeDir',
      'u_shapeType', 'u_shapeA', 'u_turb', 'u_vortexA', 'u_vortexB',
      'u_attrA', 'u_attrB', 'u_orbitA', 'u_orbitB',
    ]) {
      this.updateUniforms[name] = gl.getUniformLocation(prog, name);
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
    for (const [loc, size, offset] of RENDER_ATTRIBS) {
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

  private getGpuEmitterGL(runtime: GpuEmitterRuntime): GpuEmitterGL {
    let res = this.gpuEmitterGL.get(runtime);
    if (res) return res;
    const gl = this.gl;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;

    const n = runtime.def.maxParticles;
    const byteLength = n * GPU_FLOATS * 4;
    const stride = GPU_FLOATS * 4;

    // bufferData with a size zero-fills, which reads as "dead" (age 0 >= life 0)
    const buffers: [WebGLBuffer, WebGLBuffer] = [gl.createBuffer()!, gl.createBuffer()!];
    for (const b of buffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_COPY);
    }

    const tf: [WebGLTransformFeedback, WebGLTransformFeedback] = [gl.createTransformFeedback()!, gl.createTransformFeedback()!];
    for (let i = 0; i < 2; i++) {
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf[i]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers[i]);
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

    const makeVao = (buf: WebGLBuffer, attribs: [number, number, number][], instanced: boolean): WebGLVertexArrayObject => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      if (instanced) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [loc, size, offset] of attribs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
        if (instanced) gl.vertexAttribDivisor(loc, 1);
      }
      return vao;
    };

    const updateVao: [WebGLVertexArrayObject, WebGLVertexArrayObject] = [
      makeVao(buffers[0], UPDATE_ATTRIBS, false),
      makeVao(buffers[1], UPDATE_ATTRIBS, false),
    ];
    const renderVao: [WebGLVertexArrayObject, WebGLVertexArrayObject] = [
      makeVao(buffers[0], RENDER_ATTRIBS, true),
      makeVao(buffers[1], RENDER_ATTRIBS, true),
    ];

    const curveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, curveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_TEX_WIDTH, CURVE_TEX_ROWS, 0, gl.RGBA, gl.FLOAT, runtime.curveData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(prevVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);

    res = { buffers, tf, updateVao, renderVao, curveTex, byteLength, cur: 0 };
    this.gpuEmitterGL.set(runtime, res);
    return res;
  }

  releaseEmitter(runtime: EmitterRuntime | GpuEmitterRuntime): void {
    const gl = this.gl;
    if (runtime instanceof GpuEmitterRuntime) {
      const res = this.gpuEmitterGL.get(runtime);
      if (!res) return;
      this.disposeGpuEmitterGL(res);
      this.gpuEmitterGL.delete(runtime);
      return;
    }
    const res = this.emitterGL.get(runtime);
    if (!res) return;
    gl.deleteVertexArray(res.vao);
    gl.deleteBuffer(res.vbo);
    this.emitterGL.delete(runtime);
  }

  private disposeGpuEmitterGL(res: GpuEmitterGL): void {
    const gl = this.gl;
    for (const v of res.updateVao) gl.deleteVertexArray(v);
    for (const v of res.renderVao) gl.deleteVertexArray(v);
    for (const t of res.tf) gl.deleteTransformFeedback(t);
    for (const b of res.buffers) gl.deleteBuffer(b);
    gl.deleteTexture(res.curveTex);
  }

  /** Advance all GPU-simulated emitters one step via transform feedback. */
  private runGpuUpdates(calls: EmitterDrawCall[]): void {
    const gl = this.gl;
    if (!this.updateProgram) this.updateProgram = this.buildUpdateProgram();
    const u = this.updateUniforms;

    gl.useProgram(this.updateProgram);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.uniform1i(u.u_curves, 0);

    const seen = new Set<GpuEmitterRuntime>();
    for (const call of calls) {
      const rt = call.runtime;
      if (!(rt instanceof GpuEmitterRuntime) || seen.has(rt)) continue;
      seen.add(rt);
      const def = rt.def;
      const res = this.getGpuEmitterGL(rt);
      const frame = rt.consumeFrame();

      if (frame.reset) {
        for (const b of res.buffers) {
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(gl.ARRAY_BUFFER, res.byteLength, gl.DYNAMIC_COPY);
        }
      }
      if (frame.dt <= 0 && frame.spawnCount === 0) continue;

      gl.uniform1f(u.u_dt, frame.dt);
      gl.uniform1f(u.u_noiseT, rt.time * def.turbScroll);
      gl.uniform3f(u.u_spawnInfo, frame.spawnStart, frame.spawnCount, def.maxParticles);
      gl.uniform1f(u.u_frameSeed, frame.seed);
      gl.uniformMatrix4fv(u.u_emitterMat, false, rt.worldMatrix);
      gl.uniform1f(u.u_worldSpace, def.worldSpace ? 1 : 0);
      gl.uniform3fv(u.u_inheritVel, rt.inheritVel);
      gl.uniform3fv(u.u_gravity, rt.gravitySim);
      gl.uniformMatrix3fv(u.u_invRot, false, rt.invRot);
      gl.uniform1f(u.u_velWorld, def.velWorld ? 1 : 0);
      gl.uniform4fv(u.u_spawnLife, rt.spawnLife);
      gl.uniform4fv(u.u_spawnSize, rt.spawnSize);
      gl.uniform1f(u.u_hasSizeY, def.sizeY ? 1 : 0);
      gl.uniform4fv(u.u_spawnRot, rt.spawnRot);
      gl.uniform4fv(u.u_startColorA, rt.startColorA);
      gl.uniform4fv(u.u_startColorB, rt.startColorB);
      gl.uniform1f(u.u_startColorMode, rt.startColorMode);
      gl.uniform1f(u.u_randomizeDir, def.randomizeDirection);
      gl.uniform1f(u.u_shapeType, rt.shapeType);
      gl.uniform4fv(u.u_shapeA, rt.shapeA);
      gl.uniform4fv(u.u_turb, rt.turb);
      gl.uniform4fv(u.u_vortexA, rt.vortexA);
      gl.uniform4fv(u.u_vortexB, rt.vortexB);
      gl.uniform4fv(u.u_attrA, rt.attrA);
      gl.uniform4fv(u.u_attrB, rt.attrB);
      gl.uniform4fv(u.u_orbitA, rt.orbitA);
      gl.uniform3fv(u.u_orbitB, rt.orbitB);

      gl.bindTexture(gl.TEXTURE_2D, res.curveTex);

      const src = res.cur;
      const dst = 1 - src;
      gl.bindVertexArray(res.updateVao[src]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, res.tf[dst]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, def.maxParticles);
      gl.endTransformFeedback();
      res.cur = dst;
    }

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
  }

  /** Render a list of emitter draw calls with the given camera. */
  render(calls: EmitterDrawCall[], view: Float32Array, proj: Float32Array): void {
    if (calls.length === 0) return;
    const gl = this.gl;
    const u = this.uniforms;

    let hasGpu = false;
    for (const call of calls) {
      if (call.runtime instanceof GpuEmitterRuntime) {
        hasGpu = true;
        break;
      }
    }

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
    const prevBlendEqRGB = gl.getParameter(gl.BLEND_EQUATION_RGB) as number;
    const prevBlendEqA = gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number;
    const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
    const prevCull = gl.isEnabled(gl.CULL_FACE);
    let prevTF: WebGLTransformFeedback | null = null;
    let prevTFBuf: WebGLBuffer | null = null;
    let prevDiscard = false;
    if (hasGpu) {
      prevTF = gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING) as WebGLTransformFeedback | null;
      prevTFBuf = gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING) as WebGLBuffer | null;
      prevDiscard = gl.isEnabled(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      this.runGpuUpdates(calls);
    }

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

      if (def.blend !== currentBlend) {
        currentBlend = def.blend;
        if (def.blend === 'subtractive') {
          // Subtract src from dst (RGB only) so overlapping particles eat light
          gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
        } else {
          gl.blendEquation(gl.FUNC_ADD);
          if (def.blend === 'additive') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          else if (def.blend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          else if (def.blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
          else gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
        }
      }

      let instanceCount: number;
      if (runtime instanceof GpuEmitterRuntime) {
        const res = this.gpuEmitterGL.get(runtime)!;
        gl.bindVertexArray(res.renderVao[res.cur]);
        instanceCount = def.maxParticles;
      } else {
        const res = this.getEmitterGL(runtime);
        gl.bindVertexArray(res.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, runtime.renderData, 0, runtime.alive * INSTANCE_FLOATS);
        instanceCount = runtime.alive;
      }

      gl.uniformMatrix4fv(u.u_model, false, runtime.modelMatrix);
      gl.uniform1i(u.u_mode, MODE_INDEX[def.renderMode]);
      gl.uniform2f(u.u_stretch, def.stretchFactor, def.lengthScale);
      gl.uniform3f(u.u_flipbook, def.flipbookCols, def.flipbookRows, def.flipbookRandom ? 1 : 0);
      gl.uniform1f(u.u_scale, call.scale);
      gl.uniform1i(u.u_blendMode, BLEND_INDEX[def.blend]);
      if (def.applyTint) {
        gl.uniform4fv(u.u_tint, call.tint);
        gl.uniform1f(u.u_hueShift, call.hueShift);
      } else {
        gl.uniform4f(u.u_tint, 1, 1, 1, 1);
        gl.uniform1f(u.u_hueShift, 0);
      }

      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(call.spriteUrl));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
    }

    // ---- Restore state ----
    gl.bindVertexArray(prevVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuf);
    gl.bindTexture(gl.TEXTURE_2D, prevTex0);
    gl.activeTexture(prevActiveTex);
    gl.useProgram(prevProgram);
    if (!prevBlend) gl.disable(gl.BLEND);
    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcA, prevBlendDstA);
    gl.blendEquationSeparate(prevBlendEqRGB, prevBlendEqA);
    if (!prevDepthTest) gl.disable(gl.DEPTH_TEST);
    gl.depthMask(prevDepthMask);
    if (prevCull) gl.enable(gl.CULL_FACE);
    if (hasGpu) {
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, prevTF);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, prevTFBuf);
      if (prevDiscard) gl.enable(gl.RASTERIZER_DISCARD);
    }
  }

  dispose(): void {
    const gl = this.gl;
    for (const res of this.emitterGL.values()) {
      gl.deleteVertexArray(res.vao);
      gl.deleteBuffer(res.vbo);
    }
    this.emitterGL.clear();
    for (const res of this.gpuEmitterGL.values()) {
      this.disposeGpuEmitterGL(res);
    }
    this.gpuEmitterGL.clear();
    gl.deleteBuffer(this.quadVbo);
    gl.deleteProgram(this.program);
    if (this.updateProgram) gl.deleteProgram(this.updateProgram);
    this.textures.dispose();
  }
}
