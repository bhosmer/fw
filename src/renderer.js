import { VERT, SMOOTH_FRAG, probeFrag, viewFrag } from './shaders.js';
import { levelSeed } from './util.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed:\n' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl, frag, names) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program link failed:\n' + gl.getProgramInfoLog(prog));
  }
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

const LEVEL_UNIFORMS = ['uL', 'uFr', 'uId', 'uSeed', 'uSig', 'uLp', 'uFp', 'uLm', 'uFm'];

export class Renderer {
  // nProbe: levels examined at the camera each frame. nView: levels drawn.
  constructor(canvas, space, nProbe, nView, nThread) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.space = space;
    this.nProbe = nProbe;
    this.nView = nView;

    this.probeProg = link(gl, probeFrag(nProbe, space), LEVEL_UNIFORMS);
    const viewUniforms = [
      ...LEVEL_UNIFORMS, 'uN', 'uNear', 'uWall', 'uFloor', 'uRes', 'uCam', 'uTan', 'uScale', 'uFogLen', 'uMaxT', 'uSky', 'uOuter', 'uOuterWall', 'uOuterFloor', 'uSkyH', 'uZenith', 'uGround', 'uFill', 'uSunK', 'uStride', 'uDebug', 'uThread', 'uThreadN',
    ];
    this.viewProg = link(gl, viewFrag(nView, space, nThread, true), viewUniforms);
    // The older way of finding what each pixel sees, to check the above against.
    this.refProg = link(gl, viewFrag(nView, space, nThread, false), viewUniforms);

    this.smoothProg = link(gl, SMOOTH_FRAG, ['uTex', 'uRes']);
    this.viewTex = null;
    this.viewFbo = gl.createFramebuffer();
    this.viewSize = [0, 0];

    this.probeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.probeTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, nProbe, 1);
    this.probeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.probeTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.probeBuf = new Float32Array(nProbe * 4);
  }

  setLevels(p, recs, n) {
    const gl = this.gl;
    const L = new Int32Array(n * 3);
    const fr = new Float32Array(n * 3);
    const id = new Int32Array(n * 3);
    const seed = new Uint32Array(n);
    const sig = new Float32Array(n).fill(1);
    const Lp = new Int32Array(n * 3), Lm = new Int32Array(n * 3);
    const fp = new Float32Array(n * 3), fm = new Float32Array(n * 3);
    recs.forEach((r, i) => {
      Lp.set(r.Lp, i * 3);
      fp.set(r.fp, i * 3);
      Lm.set(r.Lm, i * 3);
      fm.set(r.fm, i * 3);
      L.set(r.L, i * 3);
      fr.set(r.f, i * 3);
      id.set(r.id, i * 3);
      seed[i] = levelSeed(r.level);
      sig[i] = r.sig;
    });
    gl.uniform3iv(p.u.uL, L);
    gl.uniform3fv(p.u.uFr, fr);
    gl.uniform3iv(p.u.uId, id);
    gl.uniform1uiv(p.u.uSeed, seed);
    gl.uniform1fv(p.u.uSig, sig);
    gl.uniform3iv(p.u.uLp, Lp);
    gl.uniform3fv(p.u.uFp, fp);
    gl.uniform3iv(p.u.uLm, Lm);
    gl.uniform3fv(p.u.uFm, fm);
  }

  // Each level's air distance at the camera, in that level's lattice units.
  probe(recs) {
    const gl = this.gl;
    const p = this.probeProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo);
    gl.viewport(0, 0, this.nProbe, 1);
    gl.useProgram(p.prog);
    this.setLevels(p, recs, this.nProbe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.nProbe, 1, gl.RGBA, gl.FLOAT, this.probeBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return recs.map((_, i) => this.probeBuf[i * 4]);
  }

  // The picture is drawn into a texture the size of the canvas, then
  // anti-aliased onto the canvas.
  viewTarget() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (this.viewSize[0] !== w || this.viewSize[1] !== h) {
      if (this.viewTex) gl.deleteTexture(this.viewTex);
      this.viewTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.viewTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.viewFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.viewTex, 0);
      this.viewSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.viewFbo);
  }

  draw(recs, view) {
    const gl = this.gl;
    // (Distances for comparison are data, not a picture: no smoothing.)
    const raw = view.debug === 4;
    if (raw) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else this.viewTarget();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.setView(recs, view, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (raw) return;

    const q = this.smoothProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(q.prog);
    gl.bindTexture(gl.TEXTURE_2D, this.viewTex);
    gl.uniform1i(q.u.uTex, 0);
    gl.uniform2f(q.u.uRes, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // What the view sees, sparsely: for every stride-th pixel of the canvas
  // (each drawn in as much detail as on screen), the distance to what it hits,
  // or -1 for nothing. It is read back without waiting for the GPU; seen()
  // hands it over once it has arrived. One at a time.
  look(recs, view, stride) {
    const gl = this.gl;
    if (this.lookSync) return false;
    const w = Math.ceil(this.canvas.width / stride), h = Math.ceil(this.canvas.height / stride);
    if (!this.lookTex || this.lookSize[0] !== w || this.lookSize[1] !== h) {
      if (this.lookTex) gl.deleteTexture(this.lookTex);
      this.lookTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.lookTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      this.lookFbo ??= gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lookFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lookTex, 0);
      this.lookPbo ??= gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lookPbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 16, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.lookSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lookFbo);
    gl.viewport(0, 0, w, h);
    this.setView(recs, { ...view, debug: 5, reference: false }, stride);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lookPbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lookSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return true;
  }

  seen() {
    const gl = this.gl;
    if (!this.lookSync) return null;
    const s = gl.clientWaitSync(this.lookSync, 0, 0);
    if (s !== gl.ALREADY_SIGNALED && s !== gl.CONDITION_SATISFIED) return null;
    gl.deleteSync(this.lookSync);
    this.lookSync = null;
    const [w, h] = this.lookSize;
    const px = new Float32Array(w * h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lookPbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dist[i] = px[i * 4];
    return { w, h, dist };
  }

  // Everything the view program needs to draw recs as view describes.
  setView(recs, view, stride) {
    const gl = this.gl;
    const p = view.reference ? this.refProg : this.viewProg;
    const n = this.nView;
    gl.useProgram(p.prog);
    this.setLevels(p, recs, n);
    const wall = new Float32Array(n * 3);
    const floor = new Float32Array(n * 3);
    const near = new Float32Array(n);
    recs.forEach((r, i) => {
      near[i] = r.near;
      const c = this.space.palette(r.level);
      wall.set(c.wall, i * 3);
      floor.set(c.floor, i * 3);
    });
    gl.uniform1i(p.u.uN, recs.length);
    gl.uniform1fv(p.u.uNear, near);
    gl.uniform3fv(p.u.uWall, wall);
    gl.uniform3fv(p.u.uFloor, floor);
    gl.uniform2f(p.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniformMatrix3fv(p.u.uCam, false, view.cam);
    gl.uniform1f(p.u.uTan, view.tan);
    gl.uniform1f(p.u.uScale, view.scale);
    gl.uniform1f(p.u.uFogLen, view.fogLen);
    gl.uniform1f(p.u.uMaxT, view.maxT);
    gl.uniform3fv(p.u.uSky, this.space.sky);
    gl.uniform1f(p.u.uSkyH, view.sky);
    gl.uniform3fv(p.u.uZenith, this.space.zenith);
    gl.uniform3fv(p.u.uGround, this.space.roof);
    gl.uniform1f(p.u.uFill, view.scheme.fill);
    gl.uniform1f(p.u.uSunK, view.scheme.sun);
    if (view.outer) {
      const c = this.space.palette(view.outer.level);
      gl.uniform4f(p.u.uOuter, ...view.outer.normal, view.outer.dist);
      gl.uniform3fv(p.u.uOuterWall, c.wall);
      gl.uniform3fv(p.u.uOuterFloor, c.floor);
    } else gl.uniform4f(p.u.uOuter, 0, 0, 0, -1);
    gl.uniform1i(p.u.uDebug, view.debug | 0);
    gl.uniform1f(p.u.uStride, stride);
    gl.uniform1i(p.u.uThreadN, view.thread ? view.thread.length / 3 : 0);
    if (view.thread?.length) gl.uniform3fv(p.u.uThread, view.thread);
    return p;
  }

  // GPU milliseconds taken by whatever fn draws (null if it cannot be timed).
  async time(fn) {
    const gl = this.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    fn();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();
    for (let i = 0; i < 500 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) {
      await new Promise((r) => setTimeout(r, 4));
    }
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    gl.deleteQuery(q);
    return ns / 1e6;
  }
}
