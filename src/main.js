import { Renderer, TAA_N } from './renderer.js';
import { Controls } from './controls.js';
import { WORLDS } from './worlds.js';
import { SCHEMES, loadScheme, saveScheme } from './schemes.js';
import { Pilot } from './pilot.js';
import { Planner } from './planner.js';
import { Flight, UP, DOWN } from './flight.js';
import { Pacing } from './pacing.js';

// The world we are in: the one a link is in (one from before there were
// others is in the halls), or else the one last visited.
const WORLD_KEY = 'fw.world';
const space = (() => {
  let name;
  try {
    if (location.hash.length > 1) name = JSON.parse(atob(location.hash.slice(1))).world ?? 'halls';
  } catch {}
  try {
    name ??= localStorage.getItem(WORLD_KEY);
  } catch {}
  return WORLDS.find((w) => w.name === name) ?? WORLDS[0];
})();
try {
  localStorage.setItem(WORLD_KEY, space.name);
} catch {}
const R = space.R;

// Of the levels around us, the most that are drawn.
const N_VIEW = 12;
// How far from the camera, in a level's lattice units, fw.check compares the
// shader with the JavaScript.
const CHECK_REACH = 2000;

const FOV_TAN = Math.tan((70 * Math.PI) / 360);
const PIXEL_RATIO = 1; // canvas pixels per CSS pixel

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const help = document.getElementById('help');
// Whether the legend is hidden is remembered (H shows and hides it).
const HELP_KEY = 'fw.help';
try {
  if (localStorage.getItem(HELP_KEY) === 'hidden') help.classList.add('hidden');
} catch {}
function toggleHelp() {
  const hidden = help.classList.toggle('hidden');
  try {
    localStorage.setItem(HELP_KEY, hidden ? 'hidden' : 'shown');
  } catch {}
}

let renderer;
try {
  renderer = new Renderer(canvas, space, UP + DOWN + 1, N_VIEW);
  await renderer.ready();
} catch (err) {
  help.textContent = err.message;
  help.classList.add('error');
  document.getElementById('loading')?.remove();
  throw err;
}
const controls = new Controls(canvas, 2 * Math.atan(FOV_TAN));
const flight = new Flight(space, controls);
const pos = flight.pos;
const pilot = new Pilot(R);
pilot.planner = new Planner(flight);

let debug = 0;
let reference = false; // draw with the old ray stepping, to compare
let scheme = loadScheme(); // index into SCHEMES
let schemeShown = 0; // when the scheme last changed, to name it for a moment

function viewNow() {
  const fogLen = flight.fog * SCHEMES[scheme].fog;
  const maxT = 4 * Math.max(flight.fog, fogLen);
  const { recs, all } = flight.visible(maxT, N_VIEW);
  const { fwd, right, up } = controls.camera();
  const view = {
    cam: [...right, ...up, -fwd[0], -fwd[1], -fwd[2]],
    tan: FOV_TAN,
    lodH,
    scale: flight.scale,
    fogLen,
    maxT,
    fogK: space.fogK * R * SCHEMES[scheme].fog,
    debug,
    reference,
    taa: !snapping,
    // (What fraction of the pixels each way the view is drawn at: see upscale.)
    upscale: snapping ? 1 : upscale,
    scheme: SCHEMES[scheme],
    outer: flight.outerAir(all),
    sky: flight.skyHeight(),
    // (Deep down R^F is Infinity, and none times that no number at all.)
    sunReach: space.sunReach ? space.sunReach * Math.pow(R, pos.F) : 0,
  };
  return { recs, view };
}

function draw() {
  const { recs, view } = viewNow();
  renderer.draw(recs, view);
  return recs.length;
}

// Where we are, for the tour: our level, clearance, height above the ground
// and the size of the space we are in (level-F cells).
const whereNow = () => ({
  F: pos.F,
  scale: flight.scale,
  sky: flight.sky,
  room: flight.room === null ? Infinity : Math.pow(R, pos.F - flight.room),
  out: pilot.way === 'out' ? flight.outward() : null,
});

// The tour's eyes: a sparse picture of distances, a few times a second, read
// back without holding anything up.
let lookAt = null, lookedAt = 0;
function look(now) {
  const got = renderer.seen();
  if (got && lookAt) pilot.see(got, lookAt.basis, lookAt.F, FOV_TAN, lookAt.res, lookAt.stride, whereNow());
  if (renderer.lookSync || now - lookedAt < 250) return;
  const stride = Math.max(4, Math.round(canvas.width / 100));
  const { recs, view } = viewNow();
  if (renderer.look(recs, view, stride)) {
    lookAt = { basis: controls.camera(), F: pos.F, res: [canvas.width, canvas.height], stride };
    lookedAt = now;
  }
}

// Resolution follows frame time, by temporal upscaling (see TAAU_FRAG): the
// canvas stays at full resolution and only the view is drawn at fewer
// pixels, `upscale` of them each way, while we move (at rest, all of them);
// the history, at full resolution, gathers them. What is carved does not
// follow it (review21): detail is sized by the picture's pixels (lodH, their
// number down it), so that fewer pixels only sample the same geometry less
// densely, and coming to rest changes no geometry.
const MIN_UPSCALE = 0.35;
let upscale = 1, lodH = 1;
function resize() {
  lodH = Math.max(1, Math.round(canvas.clientHeight * PIXEL_RATIO));
  const w = Math.max(1, Math.round(canvas.clientWidth * PIXEL_RATIO));
  const h = lodH;
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
  const at = { world: space.name, F: pos.F, frac: pos.frac, digits, yaw: controls.yaw, pitch: controls.pitch };
  // (Where the page is framed, this may not be allowed: then it is not kept.)
  try {
    history.replaceState(null, '', '#' + btoa(JSON.stringify(at)));
  } catch {}
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

// L switches between schemes (shift-L back); P starts and stops the tour; N
// goes somewhere new, shift-N to the next world; H hides and shows the
// legend. (The old way of stepping rays, to compare by eye: fw.reference.)

// Off to the next world, somewhere in it as on a first visit.
function nextWorld() {
  try {
    localStorage.setItem(WORLD_KEY, WORLDS[(WORLDS.indexOf(space) + 1) % WORLDS.length].name);
    history.replaceState(null, '', location.pathname + location.search);
  } catch {}
  location.reload();
}

// Off to somewhere new, as on a first visit (the tour, if on, starts afresh).
function respawn() {
  flight.elsewhere(Math.random);
  renderer.reset();
  if (pilot.on) pilot.start(pos.F);
  controls.drop();
  saveLocation();
}
function toggleTour() {
  if (pilot.on) pilot.stop();
  else pilot.start(pos.F);
  controls.drop();
}
function nextScheme(by) {
  scheme = (scheme + by + SCHEMES.length) % SCHEMES.length;
  renderer.reset();
  saveScheme(scheme);
  schemeShown = performance.now();
  showScheme();
}
function showScheme() {
  for (const el of document.querySelectorAll('.scheme')) el.textContent = SCHEMES[scheme].name;
  for (const el of document.querySelectorAll('.world')) el.textContent = space.name;
}
showScheme();
addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyP') toggleTour();
  if (e.code === 'KeyL') nextScheme(e.shiftKey ? -1 : 1);
  if (e.code === 'KeyH') toggleHelp();
  if (e.code === 'KeyN') (e.shiftKey ? nextWorld : respawn)();
});
// The same, by buttons, for touch screens.
const BUTTONS = {
  tour: toggleTour,
  scheme: () => nextScheme(1),
  help: toggleHelp,
  new: respawn,
  world: nextWorld,
};
for (const [name, act] of Object.entries(BUTTONS)) {
  document.getElementById(name + '-button')?.addEventListener('click', (e) => {
    e.preventDefault();
    act();
  });
}

addEventListener('hashchange', () => {
  if (loadLocation()) flight.begin(), renderer.reset();
});
if (location.hash.length > 1 && loadLocation()) flight.begin();
else flight.elsewhere(Math.random);

// Draw only when the picture would differ from the one already showing;
// and, once it has stopped changing, as many times more as temporal
// antialiasing takes to gather all its samples of it (see TAA_N). Once still,
// drawn at full resolution again, whatever motion took it down to: the
// history carries on, so the picture sharpens over those frames.
let shown = '', settled = 0;
function present() {
  resize();
  const keyNow = () => [pos.F, pos.frac, controls.yaw, controls.pitch, flight.scale.toPrecision(3), flight.fog.toPrecision(3), canvas.width, canvas.height, upscale, debug, reference, scheme].join();
  let key = keyNow();
  if (key === shown && upscale < 1) {
    upscale = 1;
    key = keyNow();
    shown = key;
    settled = 0;
  }
  if (key === shown) {
    if (settled >= TAA_N) return false;
    settled++;
  } else settled = 0;
  shown = key;
  levelsDrawn = draw();
  return true;
}
// (Snapshots draw one frame as it is, without antialiasing over time.)
let snapping = false;

let last = performance.now();
let slow = 0, quick = 0, fps = 0, levelsDrawn = 0, unsaved = 0;
const pacing = new Pacing(last);
// (Should a frame fail, say so rather than stop without a word.)
function frame(now) {
  try {
    tick(now);
  } catch (err) {
    help.textContent = err.message;
    help.classList.add('error');
    help.classList.remove('hidden');
    throw err;
  }
}
function tick(now) {
  if (!pacing.refresh(now, renderer.timed())) {
    requestAnimationFrame(frame);
    return;
  }
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.1);
  controls.update(dt);
  const way = controls.retracing();
  if (way) controls.drop();
  let moved;
  if (way) moved = flight.retrace(dt, way);
  else if (pilot.on) {
    // Flying by hand during the tour steers it: turning takes the view (the
    // tour picks its way on from wherever we end up facing), and the keys
    // and the wheel add their own travel to its.
    const steered = now - controls.turned < 800;
    const tour = pilot.fly(dt, controls, flight.scale, () => flight.awayFrom(), steered).map((x) => x * controls.boost());
    const hand = controls.wish();
    moved = flight.step(dt, tour.map((x, a) => x + hand[a]), controls.nudge(dt));
    pilot.moved(flight.lastMove, pos.F);
  } else moved = flight.step(dt, controls.wish(), controls.nudge(dt));

  const drew = present();
  if (drew) document.getElementById('loading')?.remove();
  if (pilot.on) look(now);
  if (drew && moved && raw < 0.25) {
    // Resolution gives way quickly when frames run long and returns slowly
    // while we move (at rest it is full: see present).
    fps += (1 / raw - fps) * 0.1;
    if (raw > 1 / 45) slow++;
    else slow = 0;
    if (raw < 1 / 55) quick++;
    else quick = 0;
    // (Not for debug views or references, which are drawn at full
    // resolution, to be exact: see Renderer.drawFrame.)
    if (debug || reference) slow = quick = 0;
    if (slow >= 3) {
      upscale = Math.max(MIN_UPSCALE, upscale * 0.8);
      slow = quick = 0;
    } else if (quick >= 90) {
      upscale = Math.min(1, upscale * 1.1);
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
  hud.textContent = `level ${sign}${pos.F}   scale ${scaleLabel(pos.F)}   ${fps.toFixed(0)} fps${reference ? '   old stepping' : ''}${now - schemeShown < 2000 ? `   scheme: ${SCHEMES[scheme].name}` : ''}${now < 4000 ? `   world: ${space.name}` : ''}${pilot.on ? `   touring (${pilot.phase === 'dive' ? 'diving' : 'surfacing'})` : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For poking at the world from the console: fw.fly(2, {f: 1}) flies forward
// for two seconds of simulated time.
window.fw = {
  pos,
  flight,
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
    const { sky, clearance, scale, pace, opened, fog, sensed } = flight;
    return { F: pos.F, frac: pos.frac.slice(), sky, clearance, scale, pace, opened, fog, upscale, every: pacing.every, fps, gpuMs: pacing.gpuMs.slice(-8), levelsDrawn, sensed };
  },
  fly(seconds, { f = 0, r = 0, u = 0 } = {}) {
    const { fwd, right } = controls.basis();
    const wish = [0, 1, 2].map((a) => fwd[a] * f + right[a] * r + (a === 1 ? u : 0));
    for (let i = 0; i < seconds * 60; i++) flight.step(1 / 60, wish);
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
        const { recs, view } = viewNow();
        renderer.look(recs, view, stride);
        // (A fence's state only changes between tasks. However long the GPU
        // takes, give it up to three seconds.)
        let got = null;
        for (const until = performance.now() + 3000; !got && performance.now() < until; ) {
          await new Promise((r) => {
            const c = new MessageChannel();
            c.port1.onmessage = r;
            c.port2.postMessage(0);
          });
          got = renderer.seen();
        }
        if (got) pilot.see(got, controls.camera(), pos.F, FOV_TAN, [canvas.width, canvas.height], stride, whereNow());
        log.push({ t: i / 60, F: pos.F, phase: pilot.phase, clear: +flight.clearance.toPrecision(3), sky: +flight.sky.toPrecision(3), aim: !!pilot.target });
        if (each) await each(i / 60);
      }
      flight.step(1 / 60, pilot.fly(1 / 60, controls, flight.scale, () => flight.awayFrom()));
      pilot.moved(flight.lastMove, pos.F);
    }
    return log;
  },
  pilot,
  // The link to where we are now.
  get where() {
    saveLocation();
    return location.href;
  },
  // Draw the current view at a small size and return its pixels.
  // (live: as the app shows it, antialiased over the frames drawn before.)
  snap(w = 480, h = 360, live = false) {
    canvas.width = w;
    canvas.height = h;
    lodH = h;
    flight.sense();
    snapping = !live;
    draw();
    snapping = false;
    const px = new Uint8Array(w * h * 4);
    renderer.gl.readPixels(0, 0, w, h, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, px);
    shown = '';
    return px;
  },
  // March a ray the way the shader does, but here, where it can be watched:
  // returns each step's position along the ray and every level's clearance.
  // (We go back to where we were afterwards.)
  trace(dir, steps = 60, finest = Infinity) {
    const was = { F: pos.F, frac: pos.frac.slice(), digits: new Map([...pos.digits].map(([j, d]) => [j, d.slice()])) };
    const log = [];
    let t = 0;
    for (let i = 0; i < steps; i++) {
      flight.sense();
      const unit = Math.pow(R, -pos.F);
      const seen = flight.sensed.filter((s) => s.level <= finest);
      const d = Math.max(...seen.map((s) => -s.air / s.sig));
      log.push({ t, d: d * unit, levels: seen.filter((s) => s.level >= -1).map((s) => [s.level, s.air]) });
      if (d <= 0) break;
      pos.move(dir.map((x) => x * 0.9 * d));
      t += 0.9 * d * unit;
    }
    Object.assign(pos, was);
    flight.sense();
    return log;
  },
  // Compare the JavaScript cell function with the shader's along a random
  // flight, at the camera and at points round it out to a few cells away
  // (where cells, diagonals and slants are found from the camera's): returns
  // the worst disagreement found, in lattice units (and of those, the worst
  // where the JavaScript says there is more air than the shader: more
  // than there is, for the flight), and how many comparisons away from the
  // camera were made.
  check(n = 300, round = 15) {
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let worst = { diff: 0 }, more = { diff: 0 }, compared = 0;
    for (let i = 0; i < n; i++) {
      if (i % 10 === 0) (controls.yaw = rnd() * 6.28), (controls.pitch = (rnd() - 0.5) * 2.4);
      this.fly(0.05 + rnd() * 0.4, { f: 1 });
      const recs = pos.levels(pos.F - UP, pos.F + DOWN);
      const points = [[0, 0, 0]];
      for (let k = 0; k < round; k++) {
        const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], r = Math.pow(10, -3 + 4 * rnd()) / Math.hypot(...d);
        points.push(d.map((x) => x * r));
      }
      renderer.probe(recs, points).forEach((gpu, k) => recs.forEach((r, j) => {
        // (Only where the shader's numbers can tell: a level's lattice units
        // from the camera in single precision, no further than its cells
        // can be seen anyway.)
        if (Math.max(...points[k].map(Math.abs)) * r.sig > CHECK_REACH) return;
        compared += k > 0;
        const cpu = flight.airAt(r, points[k]);
        const diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
        if (diff <= worst.diff && !(cpu < gpu[j] && diff > more.diff)) return;
        const found = { diff, level: r.level, v: points[k], cpu, gpu: gpu[j], at: { F: pos.F, frac: pos.frac.slice(), digits: [...pos.digits].map(([j, d]) => [j, d.slice()]) } };
        if (diff > worst.diff) worst = found;
        if (cpu < gpu[j] && diff > more.diff) more = found;
      }));
    }
    return { ...worst, more, compared };
  },
  // The same for rays, where the JavaScript answers them (see hallsAir in
  // spaces/halls.js): along random directions, the axes and diagonals, from
  // the camera and points round it, how far each level says a ray goes in
  // its air and the surface it meets. The worst disagreement in reach, as a
  // multiple of what single precision can tell there (more along a ray
  // that grazes the surface); how many disagree about whether the point is
  // in air at all, or about the surface; and how many were compared.
  // (Not on a surface, nor where the answer changes within that precision:
  // there the two may rightly choose differently.)
  checkRays(n = 150, round = 15) {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const AXES = [[1, 0, 0], [0, -1, 0], [0, 0, 1], [Math.SQRT1_2, Math.SQRT1_2, 0], [0, -Math.SQRT1_2, -Math.SQRT1_2]];
    let worst = { ratio: 0 }, inAir = 0, facing = 0, compared = 0;
    for (let i = 0; i < n; i++) {
      if (i % 10 === 0) (controls.yaw = rnd() * 6.28), (controls.pitch = (rnd() - 0.5) * 2.4);
      this.fly(0.05 + rnd() * 0.4, { f: 1 });
      const recs = pos.levels(pos.F - UP, pos.F + DOWN);
      const e = i % 3 === 0 ? AXES[(i / 3) % AXES.length] : [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      const dir = e.map((x) => x / Math.hypot(...e));
      const points = [[0, 0, 0]];
      for (let k = 0; k < round; k++) {
        const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], r = Math.pow(10, -3 + 4 * rnd()) / Math.hypot(...d);
        points.push(d.map((x) => x * r));
      }
      renderer.probe(recs, points, dir).forEach((gpus, k) => recs.forEach((r, j) => {
        const far = Math.max(...points[k].map(Math.abs)) * r.sig;
        if (far > CHECK_REACH) return;
        const tol = Math.max(1e-5, 1e-6 * (far + R));
        const ray = { dir };
        const a = flight.airAt(r, points[k], ray), gpu = gpus[j];
        if (!ray.known || Math.abs(a) < tol) return;
        // (Where nudging the point by what single precision cannot tell
        // changes the answer, either is right.)
        const nudge = (s) => {
          const q = { dir };
          flight.airAt(r, points[k].map((x) => x + (s * tol) / r.sig), q);
          return q.reach;
        };
        const slant = Math.max(Math.abs(dir[0] * ray.nx + dir[1] * ray.ny + dir[2] * ray.nz), 1e-3);
        if ([nudge(1), nudge(-1)].some((x) => Math.abs(x - ray.reach) * slant > tol)) return;
        compared++;
        if (ray.reach >= 0 !== gpu.reach >= 0) {
          inAir++;
          return;
        }
        if (ray.reach < 0) return;
        const ratio = (Math.abs(ray.reach - gpu.reach) * slant) / tol;
        if (ratio > worst.ratio) worst = { ratio, level: r.level, F: pos.F, v: points[k], dir, cpu: ray.reach, gpu: gpu.reach };
        if (ratio < 1 && Math.hypot(ray.nx - gpu.n[0], ray.ny - gpu.n[1], ray.nz - gpu.n[2]) > 1e-3) facing++;
      }));
    }
    return { ...worst, inAir, facing, compared };
  },
  // (Testing upscaling: the fraction of pixels drawn, as the frame time would set it.)
  set upscale(v) { upscale = Math.min(1, Math.max(MIN_UPSCALE, v)); },
  get upscale() { return upscale; },
  rewind(seconds) {
    for (let i = 0; i < Math.abs(seconds) * 60; i++) flight.retrace(1 / 60, seconds > 0 ? -1 : 1);
    return this.state;
  },
  // GPU milliseconds per frame for the current view, at one pixel per CSS pixel.
  async bench(n = 4) {
    upscale = 1;
    resize();
    flight.sense();
    const ms = await renderer.time(() => {
      for (let i = 0; i < n; i++) levelsDrawn = draw();
    });
    return ms / n;
  },
};
