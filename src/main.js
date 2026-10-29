import { Renderer, TAA_N } from './renderer.js';
import { Controls } from './controls.js';
import { WORLDS, makeWorld, fromLink, ADDED } from './worlds.js';
import { SCHEMES, loadScheme, saveScheme } from './schemes.js';
import { Pilot, awayFrom, outward } from './pilot.js';
import { Planner } from './planner.js';
import { Flight, UP, DOWN } from './flight.js';
import { elsewhere } from './arrival.js';
import { visible, outerAir } from './view.js';
import { trace, check, checkRays, compareRays } from './debug.js';
import { Pacing } from './pacing.js';

const help = document.getElementById('help');
// (Where the app cannot start, it says why, in place of the legend.)
function cannot(err) {
  help.textContent = err.message;
  help.classList.add('error');
  help.classList.remove('hidden');
  document.getElementById('loading')?.remove();
  throw err;
}

// The world we are in: the one a link names (?variant&part=value: see
// fromLink in worlds.js), or that the place in a link is in (one from
// before there were others is in the halls), or else the one last visited;
// made from its definition with the link's changes. And, where the link
// names one to compare it with (&vs=...), that one too (other), on the same
// lattice: V flips between them.
const WORLD_KEY = 'fw.world';
let world, other = null, link;
try {
  link = fromLink(location.search);
  let name = link.name;
  try {
    if (!name && location.hash.length > 1) name = JSON.parse(atob(location.hash.slice(1))).world ?? 'halls';
  } catch {}
  try {
    name ??= localStorage.getItem(WORLD_KEY);
  } catch {}
  if (!name || (!link.name && !WORLDS.includes(name))) name = WORLDS[0];
  world = await makeWorld(name, link.changes);
  if (link.vs) {
    try {
      other = await makeWorld(link.vs.name, link.vs.changes);
    } catch (err) {
      throw new Error(`vs: ${err.message}`);
    }
    if (other.space.R !== world.space.R) throw new Error(`vs: ${link.vs.name} is not on ${name}'s lattice: they cannot be compared`);
    if (other.space.glsl === world.space.glsl) throw new Error(`vs: ${link.vs.name} is the same world as ${name}, as the link changes them`);
  }
} catch (err) {
  cannot(err);
}
// (The world shown: the first, or, flipped, the other: side 0 or 1.)
let space = world.space, side = 0, flippedAt = -Infinity;
// (A variant is the link's: what is remembered is the world it is of.)
try {
  localStorage.setItem(WORLD_KEY, world.base);
} catch {}
// What each world is called, with the changes its link makes (the other's:
// those both share, and its own).
const changed = location.search.slice(1).split('&').map(decodeURIComponent).filter((x) => x.includes('=') && !ADDED.test(x.split('=')[0]) && x.split('=')[0] !== 'vs');
const labels = [
  [world.name, ...changed.filter((x) => !x.startsWith('vs.'))].join(' '),
  other ? [link.vs.name, ...changed.filter((x) => !x.startsWith('vs.')), ...changed.filter((x) => x.startsWith('vs.')).map((x) => x.slice(3))].join(' ') : '',
];
const worldLabel = () => (other ? `${side ? 'B' : 'A'}: ${labels[side]}` : labels[0]);
const R = space.R;

// Of the levels around us, the most that are drawn.
const N_VIEW = 12;

const FOV_TAN = Math.tan((70 * Math.PI) / 360);
const PIXEL_RATIO = 1; // canvas pixels per CSS pixel

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
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
  if (other) renderer.addSpace(other.space);
  await renderer.ready();
} catch (err) {
  cannot(err);
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
  const { recs, all } = visible(flight, maxT, N_VIEW);
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
    outer: outerAir(flight, all),
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
  out: pilot.way === 'out' ? outward(flight) : null,
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
  // (Only the digits that are not what they would be anyway, in either
  // world compared; and which is shown.)
  const anyway = (j, d) => [world, other].every((w) => !w || w.space.ancestorDigit(j).every((x, a) => x === d[a]));
  const digits = [...pos.digits].filter(([j, d]) => !anyway(j, d));
  const at = { world: world.base, F: pos.F, frac: pos.frac, digits, yaw: controls.yaw, pitch: controls.pitch, ...(side ? { shown: 'B' } : {}) };
  // (Where the page is framed, this may not be allowed: then it is not kept.)
  try {
    history.replaceState(null, '', '#' + btoa(JSON.stringify(at)));
  } catch {}
}
function loadLocation() {
  try {
    const here = JSON.parse(atob(location.hash.slice(1)));
    // (A place in another world than this one is no place here.)
    if ((here.world ?? 'halls') !== world.base) return false;
    pos.F = here.F;
    if (other && (here.shown === 'B') !== (side === 1)) flip();
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

// Off to the next world, somewhere in it as on a first visit (as it is: a
// variant is left behind with its link).
function nextWorld() {
  try {
    localStorage.setItem(WORLD_KEY, WORLDS[(WORLDS.indexOf(world.base) + 1) % WORLDS.length]);
    history.replaceState(null, '', location.pathname);
  } catch {}
  location.reload();
}

// The other world compared, where we are, as we are (see Flight.setSpace):
// nothing else changes, so that what differs is the world. (The tour, if
// on, starts afresh; what it was about to see was of the other.)
function flip() {
  if (!other) return;
  side = 1 - side;
  space = (side ? other : world).space;
  renderer.setSpace(space);
  flight.setSpace(space);
  lookAt = null;
  if (pilot.on) pilot.start(pos.F);
  flippedAt = performance.now();
  showScheme();
}

// Off to somewhere new, as on a first visit (the tour, if on, starts afresh).
function respawn() {
  elsewhere(flight, Math.random);
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
  for (const el of document.querySelectorAll('.world')) el.textContent = worldLabel();
  for (const el of document.querySelectorAll('.vs')) el.hidden = !other;
}
showScheme();
addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyP') toggleTour();
  if (e.code === 'KeyL') nextScheme(e.shiftKey ? -1 : 1);
  if (e.code === 'KeyH') toggleHelp();
  if (e.code === 'KeyN') (e.shiftKey ? nextWorld : respawn)();
  if (e.code === 'KeyV') flip();
});
// The same, by buttons, for touch screens.
const BUTTONS = {
  tour: toggleTour,
  scheme: () => nextScheme(1),
  help: toggleHelp,
  new: respawn,
  world: nextWorld,
  vs: flip,
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
else elsewhere(flight, Math.random);

// Draw only when the picture would differ from the one already showing;
// and, once it has stopped changing, as many times more as temporal
// antialiasing takes to gather all its samples of it (see TAA_N). Once still,
// drawn at full resolution again, whatever motion took it down to: the
// history carries on, so the picture sharpens over those frames.
let shown = '', settled = 0;
function present() {
  resize();
  const keyNow = () => [pos.F, pos.frac, controls.yaw, controls.pitch, flight.scale.toPrecision(3), flight.fog.toPrecision(3), canvas.width, canvas.height, upscale, debug, reference, scheme, side].join();
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
    const tour = pilot.fly(dt, controls, flight.scale, () => awayFrom(flight), steered).map((x) => x * controls.boost());
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
  hud.textContent = `level ${sign}${pos.F}   scale ${scaleLabel(pos.F)}   ${fps.toFixed(0)} fps${reference ? '   old stepping' : ''}${now - schemeShown < 2000 ? `   scheme: ${SCHEMES[scheme].name}` : ''}${now < 4000 || now - flippedAt < 2000 ? `   world: ${worldLabel()}` : other ? `   ${side ? 'B' : 'A'}` : ''}${pilot.on ? `   touring (${pilot.phase === 'dive' ? 'diving' : 'surfacing'})` : ''}`;
  requestAnimationFrame(frame);
}
// Where two worlds are compared, the one not shown drawn once before the
// first frame: the GPU builds a program's pipeline when first drawing with
// it, a stall better behind the loading screen than at the first flip.
if (other) {
  try {
    flip();
    draw();
    flip();
  } catch (err) {
    cannot(err);
  }
}
requestAnimationFrame(frame);

// For poking at the world from the console: fw.fly(2, {f: 1}) flies forward
// for two seconds of simulated time.
window.fw = {
  pos,
  flight,
  controls,
  get space() {
    return space;
  },
  renderer,
  flip,
  // (Which world compared is shown: 'A' or 'B'; null if none is compared.)
  get shown() {
    return other ? (side ? 'B' : 'A') : null;
  },
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
      flight.step(1 / 60, pilot.fly(1 / 60, controls, flight.scale, () => awayFrom(flight)));
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
  // (The checks of the JavaScript against the shader: see debug.js.)
  trace: (...a) => trace(window.fw, ...a),
  check: (...a) => check(window.fw, ...a),
  checkRays: (...a) => checkRays(window.fw, ...a),
  compareRays: (...a) => compareRays(window.fw, ...a),
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
