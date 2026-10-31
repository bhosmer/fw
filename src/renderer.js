import { PROBE_POINTS, probeFrag, viewFrag, slantCount4, slantSlots } from './shaders.js';
import { levelSeed } from './util.js';
import { begin, finish, link, bindSampler } from './gl.js';
import { Frame } from './frame.js';
import { Look } from './look.js';
import { LIGHTS, lightOf } from './schemes.js';

// The drawing: each space's programs (the view, and the older way of
// drawing and the probe, made when asked for) and its tables; the levels
// and the view given to them; each frame drawn (into the frame: see
// frame.js) and timed; the tour's look (see look.js); and the probe.
export class Renderer {
  // nProbe: most levels probe() can be asked about. nView: most levels drawn.
  constructor(canvas, space, nProbe, nView) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.nProbe = nProbe;
    this.nView = nView;

    // (The programs, begun as they are made (the frame's, and each space's
    // in addSpace) and finished in ready; parallel compiling is asked for
    // first, to cover them.)
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    // What each frame is drawn into, and gathered and shown from; and the
    // tour's look.
    this.frame = new Frame(gl, canvas);
    this.tourLook = new Look(gl, canvas);

    // How long the GPU takes over each frame, where that can be timed: a
    // frame the GPU takes longer over than the display allows is shown late,
    // which nothing on this side can see.
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.timing = []; // queries not yet answered
    this.timingPaused = false;

    this.probeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.probeTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 2 * nProbe, PROBE_POINTS);
    this.probeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.probeTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.probeBuf = new Float32Array(2 * nProbe * PROBE_POINTS * 4);

    // The space drawn (and any others added: see addSpace).
    this.entries = new Map();
    this.addSpace(space);
    this.setSpace(space);
  }

  // A space to draw (besides any others: setSpace picks which): its view
  // program, begun now and finished in ready; the older way of finding what
  // each pixel sees, to check that against, and the probe, which checks the
  // JavaScript twin against the shader (see probe), both made the first time
  // they are asked for; and what it keeps as tables, as textures.
  addSpace(space) {
    if (this.entries.has(space)) return;
    const gl = this.gl, { nView, nProbe } = this;
    const e = {
      begun: begin(gl, viewFrag(nView, space, true)),
      viewProg: null,
      makeRef: () => link(gl, viewFrag(nView, space, false)),
      makeProbe: () => link(gl, probeFrag(nProbe, space)),
      // (Its textures, by the name of the sampler that reads each, with
      // the kind of texture it is.)
      textures: {},
    };
    // What a space keeps as a table rather than works out (see volume in
    // worlds.js): a 3D texture of pairs (or fours) of unsigned
    // integers (bound to its program's unit whenever a program that reads it
    // draws).
    const volume = space.volume, volumeTex = gl.createTexture();
    e.textures.uVolume = [gl.TEXTURE_3D, volumeTex];
    gl.bindTexture(gl.TEXTURE_3D, volumeTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const [inner, form] = volume.words === 4 ? [gl.RGBA32UI, gl.RGBA_INTEGER] : [gl.RG32UI, gl.RG_INTEGER];
    gl.texImage3D(gl.TEXTURE_3D, 0, inner, volume.size[0], volume.size[1], volume.size[2], 0, form, gl.UNSIGNED_INT, volume.data);
    gl.bindTexture(gl.TEXTURE_3D, null);
    for (const { name, size, data } of space.tables) {
      const tex = gl.createTexture();
      e.textures[name] = [gl.TEXTURE_2D, tex];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, size[0], size[1], 0, gl.RGBA_INTEGER, gl.INT, data);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.entries.set(space, e);
  }

  // Draw space (added already, and made ready: see ready) from now on:
  // afresh, the history being another's.
  setSpace(space) {
    const e = this.entries.get(space);
    if (!e) throw new Error('renderer: a space it was not given');
    if (e.begun && this.entry) throw new Error('renderer: a space whose program is not ready');
    this.space = space;
    this.entry = e;
    this.reset();
  }

  // Once the GPU has built the programs (asked without waiting, where it can
  // say), finishes them: nothing is drawn before. (Their errors are thrown
  // here.)
  async ready() {
    const gl = this.gl, par = this.parallel, entries = [...this.entries.values()].filter((e) => e.begun);
    const progs = [...Object.values(this.frame.begun ?? {}), ...entries.map((e) => e.begun)];
    while (par && !progs.every((prog) => gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR))) await new Promise((r) => setTimeout(r, 16));
    if (this.frame.begun) this.frame.ready();
    // (Each once, should two wait at once.)
    for (const e of entries) if (e.begun) (e.viewProg = finish(gl, e.begun)), (e.begun = null);
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
    // (Every sampler the program has, its space's texture: none left to read
    // whatever else is bound.)
    for (const name of Object.keys(p.units)) {
      const t = this.entry.textures[name];
      if (!t) throw new Error(`renderer: the program samples ${name}, which its space has no texture for`);
      bindSampler(gl, p, name, t[1], t[0]);
    }
    gl.uniform1uiv(p.u.uSeed, seed);
    gl.uniform1iv(p.u.uLevel, level);
    gl.uniform1fv(p.u.uSig, sig);
    gl.uniform3iv(p.u.uLp, Lp);
    gl.uniform3fv(p.u.uFp, fp);
    gl.uniform3iv(p.u.uLm, Lm);
    gl.uniform3fv(p.u.uFm, fm);
    // (How far we are above the ground, as the levels' records say it (the same
    // in each: see Position.levels); 1e30, none.)
    gl.uniform1f(p.u.uGroundH, Math.min(recs[0]?.ground ?? Infinity, 1e30));
    const k4 = slantCount4(this.space);
    if (k4) {
      // (Only the levels that ask after slants have theirs: see slantLevels in worlds.js.)
      const sl = this.space.slantLevels, slots = sl ? sl[1] - sl[0] + 1 : n, at = slantSlots(this.space, recs.map((r) => r.level));
      const Ls = new Int32Array(slots * k4 * 4), Fs = new Float32Array(slots * k4 * 4);
      recs.forEach((r, i) => {
        if (at[i] < 0) return;
        Ls.set(r.Ls, at[i] * k4 * 4);
        Fs.set(r.fs, at[i] * k4 * 4);
      });
      gl.uniform4iv(p.u.uLs, Ls);
      gl.uniform4fv(p.u.uFs, Fs);
      if (sl) gl.uniform1iv(p.u.uSlantSlot, Int32Array.from({ length: n }, (_, i) => at[i] ?? -1));
    }
  }

  // Each level's air distance, in that level's lattice units, at each of the
  // points (camera-relative, level-F cells; at most PROBE_POINTS): a list
  // per point of one per level. With dir, for a ray from each along it: of
  // each, { a: the distance, reach: how far it goes in that level's air
  // (lattice units; less than 0, none), n: the surface it meets there }.
  // Each level's air is cut off at the ground as its record says, as the
  // JavaScript's is (see airAt in air.js); ground: false asks the cells as
  // they are.
  probe(recs, points = [[0, 0, 0]], dir = null, { ground = true } = {}) {
    const gl = this.gl;
    const p = (this.entry.probeProg ??= this.entry.makeProbe());
    const n = this.nProbe, b = this.probeBuf;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo);
    gl.viewport(0, 0, 2 * n, points.length);
    gl.useProgram(p.prog);
    this.setLevels(p, recs, n);
    gl.uniform3fv(p.u.uProbeV, new Float32Array(points.flat()));
    gl.uniform3fv(p.u.uProbeDir, dir ?? [0, 0, 0]);
    if (!ground) gl.uniform1f(p.u.uGroundH, 1e30);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 2 * n, points.length, gl.RGBA, gl.FLOAT, b);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = (k, i) => (k * 2 * n + i) * 4;
    return points.map((_, k) =>
      recs.map((_, i) => (dir ? { a: b[px(k, 2 * i)], reach: b[px(k, 2 * i) + 1], n: [...b.subarray(px(k, 2 * i + 1), px(k, 2 * i + 1) + 3)] } : b[px(k, 2 * i)])),
    );
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
    const gl = this.gl, frame = this.frame;
    // (Temporal upscaling: the view drawn at fewer pixels, `render` of them,
    // into the picture-sized textures' corner.)
    const W = this.canvas.width, H = this.canvas.height;
    // (Not debug views or references, which are drawn at full resolution, to
    // be exact.)
    const up = !!view.taa && !view.debug && !view.reference;
    const s = up ? view.upscale : 1;
    const render = [Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s))];
    const toOut = [W / render[0], H / render[1]];
    // (Distances for comparison are data, not a picture: no smoothing.)
    const raw = view.debug === 4;
    if (raw) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else frame.target();
    gl.viewport(0, 0, ...render);
    const p = this.setView(recs, view, 1);
    gl.uniform2f(p.u.uToOut, ...toOut);
    const taa = !!view.taa && !raw && !view.debug;
    const jit = taa ? frame.jitter() : [0, 0];
    gl.uniform2f(p.u.uJitter, ...jit);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!raw) frame.present(recs, view, taa, jit, render);
  }

  // Forgets the history (after a jump to somewhere else).
  reset() {
    this.frame.reset();
  }

  // What the view sees, sparsely, for the tour (see Look.look), drawn with
  // the view's program; once it has arrived, handed over (seen); and
  // whether one is on its way.
  look(recs, view, stride) {
    return this.tourLook.look((v, st) => (this.setView(recs, v, st), this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)), view, stride);
  }
  seen() {
    return this.tourLook.seen();
  }
  get looking() {
    return this.tourLook.looking;
  }

  // Everything the view program needs to draw recs as view describes.
  setView(recs, view, stride) {
    const gl = this.gl;
    const e = this.entry, p = view.reference ? (e.refProg ??= e.makeRef()) : e.viewProg;
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
    gl.uniform1f(p.u.uSkyH, view.sky);
    // (The scheme's lights, as SCHEME has them.)
    for (const l of LIGHTS) {
      const v = lightOf(sc, l.name, this.space);
      if (l.type === 'float') gl.uniform1f(p.u[l.uniform], v);
      else gl.uniform3fv(p.u[l.uniform], v);
    }
    // (The outer plane, if any, and its colours; with none, off, and the
    // colours of the level just coarser than the first drawn, which a level
    // that colours its surfaces as the one coarser than it (gSkin) takes when
    // that level is not drawn.)
    const outer = view.outer ? colours(view.outer.level) : recs.length ? colours(recs[0].level - 1) : { wall: [0, 0, 0], floor: [0, 0, 0] };
    gl.uniform4f(p.u.uOuter, ...(view.outer ? [...view.outer.normal, view.outer.dist] : [0, 0, 0, -1]));
    gl.uniform3fv(p.u.uOuterWall, outer.wall);
    gl.uniform3fv(p.u.uOuterFloor, outer.floor);
    gl.uniform1i(p.u.uWide, view.wide ?? 0);
    gl.uniform1f(p.u.uValid, Math.min(view.valid ?? Infinity, 1e30));
    gl.uniform1i(p.u.uDebug, view.debug | 0);
    gl.uniform1f(p.u.uStride, stride);
    gl.uniform2f(p.u.uJitter, 0, 0);
    gl.uniform2f(p.u.uToOut, 1, 1);
    return p;
  }

  // GPU milliseconds taken by whatever fn draws (null if it cannot be timed).
  async time(fn) {
    const gl = this.gl;
    const ext = this.timer;
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
