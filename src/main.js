import { Renderer, TAA_N } from './renderer.js';
import { Controls } from './controls.js';
import halls from './spaces/halls.js';
import arcology from './spaces/arcology.js';
import { SCHEMES, loadScheme, saveScheme } from './schemes.js';
import { Pilot } from './pilot.js';
import { Planner } from './planner.js';
import { Flight, UP, DOWN } from './flight.js';
import { Pacing } from './pacing.js';

// The worlds, and the one we are in: the one a link is in (one from before
// there were others is in the halls), or else the one last visited.
const WORLDS = [halls, arcology];
const WORLD_KEY = 'fw.world';
const space = (() => {
  let name;
  try {
    if (location.hash.length > 1) name = JSON.parse(atob(location.hash.slice(1))).world ?? 'halls';
  } catch {}
  try {
    name ??= localStorage.getItem(WORLD_KEY);
  } catch {}
  return WORLDS.find((w) => w.name === name) ?? halls;
})();
try {
  localStorage.setItem(WORLD_KEY, space.name);
} catch {}
const R = space.R;

// Of the levels around us, the most that are drawn.
const N_VIEW = 12;

const FOV_TAN = Math.tan((70 * Math.PI) / 360);
const N_THREAD = 64; // points in the drawn thread
const MAX_PIXEL_RATIO = 1; // canvas pixels per CSS pixel
const MIN_PIXEL_RATIO = 0.35;

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
  renderer = new Renderer(canvas, space, UP + DOWN + 1, N_VIEW, N_THREAD);
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
    // (How much of the picture before full resolution came back still shows.)
    fade: snapping ? 0 : fadeNow(),
    scheme: SCHEMES[scheme],
    outer: flight.outerAir(all),
    sky: flight.skyHeight(),
    sunReach: (space.sunReach ?? 0) * Math.pow(R, pos.F),
    thread: controls.thread ? flight.thread(50 * maxT, N_THREAD) : null,
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

// Resolution follows frame time. What is carved does not (review21): detail
// is sized by the picture's pixels at full resolution (lodH, their number
// down it), so that a lower resolution only samples the same geometry less
// densely, and coming to rest changes no geometry.
let pixelRatio = MAX_PIXEL_RATIO, lodH = 1;
function resize() {
  lodH = Math.max(1, Math.round(canvas.clientHeight * MAX_PIXEL_RATIO));
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

// X switches between the two ways of stepping rays, to compare them by eye;
// L between schemes (shift-L back); P starts and stops the tour; N goes
// somewhere new, shift-N to the next world; H hides and shows the legend.

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
  if (e.code === 'KeyX') reference = !reference;
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
// at full resolution again, whatever motion took it down to (at less, finer
// relief is too small to carve and shows only as texture), faded in over the
// picture at rest over FADE_MS from the first frame drawn at it (restored:
// when, -1 before that frame; frames go on being drawn until it is done:
// they can come faster than the screen shows them).
const FADE_MS = 800;
let shown = '', settled = 0, restored = 0;
function present() {
  resize();
  const keyNow = () => [pos.F, pos.frac, controls.yaw, controls.pitch, flight.scale.toPrecision(3), flight.fog.toPrecision(3), controls.thread, canvas.width, canvas.height, debug, reference, scheme].join();
  let key = keyNow();
  if (key === shown && pixelRatio < MAX_PIXEL_RATIO) {
    pixelRatio = MAX_PIXEL_RATIO;
    resize();
    key = keyNow();
    shown = key;
    settled = 0;
    restored = -1;
  }
  if (key === shown) {
    if (settled >= TAA_N && !fadeNow()) return false;
    settled++;
  } else (settled = 0), (restored = 0);
  shown = key;
  levelsDrawn = draw();
  return true;
}
const fadeNow = () => {
  if (restored === -1) restored = performance.now();
  return restored ? Math.pow(Math.max(0, 1 - (performance.now() - restored) / FADE_MS), 2) : 0;
};
// (Snapshots draw one frame as it is, without antialiasing over time.)
let snapping = false;

let last = performance.now();
let slow = 0, quick = 0, fps = 0, levelsDrawn = 0, unsaved = 0;
const pacing = new Pacing(last);
function frame(now) {
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
  hud.textContent = `level ${sign}${pos.F}   scale ${scaleLabel(pos.F)}   ${fps.toFixed(0)} fps${reference ? '   old stepping (X)' : ''}${now - schemeShown < 2000 ? `   scheme: ${SCHEMES[scheme].name}` : ''}${now < 4000 ? `   world: ${space.name}` : ''}${pilot.on ? `   touring (${pilot.phase === 'dive' ? 'diving' : 'surfacing'})` : ''}`;
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
    return { F: pos.F, frac: pos.frac.slice(), sky, clearance, scale, pace, opened, fog, pixelRatio, every: pacing.every, fps, gpuMs: pacing.gpuMs.slice(-8), levelsDrawn, sensed };
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
        const cpu = flight.airAt(r);
        const diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
        if (diff > worst.diff) worst = { diff, level: r.level, F: pos.F, cpu, gpu: gpu[j] };
      });
    }
    return worst;
  },
  rewind(seconds) {
    for (let i = 0; i < Math.abs(seconds) * 60; i++) flight.retrace(1 / 60, seconds > 0 ? -1 : 1);
    return this.state;
  },
  // GPU milliseconds per frame for the current view, at one pixel per CSS pixel.
  async bench(n = 4) {
    pixelRatio = 1;
    resize();
    flight.sense();
    const ms = await renderer.time(() => {
      for (let i = 0; i < n; i++) levelsDrawn = draw();
    });
    return ms / n;
  },
};
