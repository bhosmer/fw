import { begin, finish, bindSampler } from './gl.js';

// The frame: what each frame of the view is drawn into, then gathered into
// the history (temporal antialiasing and upscaling: TAAU_FRAG) and shown on
// the canvas, smoothed (SMOOTH_FRAG); and the history's state.

// Temporal antialiasing: how much of the history each frame keeps, and where
// in its pixel each frame's rays go (Halton 2, 3: 16 points, from the middle).
// (Centred: the points' mean is the pixel's middle.) And the least sig of a
// level the camera's move may be read from (its lattice's precision).
const TAA_KEEP = 0.875, TAA_SIG_MIN = 1e-6;
export const TAA_N = 16;
const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) (f /= b), (r += f * (i % b)); return r; };
const HALTON = Array.from({ length: TAA_N }, (_, i) => [halton(i + 1, 2), halton(i + 1, 3)]);
const MEAN = [0, 1].map((a) => HALTON.reduce((s, p) => s + p[a], 0) / TAA_N);

export class Frame {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    // (Its programs, begun here and finished in ready.)
    this.begun = { smooth: begin(gl, SMOOTH_FRAG), taau: begin(gl, TAAU_FRAG) };
    // Two history pictures, drawn into in turn, each with its weights; and
    // what the frame before was drawn from.
    this.hist = [null, null];
    this.histW = [null, null];
    this.histFbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.histAt = 0;
    this.prev = null;
    this.frameNo = 0;
    this.still = 0;
    this.viewTex = null;
    this.viewFbo = gl.createFramebuffer();
    this.viewSize = [0, 0];
  }

  ready() {
    this.smooth = finish(this.gl, this.begun.smooth);
    this.taau = finish(this.gl, this.begun.taau);
    this.begun = null;
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
  // corner, at fewer pixels, while upscaling), then (see present) gathered
  // into the history and anti-aliased onto the canvas.
  target() {
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

  // Where in its pixel the next frame's rays go.
  jitter() {
    return HALTON[this.frameNo++ % TAA_N].map((x, a) => x - MEAN[a]);
  }

  // Forgets the history (after a jump to somewhere else).
  reset() {
    this.prev = null;
  }

  // Gathers the frame just drawn (at render pixels) into the history, with
  // its weights (see TAAU_FRAG): into the next history picture, which it
  // returns.
  resolve(recs, view, jit, render) {
    const gl = this.gl, q = this.taau;
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
    // (The history drawn into is neither of the pictures read.)
    bindSampler(gl, q, 'uCur', this.viewTex);
    bindSampler(gl, q, 'uHist', this.hist[this.histAt]);
    bindSampler(gl, q, 'uHistW', this.histW[this.histAt]);
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
    gl.uniform1i(q.u.uRange, view.history === 'range' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    for (const name of ['uCur', 'uHist', 'uHistW']) bindSampler(gl, q, name, null);
    this.histAt = out;
    this.prev = now;
    return this.hist[out];
  }

  // The frame just drawn (into target, at render pixels: jit, where in its
  // pixel), gathered into the history (taa) or not, and shown on the canvas,
  // smoothed. (After each pass, nothing it read is left bound: no picture is
  // drawn into while bound to be read.)
  present(recs, view, taa, jit, render) {
    const gl = this.gl, q = this.smooth;
    let shown = this.viewTex;
    if (taa) shown = this.resolve(recs, view, jit, render);
    else this.reset();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(q.prog);
    bindSampler(gl, q, 'uTex', shown);
    gl.uniform2f(q.u.uRes, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bindSampler(gl, q, 'uTex', null);
  }
}

// Edge anti-aliasing over the finished picture (FXAA): find each pixel that
// sits on an edge, walk along the edge both ways to see how long this stair
// step is, and blend across the edge by how far along the step the pixel is.
export const SMOOTH_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
out vec4 outColor;

const int SEARCH = 16;
const float SUBPIXEL = 0.4;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float lumaAt(vec2 uv) { return luma(texture(uTex, uv).rgb); }
float stride(int i) { return i < 5 ? 1.0 : i < 6 ? 1.5 : i < 10 ? 2.0 : i < 11 ? 4.0 : 8.0; }

void smoothed() {
  vec2 px = 1.0 / uRes;
  vec2 uv = gl_FragCoord.xy * px;
  vec3 colour = texture(uTex, uv).rgb;
  float lC = luma(colour);
  float lD = luma(textureOffset(uTex, uv, ivec2(0, -1)).rgb);
  float lU = luma(textureOffset(uTex, uv, ivec2(0, 1)).rgb);
  float lL = luma(textureOffset(uTex, uv, ivec2(-1, 0)).rgb);
  float lR = luma(textureOffset(uTex, uv, ivec2(1, 0)).rgb);
  float lMin = min(lC, min(min(lD, lU), min(lL, lR)));
  float lMax = max(lC, max(max(lD, lU), max(lL, lR)));
  float range = lMax - lMin;
  outColor = vec4(colour, 1.0);
  if (range < max(0.0312, lMax * 0.125)) return;

  float lDL = luma(textureOffset(uTex, uv, ivec2(-1, -1)).rgb);
  float lUR = luma(textureOffset(uTex, uv, ivec2(1, 1)).rgb);
  float lUL = luma(textureOffset(uTex, uv, ivec2(-1, 1)).rgb);
  float lDR = luma(textureOffset(uTex, uv, ivec2(1, -1)).rgb);
  float lDU = lD + lU, lLR = lL + lR;
  float lLC = lDL + lUL, lDC = lDL + lDR, lRC = lDR + lUR, lUC = lUR + lUL;
  float eH = abs(-2.0 * lL + lLC) + abs(-2.0 * lC + lDU) * 2.0 + abs(-2.0 * lR + lRC);
  float eV = abs(-2.0 * lU + lUC) + abs(-2.0 * lC + lLR) * 2.0 + abs(-2.0 * lD + lDC);
  bool horz = eH >= eV;

  float l1 = horz ? lD : lL, l2 = horz ? lU : lR;
  float g1 = l1 - lC, g2 = l2 - lC;
  float gScaled = 0.25 * max(abs(g1), abs(g2));
  float across = horz ? px.y : px.x;
  float lAvg;
  if (abs(g1) >= abs(g2)) { across = -across; lAvg = 0.5 * (l1 + lC); }
  else lAvg = 0.5 * (l2 + lC);

  vec2 edge = uv;
  if (horz) edge.y += across * 0.5; else edge.x += across * 0.5;
  vec2 along = horz ? vec2(px.x, 0.0) : vec2(0.0, px.y);
  vec2 uv1 = edge - along, uv2 = edge + along;
  float e1 = lumaAt(uv1) - lAvg, e2 = lumaAt(uv2) - lAvg;
  bool r1 = abs(e1) >= gScaled, r2 = abs(e2) >= gScaled;
  if (!r1) uv1 -= along;
  if (!r2) uv2 += along;
  for (int i = 2; i < SEARCH; i++) {
    if (r1 && r2) break;
    if (!r1) { e1 = lumaAt(uv1) - lAvg; r1 = abs(e1) >= gScaled; }
    if (!r2) { e2 = lumaAt(uv2) - lAvg; r2 = abs(e2) >= gScaled; }
    if (!r1) uv1 -= along * stride(i);
    if (!r2) uv2 += along * stride(i);
  }

  float d1 = horz ? uv.x - uv1.x : uv.y - uv1.y;
  float d2 = horz ? uv2.x - uv.x : uv2.y - uv.y;
  float shift = 0.5 - min(d1, d2) / (d1 + d2);
  bool rightWay = ((d1 < d2 ? e1 : e2) < 0.0) != (lC < lAvg);
  if (!rightWay) shift = 0.0;

  float lAll = (2.0 * (lDU + lLR) + lLC + lRC) / 12.0;
  float s = clamp(abs(lAll - lC) / range, 0.0, 1.0);
  s = (3.0 - 2.0 * s) * s * s;
  shift = max(shift, s * s * SUBPIXEL);

  if (horz) uv.y += shift * across; else uv.x += shift * across;
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}

void main() {
  smoothed();
}`;


// Temporal antialiasing and upscaling (.claude/design/taa.md, taau.md):
// each frame's rays go through a different point of their pixels (uJit),
// and the view may be drawn at fewer pixels (uRender of them: colour, and
// log2 of the distance to what each saw, 1e4 for nothing), gathered into a
// history the picture's size (uRes). Each pixel of it takes the frame's
// samples that fall inside it, weighed into what it has (its weight in a
// second target, at most uCap: a constant blend moving, a running average
// still); with no history (somewhere new to it), a wider gather of the
// samples around it. Its history is found by where the camera was then:
// the point its ray met, D further along (the camera's move since, in view
// units), seen through the previous camera (uPrev); kept within the range of
// the frame's samples around it, and dropped where it saw something else
// (disocclusion) or was off screen. What counts as something else (uRange:
// see VIEW in view.js): another distance than this pixel's (depth), or one
// outside those of the samples around it (range).
export const TAAU_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uCur, uHist, uHistW;
uniform vec2 uRes, uRender, uJit;
uniform mat3 uCam, uPrev;
uniform vec3 uD;
uniform float uTan, uLog, uCap;
uniform bool uHave, uStill, uRestart, uRange;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outW;

vec3 ycocg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 rgb(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }

void main() {
  vec2 x = gl_FragCoord.xy, sc = uRender / uRes, y = x * sc;
  ivec2 at = ivec2(x), k0 = ivec2(floor(y - uJit)), top = ivec2(uRender) - 1;
  // The samples around: in this pixel (box), and all, weighed by nearness
  // (wide, for want of history); their range, for what history may take;
  // and the range of their distances, and whether any saw the sky (dlo,
  // dhi, sky: for range, below).
  vec3 lo = vec3(1e9), hi = vec3(-1e9), cb = vec3(0.0), cw = vec3(0.0);
  float wb = 0.0, ww = 0.0, near = 1e9, dep = 1e4, sw = max(0.5 / min(sc.x, sc.y), 0.5);
  float dlo = 1e9, dhi = -1e9;
  bool sky = false;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 k = k0 + ivec2(i, j);
      // (Past the picture's edge there are no samples: none counted twice.)
      if (any(lessThan(k, ivec2(0))) || any(greaterThan(k, top))) continue;
      vec4 c = texelFetch(uCur, k, 0);
      vec2 d = (vec2(k) + 0.5 + uJit) / sc - x;
      vec3 yc = ycocg(c.rgb);
      lo = min(lo, yc); hi = max(hi, yc);
      if (c.a > 1e3) sky = true;
      else { dlo = min(dlo, c.a); dhi = max(dhi, c.a); }
      if (abs(d.x) < 0.5 && abs(d.y) < 0.5) { cb += c.rgb; wb += 1.0; }
      float w = exp(-dot(d, d) / (2.0 * sw * sw));
      cw += w * c.rgb; ww += w;
      if (dot(d, d) < near) { near = dot(d, d); dep = c.a; }
    }
  vec3 here = wb > 0.0 ? cb / wb : cw / ww;
  float hw = wb > 0.0 ? wb : 0.1;
  outColor = vec4(here, dep);
  outW = vec4(hw, 0.0, 0.0, 1.0);
  if (!uHave) return;
  // Still: the frames are samples of one picture, gathered as they come.
  if (uStill) {
    vec4 h = texelFetch(uHist, at, 0);
    float W = texelFetch(uHistW, at, 0).r;
    if (uRestart) W = min(W, 1.0);
    W = min(W, uCap);
    outColor = wb > 0.0 ? vec4((h.rgb * W + cb) / (W + wb), dep) : h;
    outW = vec4(min(W + wb, uCap), 0.0, 0.0, 1.0);
    return;
  }
  // Where this pixel's middle was seen the frame before (at the distance its
  // nearest sample saw: history is kept for pixels' middles).
  vec2 uv = (x * 2.0 - uRes) / uRes.y;
  vec3 rd = normalize(uCam * vec3(uv * uTan, -1.0));
  bool far = dep > 1e3;
  vec3 q = far ? rd : rd * exp2(dep) + uD;
  vec3 v = inverse(uPrev) * q; // (not square, as a shift lens: see camera in view.js)
  if (v.z >= 0.0) return;
  vec2 pv = v.xy / (-v.z * uTan);
  vec2 pp = (pv * uRes.y + uRes) * 0.5;
  if (any(lessThan(pp, vec2(0.5))) || any(greaterThan(pp, uRes - 0.5))) return;
  vec4 h = texture(uHist, pp / uRes);
  float W = texture(uHistW, pp / uRes).r;
  // (Something else was there then: a nearer or farther surface. The
  // distances are not blended, as colours may be: one of the four nearest
  // pixels must have seen this point. In the frame before's units: they
  // change with the level we are at.)
  float was = far ? 1e4 : log2(length(q)) + uLog;
  // (range: one of them saw a distance among those the samples around this
  // pixel see now, each moved as this point's has (by how far we came, and
  // the change of units; where this pixel's own sample saw the sky, by the
  // units alone), give or take as much as depth allows; or saw the sky
  // where one of them does. So a surface seen at a slant, or the near side
  // of an edge that holds still, keeps its history as we move. A point just
  // uncovered keeps what covered it only while that is still among the
  // samples around it: within a render pixel of a moving edge (the sky's,
  // leading or trailing, too), and no further than the colour clamp lets
  // it.)
  float shift = far ? uLog : was - dep;
  ivec2 c = ivec2(floor(pp - 0.5));
  bool same = false;
  for (int k = 0; k < 4; k++) {
    float a = texelFetch(uHist, clamp(c + ivec2(k & 1, k >> 1), ivec2(0), ivec2(uRes) - 1), 0).a;
    if (uRange) same = same || (a > 1e3 ? sky : dlo < 1e8 && a > dlo + shift - 0.07 && a < dhi + shift + 0.07);
    else same = same || (far ? a > 1e3 : a < 1e3 && abs(a - was) < 0.07);
  }
  if (!same) return;
  vec3 kept = rgb(clamp(ycocg(h.rgb), lo, hi));
  W = min(W, uCap);
  outColor = vec4(wb > 0.0 ? (kept * W + cb) / (W + wb) : kept, dep);
  outW = vec4(min(W + wb, uCap), 0.0, 0.0, 1.0);
}`;
