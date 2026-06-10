/** Texture loading and caching. Pluggable loader so engines can supply their own. */

export type TextureLoader = (gl: WebGL2RenderingContext, url: string) => Promise<WebGLTexture>;

export class TextureCache {
  private readonly gl: WebGL2RenderingContext;
  private readonly cache = new Map<string, WebGLTexture>();
  private readonly pending = new Map<string, Promise<WebGLTexture>>();
  readonly white: WebGLTexture;
  private loader: TextureLoader;

  constructor(gl: WebGL2RenderingContext, loader?: TextureLoader) {
    this.gl = gl;
    this.loader = loader ?? defaultLoader;
    this.white = gl.createTexture()!;
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.bindTexture(gl.TEXTURE_2D, prev);
  }

  /** Returns the cached texture immediately (white placeholder until loaded). */
  get(url: string): WebGLTexture {
    if (!url) return this.white;
    const existing = this.cache.get(url);
    if (existing) return existing;
    if (!this.pending.has(url)) {
      void this.preload(url);
    }
    return this.white;
  }

  preload(url: string): Promise<WebGLTexture> {
    const existing = this.cache.get(url);
    if (existing) return Promise.resolve(existing);
    let p = this.pending.get(url);
    if (!p) {
      p = this.loader(this.gl, url).then((tex) => {
        this.cache.set(url, tex);
        this.pending.delete(url);
        return tex;
      });
      this.pending.set(url, p);
    }
    return p;
  }

  dispose(): void {
    for (const tex of this.cache.values()) this.gl.deleteTexture(tex);
    this.cache.clear();
    this.gl.deleteTexture(this.white);
  }
}

const defaultLoader: TextureLoader = (gl, url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
      gl.activeTexture(gl.TEXTURE0);
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.activeTexture(prevActive);
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`ParticleBeast: failed to load texture "${url}"`));
    img.src = url;
  });
