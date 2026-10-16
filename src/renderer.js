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

// Shafts of light are drawn for one pixel in this many each way (see draw).
const SHAFT_STRIDE = 6;

export class Renderer {
  // nProbe: most levels probe() can be asked about. nView: most levels drawn.
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
      ...LEVEL_UNIFORMS, 'uN', 'uNear', 'uWall', 'uFloor', 'uRes', 'uCam', 'uTan', 'uScale', 'uFogLen', 'uMaxT', 'uFogK', 'uSky', 'uOuter', 'uOuterWall', 'uOuterFloor', 'uSkyH', 'uZenith', 'uGround', 'uFill', 'uSunK', 'uSunCol', 'uAmbient', 'uLamp', 'uLampReach', 'uGlow', 'uMirror', 'uDisc', 'uClouds', 'uStars', 'uSun', 'uShafts', 'uShaftTex', 'uInlay', 'uStride', 'uDebug', 'uThread', 'uThreadN',
    ];
    this.viewProg = link(gl, viewFrag(nView, space, nThread, true), viewUniforms);
    // The older way of finding what each pixel sees, to check the above
    // against: made the first time it is asked for (see refProg).
    this.makeRef = () => link(gl, viewFrag(nView, space, nThread, false), viewUniforms);

    this.smoothProg = link(gl, SMOOTH_FRAG, ['uTex', 'uRes']);
    // Shafts of light are drawn into this, coarser than the picture (see draw).
    this.shaftTex = null;
    this.shaftFbo = gl.createFramebuffer();
    this.shaftSize = [-1, -1];
    this.shaftTarget(1, 1);
    this.viewTex = null;
    this.viewFbo = gl.createFramebuffer();
    this.viewSize = [0, 0];

    // How long the GPU takes over each frame, where that can be timed: a
    // frame the GPU takes longer over than the display allows is shown late,
    // which nothing on this side can see.
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.timing = []; // queries not yet answered
    this.timingPaused = false;

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

  shaftTarget(w, h) {
    const gl = this.gl;
    if (this.shaftSize[0] !== w || this.shaftSize[1] !== h) {
      if (this.shaftTex) gl.deleteTexture(this.shaftTex);
      this.shaftTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shaftTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shaftFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shaftTex, 0);
      this.shaftSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shaftFbo);
  }

  draw(recs, view) {
    const gl = this.gl;
    const timed = this.timer && !this.timingPaused && !view.debug && this.timing.length < 8;
    if (timed) {
      const q = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
      this.timing.push(q);
    }
    this.drawFrame(recs, view);
    if (timed) gl.endQuery(this.timer.TIME_ELAPSED_EXT);
  }

  // GPU milliseconds for each frame timed since last asked whose time has
  // come back, oldest first. (When the GPU reports that timings were
  // disturbed, those are dropped.)
  timed() {
    const gl = this.gl, done = [];
    while (this.timing.length && gl.getQueryParameter(this.timing[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.timing.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q);
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) done.push(ns / 1e6);
    }
    return done;
  }

  drawFrame(recs, view) {
    const gl = this.gl;
    // Shafts of light are soft, and costly (a ray toward the sun from each of
    // many points along every ray): drawn first, for every SHAFT_STRIDE-th
    // pixel each way, and spread over the rest by the texture's filtering.
    if (view.scheme.shafts > 0 && !view.debug) {
      const w = Math.ceil(this.canvas.width / SHAFT_STRIDE), h = Math.ceil(this.canvas.height / SHAFT_STRIDE);
      this.shaftTarget(w, h);
      gl.viewport(0, 0, w, h);
      const p = this.setView(recs, view, SHAFT_STRIDE);
      gl.uniform1i(p.u.uDebug, 6);
      gl.activeTexture(gl.TEXTURE1); // (not the texture being drawn into)
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // (Distances for comparison are data, not a picture: no smoothing.)
    const raw = view.debug === 4;
    if (raw) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else this.viewTarget();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const p = this.setView(recs, view, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shaftTex);
    gl.uniform1i(p.u.uShaftTex, 1);
    gl.activeTexture(gl.TEXTURE0);
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
      // (Not STREAM_READ, though it is read back: for a buffer said to be for
      // reading, Chrome copies it aside at every fence, for a way of reading
      // that WebGL never takes, and warns each time that the copy was wasted.)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 16, gl.STREAM_COPY);
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
    const [w, h] = this.lookSize;
    const px = new Float32Array(w * h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.lookPbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(this.lookSync);
    this.lookSync = null;
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dist[i] = px[i * 4];
    return { w, h, dist };
  }

  // Everything the view program needs to draw recs as view describes.
  setView(recs, view, stride) {
    const gl = this.gl;
    const p = view.reference ? (this.refProg ??= this.makeRef()) : this.viewProg;
    const n = this.nView;
    gl.useProgram(p.prog);
    this.setLevels(p, recs, n);
    const wall = new Float32Array(n * 3);
    const floor = new Float32Array(n * 3);
    const near = new Float32Array(n);
    const sc = view.scheme;
    const colours = (level) => sc.stone?.(level) ?? this.space.palette(level);
    recs.forEach((r, i) => {
      near[i] = r.near;
      const c = colours(r.level);
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
    gl.uniform1f(p.u.uFogK, view.fogK);
    gl.uniform3fv(p.u.uSky, sc.sky ?? this.space.sky);
    gl.uniform1f(p.u.uSkyH, view.sky);
    gl.uniform3fv(p.u.uZenith, sc.zenith ?? this.space.zenith);
    gl.uniform3fv(p.u.uGround, sc.ground ?? this.space.roof);
    gl.uniform1f(p.u.uFill, sc.fill);
    gl.uniform1f(p.u.uSunK, sc.sun);
    gl.uniform3fv(p.u.uSunCol, sc.sunCol);
    gl.uniform1f(p.u.uAmbient, sc.ambient);
    gl.uniform1f(p.u.uLamp, sc.lamp);
    gl.uniform1f(p.u.uLampReach, sc.lampReach);
    gl.uniform1f(p.u.uGlow, sc.glow);
    gl.uniform1f(p.u.uMirror, sc.mirror);
    gl.uniform1f(p.u.uDisc, sc.disc);
    gl.uniform1f(p.u.uClouds, sc.clouds);
    gl.uniform1f(p.u.uStars, sc.stars);
    gl.uniform1f(p.u.uShafts, view.debug ? 0 : sc.shafts); // (draw() leaves them out of debugging views)
    gl.uniform1f(p.u.uInlay, sc.inlay);
    const d = Math.hypot(...sc.sunDir);
    gl.uniform3fv(p.u.uSun, sc.sunDir.map((x) => x / d));
    if (view.outer) {
      const c = colours(view.outer.level);
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
    this.timingPaused = true; // (only one timing at a time)
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    fn();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.timingPaused = false;
    gl.flush();
    for (let i = 0; i < 500 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) {
      await new Promise((r) => setTimeout(r, 4));
    }
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    gl.deleteQuery(q);
    return ns / 1e6;
  }
}
