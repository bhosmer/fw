import { VERT, SMOOTH_FRAG, TAAU_FRAG, probeFrag, viewFrag, slantCount4 } from './shaders.js';
import { levelSeed } from './util.js';

// A program is built in two halves: begun (compiled and linked, without
// asking how that went, which would wait for it), then finished (its status
// checked, its uniforms found). Between them the GPU works on it while the
// page goes on (KHR_parallel_shader_compile: see Renderer.ready).
function begin(gl, frag) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  return prog;
}

function finish(gl, prog, names) {
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    for (const sh of gl.getAttachedShaders(prog))
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader compile failed:\n' + gl.getShaderInfoLog(sh));
    throw new Error('program link failed:\n' + gl.getProgramInfoLog(prog));
  }
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

const link = (gl, frag, names) => finish(gl, begin(gl, frag), names);

const LEVEL_UNIFORMS = ['uL', 'uFr', 'uId', 'uPid', 'uVolume', 'uSeed', 'uLevel', 'uSig', 'uLp', 'uFp', 'uLm', 'uFm', 'uLs', 'uFs'];

// The texture unit a space's volume is kept on (0 and 1 are the picture's).
const VOLUME_UNIT = 2;
// (And the space's other tables', from this one on.)
const TABLES_UNIT = 3;
// (And, past the tables, the upscaling history's weights while it is
// resolved: see resolve.)
const WEIGHT_UNIT = 7;

// Shafts of light are drawn for one pixel in this many each way (see draw).
const SHAFT_STRIDE = 6;

// Temporal antialiasing: how much of the history each frame keeps, and where
// in its pixel each frame's rays go (Halton 2, 3: 16 points, from the middle).
// (Centred: the points' mean is the pixel's middle.) And the least sig of a
// level the camera's move may be read from (its lattice's precision).
const TAA_KEEP = 0.875, TAA_N = 16, TAA_SIG_MIN = 1e-6;
const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) (f /= b), (r += f * (i % b)); return r; };
const HALTON = Array.from({ length: TAA_N }, (_, i) => [halton(i + 1, 2), halton(i + 1, 3)]);
const MEAN = [0, 1].map((a) => HALTON.reduce((s, p) => s + p[a], 0) / TAA_N);
const jitter = (n) => HALTON[n % TAA_N].map((x, a) => x - MEAN[a]);
export { TAA_N };

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

    // (The programs, begun here and finished in ready; parallel compiling is
    // asked for first, to cover them.)
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    const viewUniforms = [
      ...LEVEL_UNIFORMS, 'uN', 'uNear', 'uWall', 'uFloor', 'uRes', 'uCam', 'uTan', 'uScale', 'uFogLen', 'uMaxT', 'uFogK', 'uSky', 'uOuter', 'uOuterWall', 'uOuterFloor', 'uSkyH', 'uSunReach', 'uZenith', 'uGround', 'uFill', 'uSunK', 'uSunCol', 'uAmbient', 'uLamp', 'uLampReach', 'uGlow', 'uMirror', 'uDisc', 'uClouds', 'uStars', 'uSun', 'uShafts', 'uShaftTex', 'uInlay', 'uStride', 'uDebug', 'uThread', 'uThreadN', 'uJitter', 'uLodH', 'uToOut', 'uShaftAt', 'uShaftN',
    ];
    this.pending = [
      ['probeProg', probeFrag(nProbe, space), LEVEL_UNIFORMS],
      ['viewProg', viewFrag(nView, space, nThread, true), viewUniforms],
      ['smoothProg', SMOOTH_FRAG, ['uTex', 'uRes']],
      ['taauProg', TAAU_FRAG, ['uCur', 'uHist', 'uHistW', 'uRes', 'uRender', 'uJit', 'uCam', 'uPrev', 'uD', 'uTan', 'uLog', 'uCap', 'uHave', 'uStill', 'uRestart']],
    ].map(([key, frag, names]) => ({ key, names, prog: begin(gl, frag) }));
    // The older way of finding what each pixel sees, to check the above
    // against: made the first time it is asked for (see refProg).
    this.makeRef = () => link(gl, viewFrag(nView, space, nThread, false), viewUniforms);

    // Temporal antialiasing and upscaling (see TAAU_FRAG): two history
    // pictures, drawn into in turn, each with its weights; and what the frame
    // before was drawn from.
    this.hist = [null, null];
    this.histW = [null, null];
    this.histFbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.histAt = 0;
    this.prev = null;
    this.frameNo = 0;
    this.still = 0;
    // The texture unit a space's volume is kept on (0 and 1 are the picture's).

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

    // What a space keeps as a table rather than works out (see volume in
    // spaces/halls.js): a 3D texture of pairs (or fours) of unsigned integers, on a
    // unit of its own.
    this.volume = null;
    if (space.volume) {
      const { size, data, words } = space.volume;
      this.volume = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + VOLUME_UNIT);
      gl.bindTexture(gl.TEXTURE_3D, this.volume);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const [inner, form] = words === 4 ? [gl.RGBA32UI, gl.RGBA_INTEGER] : [gl.RG32UI, gl.RG_INTEGER];
      gl.texImage3D(gl.TEXTURE_3D, 0, inner, size[0], size[1], size[2], 0, form, gl.UNSIGNED_INT, data);
      gl.activeTexture(gl.TEXTURE0);
    }
    this.tables = (space.tables ?? []).map(({ name, size, data }, i) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + TABLES_UNIT + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, size[0], size[1], 0, gl.RGBA_INTEGER, gl.INT, data);
      gl.activeTexture(gl.TEXTURE0);
      return { name, tex, unit: TABLES_UNIT + i };
    });
  }

  // Once the GPU has built the programs (asked without waiting, where it can
  // say), finishes them: nothing is drawn before. (Their errors are thrown
  // here.)
  async ready() {
    const gl = this.gl, par = this.parallel;
    while (par && !this.pending.every(({ prog }) => gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR))) await new Promise((r) => setTimeout(r, 16));
    for (const { key, prog, names } of this.pending) this[key] = finish(gl, prog, names);
    this.pending = null;
  }

  setLevels(p, recs, n) {
    const gl = this.gl;
    const L = new Int32Array(n * 3);
    const fr = new Float32Array(n * 3);
    const id = new Int32Array(n * 3);
    const pid = new Int32Array(n * 3);
    const seed = new Uint32Array(n);
    const level = new Int32Array(n);
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
      pid.set(r.pid, i * 3);
      seed[i] = levelSeed(r.level);
      level[i] = r.level;
      sig[i] = r.sig;
    });
    gl.uniform3iv(p.u.uL, L);
    gl.uniform3fv(p.u.uFr, fr);
    gl.uniform3iv(p.u.uId, id);
    gl.uniform3iv(p.u.uPid, pid);
    if (this.volume) {
      gl.activeTexture(gl.TEXTURE0 + VOLUME_UNIT);
      gl.bindTexture(gl.TEXTURE_3D, this.volume);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(p.u.uVolume, VOLUME_UNIT);
    }
    p.tables ??= this.tables.map((t) => gl.getUniformLocation(p.prog, t.name));
    this.tables.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + t.unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(p.tables[i], t.unit);
    });
    gl.uniform1uiv(p.u.uSeed, seed);
    gl.uniform1iv(p.u.uLevel, level);
    gl.uniform1fv(p.u.uSig, sig);
    gl.uniform3iv(p.u.uLp, Lp);
    gl.uniform3fv(p.u.uFp, fp);
    gl.uniform3iv(p.u.uLm, Lm);
    gl.uniform3fv(p.u.uFm, fm);
    const k4 = slantCount4(this.space);
    if (k4) {
      const Ls = new Int32Array(n * k4 * 4), Fs = new Float32Array(n * k4 * 4);
      recs.forEach((r, i) => {
        Ls.set(r.Ls, i * k4 * 4);
        Fs.set(r.fs, i * k4 * 4);
      });
      gl.uniform4iv(p.u.uLs, Ls);
      gl.uniform4fv(p.u.uFs, Fs);
    }
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

  // A picture: colour, and in alpha the log of the distance to what each pixel saw.
  picture(w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // The picture is drawn into a texture the size of the canvas (into its
  // corner, at fewer pixels, while upscaling), then (see drawFrame) gathered
  // into the history and anti-aliased onto the canvas.
  viewTarget() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (this.viewSize[0] !== w || this.viewSize[1] !== h) {
      const drop = (t) => t && gl.deleteTexture(t);
      drop(this.viewTex);
      this.viewTex = this.picture(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.viewFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.viewTex, 0);
      for (let i = 0; i < 2; i++) {
        drop(this.hist[i]);
        this.hist[i] = this.picture(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.histFbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hist[i], 0);
        drop(this.histW[i]);
        this.histW[i] = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.histW[i]);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.histW[i], 0);
      }
      this.prev = null;
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
      gl.bindTexture(gl.TEXTURE_2D, null);
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
    // (Temporal upscaling: the view, and its shafts, drawn at fewer pixels,
    // `render` of them, into the picture-sized textures' corner.)
    const W = this.canvas.width, H = this.canvas.height;
    // (Not debug views or references, which are drawn at full resolution, to
    // be exact.)
    const up = !!view.taa && !view.debug && !view.reference;
    const s = up ? view.upscale : 1;
    const render = [Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s))];
    const toOut = [W / render[0], H / render[1]];
    const shaftN = [Math.ceil(render[0] / SHAFT_STRIDE), Math.ceil(render[1] / SHAFT_STRIDE)];
    if (view.scheme.shafts > 0 && !view.debug) {
      this.shaftTarget(Math.ceil(W / SHAFT_STRIDE), Math.ceil(H / SHAFT_STRIDE));
      gl.viewport(0, 0, ...shaftN);
      const p = this.setView(recs, view, SHAFT_STRIDE);
      gl.uniform2f(p.u.uToOut, ...toOut);
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
    gl.viewport(0, 0, ...render);
    const p = this.setView(recs, view, 1);
    gl.uniform2f(p.u.uToOut, ...toOut);
    if (up) {
      gl.uniform2f(p.u.uShaftAt, 1 / SHAFT_STRIDE, 1 / SHAFT_STRIDE);
      gl.uniform2i(p.u.uShaftN, ...shaftN);
    }
    const taa = !!view.taa && !raw && !view.debug;
    const jit = taa ? jitter(this.frameNo++) : [0, 0];
    gl.uniform2f(p.u.uJitter, ...jit);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shaftTex);
    gl.uniform1i(p.u.uShaftTex, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (raw) return;

    let shown = this.viewTex;
    if (taa) shown = this.resolve(recs, view, jit, render);
    else this.prev = null;
    const q = this.smoothProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(q.prog);
    gl.bindTexture(gl.TEXTURE_2D, shown);
    gl.uniform1i(q.u.uTex, 0);
    gl.uniform2f(q.u.uRes, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Forgets the history (after a jump to somewhere else).
  reset() {
    this.prev = null;
  }

  // Gathers the frame just drawn (at render pixels) into the history, with
  // its weights (see TAAU_FRAG): into the next history picture, which it
  // returns.
  resolve(recs, view, jit, render) {
    const gl = this.gl, q = this.taauProg;
    const now = { cam: view.cam, levels: new Map(recs.map((r) => [r.level, { id: [...r.id, ...r.pid].join(), at: r.L.map((x, a) => x + r.f[a]), sig: r.sig }])) };
    // How far the camera has moved since, in view units: by the finest level
    // drawn both times whose cell (and its parent's, so as not to be fooled
    // by a cell id repeating further on) is the same; and not by a level so
    // coarse that its lattice cannot say. And how the view's units have
    // changed with the level we are at (log2 of their ratio).
    let D = null;
    if (this.prev)
      for (const [lv, n] of now.levels) {
        const o = this.prev.levels.get(lv);
        if (o && o.id === n.id && n.sig > TAA_SIG_MIN && (D === null || n.sig > D.sig)) D = { sig: n.sig, d: n.at.map((x, a) => (x - o.at[a]) / n.sig), log: Math.log2(n.sig / o.sig) };
      }
    // (Still: nothing about the view has changed, so the frames are samples
    // of one picture, to be averaged; else history is checked and clamped.)
    const still = D && D.d.every((x) => x === 0) && D.log === 0 && view.cam.every((x, i) => x === this.prev.cam[i]);
    // (Still, but drawn at another size than the frame before: the still
    // average starts over, counting what was before as one frame.)
    const resized = !this.lastRender || render[0] !== this.lastRender[0] || render[1] !== this.lastRender[1];
    this.lastRender = render;
    this.still = still ? (resized ? 1 : Math.min(this.still + 1, TAA_N - 1)) : 0;
    const out = 1 - this.histAt;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.histFbo[out]);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(q.prog);
    // (Units 0, 1 and WEIGHT_UNIT: the history drawn into is none of them.)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.viewTex);
    gl.uniform1i(q.u.uCur, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hist[this.histAt]);
    gl.uniform1i(q.u.uHist, 1);
    gl.activeTexture(gl.TEXTURE0 + WEIGHT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.histW[this.histAt]);
    gl.uniform1i(q.u.uHistW, WEIGHT_UNIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(q.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(q.u.uRender, ...render);
    gl.uniform2f(q.u.uJit, ...jit);
    gl.uniformMatrix3fv(q.u.uCam, false, view.cam);
    gl.uniformMatrix3fv(q.u.uPrev, false, this.prev ? this.prev.cam : view.cam);
    gl.uniform3f(q.u.uD, ...(D ? D.d : [0, 0, 0]));
    gl.uniform1f(q.u.uTan, view.tan);
    gl.uniform1f(q.u.uLog, D ? D.log : 0);
    // (At most KEEP's worth of frames' weight moving (a blend of 1 - KEEP of
    // each frame), TAA_N - 1 still; the first still frame counts what was
    // before as one.)
    gl.uniform1f(q.u.uCap, still ? TAA_N - 1 : TAA_KEEP / (1 - TAA_KEEP));
    gl.uniform1i(q.u.uHave, D ? 1 : 0);
    gl.uniform1i(q.u.uStill, still ? 1 : 0);
    gl.uniform1i(q.u.uRestart, still && this.still === 1 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.activeTexture(gl.TEXTURE0 + WEIGHT_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    this.histAt = out;
    this.prev = now;
    this.lastD = D;
    return this.hist[out];
  }

  // What the view sees, sparsely: for every stride-th pixel of the canvas
  // (each drawn in as much detail as on screen), the distance to what it hits,
  // or -1 for nothing. It is read back without waiting for the GPU; seen()
  // hands it over once it has arrived. One at a time.
  look(recs, view, stride) {
    const gl = this.gl;
    if (this.lookSync) return false;
    // (What the tour sees is sized by the canvas as it is, not as shown.)
    view = { ...view, lodH: this.canvas.height };
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
    gl.uniform1f(p.u.uLodH, view.lodH ?? this.canvas.height);
    gl.uniformMatrix3fv(p.u.uCam, false, view.cam);
    gl.uniform1f(p.u.uTan, view.tan);
    gl.uniform1f(p.u.uScale, view.scale);
    gl.uniform1f(p.u.uFogLen, view.fogLen);
    gl.uniform1f(p.u.uMaxT, view.maxT);
    gl.uniform1f(p.u.uFogK, view.fogK);
    gl.uniform3fv(p.u.uSky, sc.sky ?? this.space.sky);
    gl.uniform1f(p.u.uSkyH, view.sky);
    gl.uniform1f(p.u.uSunReach, view.sunReach);
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
    gl.uniform2f(p.u.uJitter, 0, 0);
    gl.uniform2f(p.u.uToOut, 1, 1);
    // (On its own unit, which no pass draws into while it is bound there.)
    gl.uniform1i(p.u.uShaftTex, 1);
    // (The shafts' texture as drawn for the whole canvas: see drawFrame.)
    const sn = this.shaftTex ? this.shaftSize : [1, 1];
    gl.uniform2f(p.u.uShaftAt, sn[0] / this.canvas.width, sn[1] / this.canvas.height);
    gl.uniform2i(p.u.uShaftN, ...sn);
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
