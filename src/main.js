import { Position, DIAGONALS } from './position.js';
import { Renderer } from './renderer.js';
import { Controls } from './controls.js';
import halls from './spaces/halls.js';
import { levelSeed } from './util.js';
import { SCHEMES, loadScheme, saveScheme } from './schemes.js';
import { Pilot } from './pilot.js';

const space = halls;
const R = space.R;

// Levels looked at each frame, relative to the working level F: UP coarser
// ones (so a wall we are pressed against, many scales up, is still known
// about) and DOWN finer ones (as much as a screen can resolve).
const UP = 12;
const DOWN = 3;
// Beyond those, this many coarser levels are still asked whether we are in
// their air. We can be: flying at a surface that never happens to open, we
// come closer to it than any drawn level reaches, and it is still that
// level's room we are in. Such a level is not drawn (the numbers it would
// take are beyond the GPU's arithmetic); its surface is, as a plane.
const FAR = 60;
// Of those, the most that are drawn.
const N_VIEW = 12;

// F follows our clearance: it is kept between these, in level-F cells.
const REFINE_BELOW = 0.29 / R;
const COARSEN_ABOVE = 0.5;

const FOV_TAN = Math.tan((70 * Math.PI) / 360);
const SPEED = 1.0; // open distances per second (see step)
const N_THREAD = 64; // points in the drawn thread
const MAX_PIXEL_RATIO = 1; // canvas pixels per CSS pixel
const MIN_PIXEL_RATIO = 0.35;

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const help = document.getElementById('help');

let renderer;
try {
  renderer = new Renderer(canvas, space, UP + DOWN + 1, N_VIEW, N_THREAD);
} catch (err) {
  help.textContent = err.message;
  help.classList.add('error');
  throw err;
}
const controls = new Controls(canvas, 2 * Math.atan(FOV_TAN));
const pos = new Position(R, space.ancestorDigit, space.start);
const pilot = new Pilot(R);

let debug = 0;
let reference = false; // draw with the old ray stepping, to compare
let scheme = loadScheme(); // index into SCHEMES
let schemeShown = 0; // when the scheme last changed, to name it for a moment
let scale = 0.25; // smoothed clearance, level-F cells
let pace = 0.25; // smoothed open distance the way we are going, level-F cells
let fog = 0; // smoothed visibility, level-F cells
let fogTarget = 0;
let clearance = 0;
let sensed = []; // per probed level: clearance that level alone gives us

// One level's air distance at the point v from the camera, in level-F cells
// (what levelAir in shaders.js gives), worked out here so that nothing waits
// on the GPU.
const P = R * R;
const wrapId = (id) => id.map((x) => ((x % P) + P) % P);
function airAt(rec, v = [0, 0, 0]) {
  const L = [0, 0, 0], f = [0, 0, 0], id = [0, 0, 0], cell = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const s = rec.f[a] + v[a] * rec.sig;
    const r = Math.floor(s + 0.5);
    f[a] = s - r;
    const I = rec.L[a] + r;
    // A point on a cell boundary belongs to the cell it is just inside.
    const c = Math.floor((I - (f[a] < 0 ? 1 : 0) + 0.5) / R);
    L[a] = I - c * R;
    id[a] = rec.id[a] + c;
    cell[a] = c;
  }
  // The same along the diagonals (see Position.levels).
  const dg = { Lp: [0, 0, 0], fp: [0, 0, 0], Lm: [0, 0, 0], fm: [0, 0, 0] };
  DIAGONALS.forEach(([a, b], p) => {
    const sp = rec.fp[p] + (v[a] + v[b]) * rec.sig, sm = rec.fm[p] + (v[a] - v[b]) * rec.sig;
    const rp = Math.floor(sp + 0.5), rm = Math.floor(sm + 0.5);
    dg.fp[p] = sp - rp;
    dg.fm[p] = sm - rm;
    dg.Lp[p] = rec.Lp[p] + rp - (cell[a] + cell[b]) * R;
    dg.Lm[p] = rec.Lm[p] + rm - (cell[a] - cell[b]) * R;
  });
  return space.cellAir(L, f, wrapId(id), levelSeed(rec.level), wrapId, dg);
}

// How far we are above the ground: the one plane over which there is only
// sky (see ground in spaces/halls.js). In level-F cells, negative below it.
// Our height and the plane's are compared digit by digit from the coarsest
// level at which we have ever been anywhere but the default, so that close to
// the plane what is left is a small whole number plus our offset in the cell.
const SKY_SEE = 150; // how far we see from up there, in heights above the ground
let sky = -1e30;
function skyHeight() {
  const plane = (j) => (j < 0 ? space.ancestorDigit(j)[1] : j === 0 ? space.ground : 0);
  let acc = 0;
  for (let j = Math.min(0, pos.F, ...pos.digits.keys()); j <= pos.F; j++) acc = acc * R + pos.digit(j)[1] - plane(j);
  // (Working coarser than level 0, the plane is part of the way up our cell.)
  for (let j = pos.F + 1; j <= 0; j++) acc -= plane(j) * Math.pow(R, pos.F - j);
  return Math.max(acc + pos.frac[1], -1e30);
}

// How far the way is open in direction dir, in level-F cells, looking no
// further than LOOK times the width of the way. Each stride is the clearance
// where it starts, so everything up to the distance returned is air. The
// width is the most clearance met on the way, not the clearance here: that
// dips wherever one piece of air hands over to the next (a room to its
// doorway), though nothing there is in the way. The open sky has no width:
// there, how high we are is how big the space is.
const LOOK = 5;
const SKY_LOOK = 2;
let here = []; // the levels around us, as sense() last found them
let opened = 0; // what ahead() last found, for fw.state
function ahead(dir) {
  let t = 0, width = 0;
  const far = () => Math.max(LOOK * width, SKY_LOOK * sky);
  for (let i = 0; i < 10 && t < far() + 1e-30; i++) {
    const v = dir.map((x) => x * t);
    const built = Math.max(...here.map((r) => -airAt(r, v) / r.sig));
    const c = Math.max(sky + v[1], built);
    if (c <= 0.02 * t) break;
    width = Math.max(width, built);
    t += c;
  }
  return Math.min(t, far());
}

// The way directly away from the nearest built surface (for the tour). Out in
// the open, none: there is nothing to keep off.
function awayFrom() {
  if (!(clearance > sky)) return [0, 0, 0];
  const h = 0.25 * clearance;
  const at = (v) => Math.max(sky + v[1], ...here.map((r) => -airAt(r, v) / r.sig));
  const g = [0, 1, 2].map((a) => {
    const v = [0, 0, 0];
    v[a] = h;
    const up = at(v);
    v[a] = -h;
    return up - at(v);
  });
  const l = Math.hypot(...g);
  return l > 0 ? g.map((x) => x / l) : [0, 0, 0];
}

// Find our clearance, and move the working level to suit it.
function sense() {
  for (let i = 0; i < 8; i++) {
    here = pos.levels(pos.F - UP - FAR, pos.F + DOWN);
    here = here.filter((r) => r.level >= pos.F - UP || airAt(r) < 0);
    sensed = here.map((r) => ({ level: r.level, air: airAt(r), sig: r.sig }));
    sky = skyHeight();
    clearance = Math.max(sky, ...sensed.map((s) => -s.air / s.sig));
    if (clearance > 0 && clearance < REFINE_BELOW) {
      pos.refine();
      scale *= R;
      pace *= R;
      fog *= R;
    } else if (clearance > COARSEN_ABOVE) {
      pos.coarsen();
      scale /= R;
      pace /= R;
      fog /= R;
    } else break;
  }
  // Visibility goes by the space we are in, not by how close we are to its
  // walls: it is a multiple of the cell whose air we are floating in.
  // (Of the spaces that can be drawn: failing any, as far as those go.)
  const drawn = sensed.filter((s) => s.level >= pos.F - UP);
  const within = drawn.find((s) => s.air < 0);
  let see = within ? (space.fogK * R) / within.sig : drawn.length < sensed.length ? (space.fogK * R) / drawn[0].sig : 0;
  // Out in the open, by how high up we are.
  if (sky > 0) see = Math.max(see, SKY_SEE * sky);
  if (see > 0) fogTarget = see;
}

// The air of a level too coarse to draw, as the shader is to see it: the
// plane of its nearest surface.
function outerAir(recs) {
  let best = null;
  for (const r of recs) {
    if (r.level >= pos.F - UP) break;
    const dist = -airAt(r) / r.sig;
    if (dist > 0 && (!best || dist > best.dist)) best = { r, dist };
  }
  if (!best) return null;
  const { r, dist } = best;
  const h = 0.25 * dist;
  const g = [0, 1, 2].map((a) => {
    const v = [0, 0, 0];
    v[a] = h;
    const up = airAt(r, v);
    v[a] = -h;
    return airAt(r, v) - up;
  });
  const len = Math.hypot(...g);
  if (!(len > 0)) return null;
  return { level: r.level, dist, normal: g.map((x) => x / len) };
}

// Ease the things that should not jump: travel speed, and how far we can see.
function settle(dt) {
  scale *= Math.pow(Math.max(clearance, 1e-6) / scale, 1 - Math.exp(-dt / 0.3));
  fog *= Math.pow(fogTarget / fog, 1 - Math.exp(-dt / 1.0));
}
function settled() {
  return clearance > 0 && Math.abs(scale / clearance - 1) < 1e-3 && Math.abs(fog / fogTarget - 1) < 1e-3;
}

// Everywhere we have been, as the moves that got us there, so that it can be
// flown again in either direction. A move is a displacement in cells of the
// level it was made at, which stays meaningful however far the working level
// has since drifted. travelled is how many of the moves we are currently at
// the end of: rewinding lowers it, and the moves beyond it are the way forward
// again until we strike out somewhere new.
const trail = [];
let travelled = 0;
const TRAIL_MAX = 200000;

// wish is a velocity (from the keys) and nudge a displacement (from the mouse),
// both in clearances.
let lastMove = [0, 0, 0]; // what step() last moved us by, in level-F cells
function step(dt, wish, nudge = [0, 0, 0]) {
  lastMove = [0, 0, 0];
  // Standing still with nothing left to settle: there is nothing to do.
  if (wish.every((x) => x === 0) && nudge.every((x) => x === 0) && settled()) return 0;
  sense();
  settle(dt);
  const aim = wish.map((x, a) => x * SPEED * dt + nudge[a]);
  const size = Math.hypot(...aim);
  if (size <= 0) return 0;
  // Speed is proportional to how far the way ahead is open, and a step never
  // covers more than half of that, so nothing is ever reached, only
  // approached. Going by what is ahead and not by what is nearest means a
  // doorway or a wall alongside does not slow us, only a wall in front.
  // (Slowing down is immediate; only speeding up is eased.)
  const open = (opened = clearance > 0 ? ahead(aim.map((x) => x / size)) : 0);
  pace *= Math.pow(Math.max(open, 1e-6) / pace, 1 - Math.exp(-dt / 0.3));
  const unit = Math.min(pace, Math.max(open, 0.05 * scale));
  const asked = aim.map((x) => x * unit);
  const want = size * unit;
  const len = clearance > 0 ? Math.min(want, 0.5 * open) : want;
  if (len <= 0) return 0;
  const delta = asked.map((x) => (x * len) / want);
  pos.move(delta);
  lastMove = delta;
  trail.length = travelled;
  trail.push({ delta, F: pos.F, dt, yaw: controls.yaw, pitch: controls.pitch });
  if (trail.length > TRAIL_MAX) trail.splice(0, TRAIL_MAX / 10);
  travelled = trail.length;
  return len;
}

// The way we came, as points relative to where we are now, nearest first.
// Walking the trail backwards from here, each stretch is as long as it can be
// without straying visibly from the path: short near us, longer with distance.
function thread(reach) {
  const pts = [];
  const p = [0, 0, 0];
  let anchor = null;
  let run = 0;
  for (let i = travelled - 1; i >= 0 && pts.length < N_THREAD * 3; i--) {
    const m = trail[i];
    const k = Math.pow(R, pos.F - m.F);
    for (let a = 0; a < 3; a++) p[a] -= m.delta[a] * k;
    const far = Math.hypot(...p);
    if (!(far < reach)) break;
    if (!anchor) {
      // Begin a little way off, not in our own eye.
      if (i > 0 && far < 0.1 * scale) continue;
    } else {
      run += Math.hypot(...m.delta) * k;
      const chord = Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]);
      const size = Math.hypot(...anchor) + scale;
      if (i > 0 && run < chord + 0.004 * size && chord < 0.5 * size) continue;
    }
    anchor = p.slice();
    run = 0;
    pts.push(...p);
  }
  return new Float32Array(pts);
}

// Fly dt seconds along the trail, backwards (way = -1) or forwards again
// (way = 1), faster than it was flown. The view turns to face the way it did
// then, eased so that it never snaps.
function retrace(dt, way) {
  let budget = dt * 2.5 * controls.boost();
  let len = 0;
  let facing = null;
  while (budget > 0 && (way < 0 ? travelled > 0 : travelled < trail.length)) {
    const m = trail[way < 0 ? travelled - 1 : travelled];
    sense();
    const k = Math.pow(R, pos.F - m.F);
    pos.move(m.delta.map((x) => way * x * k));
    travelled += way;
    len += Math.hypot(...m.delta) * k;
    facing = m;
    budget -= m.dt;
  }
  facing ??= trail[Math.max(0, Math.min(trail.length - 1, way < 0 ? travelled : travelled - 1))];
  if (facing) {
    const ease = 1 - Math.exp(-dt / 0.15);
    const turn = Math.atan2(Math.sin(facing.yaw - controls.yaw), Math.cos(facing.yaw - controls.yaw));
    controls.yaw += turn * ease;
    controls.pitch += (facing.pitch - controls.pitch) * ease;
  }
  sense();
  settle(dt);
  return len;
}

// More levels have air in sight than can be drawn. In order, keep: what is
// right in front of us; the space we are in and the two levels that give its
// far walls their facade and texture; the spaces outside it; then the rest.
function mostVisible(recs) {
  const levels = recs.map((r) => r.level);
  const within = (sensed.find((s) => s.air < 0) ?? sensed[0]).level;
  const order = [
    ...levels.filter((l) => l >= pos.F - 1).reverse(),
    within, within + 1, within + 2,
    ...levels.filter((l) => l < within).reverse(),
    ...levels.slice().reverse(),
  ];
  const keep = new Set();
  for (const l of order) if (keep.size < N_VIEW && levels.includes(l)) keep.add(l);
  return recs.filter((r) => keep.has(r.level));
}

function viewNow(moved) {
  const fogLen = fog * SCHEMES[scheme].fog;
  const maxT = 4 * Math.max(fog, fogLen);
  // How far away each level's nearest air is.
  // A level with none in sight is solid as far as this frame is concerned.
  const near = new Map(sensed.map((s) => [s.level, Math.max(0, (s.air - 0.05) / s.sig - moved)]));
  // (Where we are now, which is a step on from where sense() looked.)
  const all = pos.levels(pos.F - UP - FAR, pos.F + DOWN);
  // (Out in the open, a ray into a cavity can go further: see the shader.)
  const reach = sky > 0 ? Infinity : maxT;
  let recs = all.filter((r) => r.level >= pos.F - UP && near.get(r.level) < reach);
  if (recs.length > N_VIEW) recs = mostVisible(recs);
  for (const r of recs) r.near = near.get(r.level);
  const { fwd, right, up } = controls.basis();
  const view = {
    cam: [...right, ...up, -fwd[0], -fwd[1], -fwd[2]],
    tan: FOV_TAN,
    scale,
    fogLen,
    maxT,
    fogK: space.fogK * R * SCHEMES[scheme].fog,
    debug,
    reference,
    scheme: SCHEMES[scheme],
    outer: outerAir(all),
    sky: skyHeight(),
    thread: controls.thread ? thread(50 * maxT) : null,
  };
  return { recs, view };
}

function draw(moved) {
  const { recs, view } = viewNow(moved);
  renderer.draw(recs, view);
  return recs.length;
}

// The tour's eyes: a sparse picture of distances, a few times a second, read
// back without holding anything up.
let lookAt = null, lookedAt = 0;
function look(now) {
  const got = renderer.seen();
  if (got && lookAt) pilot.see(got, lookAt.basis, lookAt.F, FOV_TAN, lookAt.res, lookAt.stride, { F: pos.F, scale, sky });
  if (renderer.lookSync || now - lookedAt < 250) return;
  const stride = Math.max(4, Math.round(canvas.width / 100));
  const { recs, view } = viewNow(0);
  if (renderer.look(recs, view, stride)) {
    lookAt = { basis: controls.basis(), F: pos.F, res: [canvas.width, canvas.height], stride };
    lookedAt = now;
  }
}

// Resolution follows frame time.
let pixelRatio = MAX_PIXEL_RATIO;
function resize() {
  const w = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const h = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function scaleLabel(F) {
  const n = Math.pow(R, Math.abs(F));
  const s = n < 1e9 ? n.toLocaleString('en-US') : n.toExponential(1).replace('e+', 'e');
  return F >= 0 ? `1 : ${s}` : `${s} : 1`;
}

// Where we are and which way we face live in the URL, so a place can be
// bookmarked or sent to someone.
function saveLocation() {
  // (Only the digits that are not what they would be anyway.)
  const digits = [...pos.digits].filter(([j, d]) => space.ancestorDigit(j).some((x, a) => x !== d[a]));
  const at = { F: pos.F, frac: pos.frac, digits, yaw: controls.yaw, pitch: controls.pitch };
  history.replaceState(null, '', '#' + btoa(JSON.stringify(at)));
}
function loadLocation() {
  try {
    const here = JSON.parse(atob(location.hash.slice(1)));
    pos.F = here.F;
    pos.frac = here.frac;
    pos.digits = new Map(here.digits);
    controls.yaw = here.yaw;
    controls.pitch = here.pitch;
    return true;
  } catch {
    return false;
  }
}

// X switches between the two ways of stepping rays, to compare them by eye;
// L between schemes (shift-L back); P starts and stops the tour, M picks its mood.
addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyX') reference = !reference;
  if (e.code === 'KeyP') {
    if (pilot.on) pilot.stop();
    else pilot.start(pos.F);
    controls.drop();
  }
  if (e.code === 'KeyM' && pilot.on) pilot.choose(pos.F);
  if (e.code === 'KeyL') {
    scheme = (scheme + (e.shiftKey ? SCHEMES.length - 1 : 1)) % SCHEMES.length;
    saveScheme(scheme);
    schemeShown = performance.now();
  }
});

addEventListener('hashchange', () => {
  if (!loadLocation()) return;
  trail.length = travelled = 0;
  sense();
  scale = Math.max(clearance, 1e-6);
  fog = fogTarget;
});

sense();
if (location.hash.length > 1 && loadLocation()) {
  sense();
} else {
  // Start in the first room along the row that has space to stand in.
  for (let i = 0; i < 40 && clearance < 0.08; i++) {
    pos.move([0, 0, 1]);
    sense();
  }
}
scale = Math.max(clearance, 1e-3);
fog = fogTarget;

// Draw only when the picture would differ from the one already showing.
let shown = '';
function present(moved) {
  resize();
  const key = [pos.F, pos.frac, controls.yaw, controls.pitch, scale.toPrecision(3), fog.toPrecision(3), controls.thread, canvas.width, canvas.height, debug, reference, scheme].join();
  if (key === shown) return false;
  shown = key;
  levelsDrawn = draw(moved);
  return true;
}

let last = performance.now();
let slow = 0, quick = 0, fps = 0, levelsDrawn = 0, unsaved = 0;
function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.1);
  controls.update(dt);
  const way = controls.retracing();
  if (way) controls.drop();
  let moved;
  if (way) moved = retrace(dt, way);
  else if (pilot.on) {
    // Flying by hand during the tour steers it: turning takes the view (the
    // tour picks its way on from wherever we end up facing), and the keys
    // and the wheel add their own travel to its.
    const steered = now - controls.turned < 800;
    const tour = pilot.fly(dt, controls, scale, awayFrom, steered).map((x) => x * controls.boost());
    const hand = controls.wish();
    moved = step(dt, tour.map((x, a) => x + hand[a]), controls.nudge(dt));
    pilot.moved(lastMove, pos.F);
  } else moved = step(dt, controls.wish(), controls.nudge(dt));

  const drew = present(moved);
  if (pilot.on) look(now);
  if (drew && raw < 0.25) {
    // Resolution gives way quickly when frames run long and returns slowly.
    fps += (1 / raw - fps) * 0.1;
    if (raw > 1 / 45) slow++;
    else slow = 0;
    if (raw < 1 / 55) quick++;
    else quick = 0;
    if (slow >= 3) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio * 0.8);
      slow = quick = 0;
    } else if (quick >= 90) {
      pixelRatio = Math.min(MAX_PIXEL_RATIO, pixelRatio * 1.1);
      quick = 0;
    }
  }
  // Once we have been still for a moment, note where.
  if (drew) unsaved = now;
  else if (unsaved && now - unsaved > 400) {
    saveLocation();
    unsaved = 0;
  }
  const sign = pos.F > 0 ? '+' : '';
  hud.textContent = `level ${sign}${pos.F}   scale ${scaleLabel(pos.F)}   ${fps.toFixed(0)} fps${reference ? '   old stepping (X)' : ''}${now - schemeShown < 2000 ? `   scheme: ${SCHEMES[scheme].name}` : ''}${pilot.on ? `   touring (${pilot.mood === 'dive' ? 'diving' : 'drifting'}${pilot.held ? ' only' : ''}, M)` : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For poking at the world from the console: fw.fly(2, {f: 1}) flies forward
// for two seconds of simulated time.
window.fw = {
  pos,
  controls,
  space,
  renderer,
  saveLocation,
  set debug(v) {
    debug = v;
  },
  set reference(v) {
    reference = !!v;
  },
  // How the two ways of stepping rays differ over the current view: the share
  // of pixels whose distance to what they hit differs by more than tol (as a
  // fraction of that distance).
  compare(w = 480, h = 360, tol = 0.02) {
    const was = [debug, reference];
    debug = 4;
    const depth = (ref) => {
      reference = ref;
      const px = this.snap(w, h);
      const out = new Float64Array(w * h);
      for (let i = 0; i < w * h; i++) out[i] = ((px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) / 16777215) * 96 - 64;
      return out;
    };
    const a = depth(true), b = depth(false); // old, new
    [debug, reference] = was;
    let off = 0, newNearer = 0;
    const where = [];
    for (let i = 0; i < w * h; i++) {
      const d = (b[i] - a[i]) * Math.LN2;
      if (Math.abs(d) > tol) {
        off++;
        if (d < 0) newNearer++;
        if (where.length < 8 && i % 97 === 0) where.push([i % w, (i / w) | 0, +a[i].toFixed(2), +b[i].toFixed(2)]);
      }
    }
    return { off: off / (w * h), newNearer: newNearer / (w * h), where };
  },
  get state() {
    return { F: pos.F, frac: pos.frac.slice(), sky, clearance, scale, pace, opened, fog, pixelRatio, fps, levelsDrawn, sensed };
  },
  fly(seconds, { f = 0, r = 0, u = 0 } = {}) {
    const { fwd, right } = controls.basis();
    const wish = [0, 1, 2].map((a) => fwd[a] * f + right[a] * r + (a === 1 ? u : 0));
    for (let i = 0; i < seconds * 60; i++) step(1 / 60, wish);
    return this.state;
  },
  // Tour for a while of simulated time, looking every quarter second (and
  // waiting for each look), calling each(t) after every look.
  async tour(seconds, each) {
    if (!pilot.on) pilot.start(pos.F);
    const log = [];
    for (let i = 0; i < seconds * 60; i++) {
      if (i % 15 === 0) {
        const stride = Math.max(4, Math.round(canvas.width / 100));
        const { recs, view } = viewNow(0);
        renderer.look(recs, view, stride);
        // (A fence's state only changes between tasks.)
        let got = null;
        for (let k = 0; k < 50 && !got; k++) {
          await new Promise((r) => {
            const c = new MessageChannel();
            c.port1.onmessage = r;
            c.port2.postMessage(0);
          });
          got = renderer.seen();
        }
        if (got) pilot.see(got, controls.basis(), pos.F, FOV_TAN, [canvas.width, canvas.height], stride, { F: pos.F, scale, sky });
        log.push({ t: i / 60, F: pos.F, mood: pilot.mood, clear: +clearance.toPrecision(3), sky: +sky.toPrecision(3), aim: !!pilot.target });
        if (each) await each(i / 60);
      }
      step(1 / 60, pilot.fly(1 / 60, controls, scale, awayFrom));
      pilot.moved(lastMove, pos.F);
    }
    return log;
  },
  pilot,
  // Draw the current view at a small size and return its pixels.
  snap(w = 480, h = 360) {
    canvas.width = w;
    canvas.height = h;
    sense();
    draw(0);
    const px = new Uint8Array(w * h * 4);
    renderer.gl.readPixels(0, 0, w, h, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, px);
    shown = '';
    return px;
  },
  // March a ray the way the shader does, but here, where it can be watched:
  // returns each step's position along the ray and every level's clearance.
  trace(dir, steps = 60, finest = Infinity) {
    const log = [];
    let t = 0;
    for (let i = 0; i < steps; i++) {
      sense();
      const unit = Math.pow(R, -pos.F);
      const seen = sensed.filter((s) => s.level <= finest);
      const d = Math.max(...seen.map((s) => -s.air / s.sig));
      log.push({ t, d: d * unit, levels: seen.filter((s) => s.level >= -1).map((s) => [s.level, s.air]) });
      if (d <= 0) break;
      pos.move(dir.map((x) => x * 0.9 * d));
      t += 0.9 * d * unit;
    }
    return log;
  },
  // Compare the JavaScript cell function with the shader's along a random
  // flight: returns the worst disagreement found, in lattice units.
  check(n = 300) {
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let worst = { diff: 0 };
    for (let i = 0; i < n; i++) {
      if (i % 10 === 0) (controls.yaw = rnd() * 6.28), (controls.pitch = (rnd() - 0.5) * 2.4);
      this.fly(0.05 + rnd() * 0.4, { f: 1 });
      const recs = pos.levels(pos.F - UP, pos.F + DOWN);
      const gpu = renderer.probe(recs);
      recs.forEach((r, j) => {
        const cpu = airAt(r);
        const diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
        if (diff > worst.diff) worst = { diff, level: r.level, F: pos.F, cpu, gpu: gpu[j] };
      });
    }
    return worst;
  },
  rewind(seconds) {
    for (let i = 0; i < Math.abs(seconds) * 60; i++) retrace(1 / 60, seconds > 0 ? -1 : 1);
    return this.state;
  },
  // GPU milliseconds per frame for the current view, at one pixel per CSS pixel.
  async bench(n = 4) {
    pixelRatio = 1;
    resize();
    sense();
    const ms = await renderer.time(() => {
      for (let i = 0; i < n; i++) levelsDrawn = draw(0);
    });
    return ms / n;
  },
};
