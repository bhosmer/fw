import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../../src/flight.js';
import { makeView, visible, camera, FOV_TAN, FIT } from '../../src/view.js';
import { UP } from '../../src/flight.js';
import { rayThrough } from '../../src/debug.js';
import arcology from '../../src/spaces/arcology.js';
import { into } from './corner.js';
import { inside } from './inside.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';

// How the view is shown, for makeView: a small picture, as fw.snap draws it.
const SHOWN = { w: 320, h: 180, lodH: 180, upscale: 1, snapping: true, debug: 0, reference: false, scheme: 0, side: 0, history: 'range' };

// Rays across the view (n by m of them, 16 to 9), from the flight's camera.
function across(flight, n = 16, m = 9) {
  const { fwd, right, up } = camera(flight), out = [];
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const x = (((i + 0.5) / n) * 2 - 1) * FOV_TAN * (16 / 9), y = (1 - ((j + 0.5) / m) * 2) * FOV_TAN;
      const d = fwd.map((f, a) => f + x * right[a] + y * up[a]), l = Math.hypot(...d);
      out.push(d.map((c) => c / l));
    }
  return out;
}

// Of the rays across the view, those that what is drawn (the levels the view
// draws, and its outer plane if it has one) lets further than the world (every
// level around us, as it is) does: past a surface the world has, short of
// how far the view sees. (A little short of it: there a ray the world stops
// and one it lets go on are both lost in the haze.)
function seenPast(flight, looks = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
  const yaw = flight.yaw;
  let past = 0, rays = 0;
  for (const turn of looks) {
    flight.yaw = yaw + turn;
    const { recs, view } = makeView(flight, SHOWN);
    for (const dir of across(flight)) {
      rays++;
      const world = rayThrough(flight, dir, view.maxT);
      if (!world.hit || world.t > 0.99 * view.maxT) continue;
      const drawn = rayThrough(flight, dir, view.maxT, recs, view.outer);
      if (drawn.t > world.t * (1 + 1e-6) + 1e-9) past++;
    }
  }
  flight.yaw = yaw;
  return { past, rays };
}

// Close to a room's walls, ceiling, edge or corner, its level more than UP
// levels up (13: its far walls in sight; 30: only the walls beside us).
function place(to, gap) {
  for (let seed = 1; seed <= 12; seed++) {
    const got = into(new Flight(arcology), { seed, gap, to });
    if (got) return got.flight;
  }
  assert.fail(`no place ${gap} levels below a room's ${to}`);
}

test('close to a coarse room\'s walls and corners, what is drawn never lets a ray past a surface the world has', () => {
  for (const to of ['corner', 'edge', 'ceiling']) assert.deepEqual({ to, ...seenPast(place(to, 13)) }, { to, past: 0, rays: 576 });
});
test('close to a far coarser room\'s walls and corners, what is drawn never lets a ray past a surface the world has', { todo: 'ledger B45: coarser than view.fit, the outer plane stands for one wall of the room' }, () => {
  for (const to of ['corner', 'edge', 'ceiling']) assert.deepEqual({ to, ...seenPast(place(to, 30)) }, { to, past: 0, rays: 576 });
});

// Flying straight at whatever is ahead, from inside the building and from
// first visits: at walls that do not open for many levels, the room ends up
// far coarser than the levels looked at as a rule. Every 20th step there, as
// the view is drawn: the states, each with its flight's numbers.
let flown = null;
function atWalls() {
  if (flown) return flown;
  flown = [];
  for (let seed = 1; seed <= 8; seed++) {
    const flight = new Flight(arcology), rnd = rand(100 + seed);
    if (seed % 2) inside(flight, rnd);
    else elsewhere(flight, rnd);
    flight.yaw += rnd() * 6.28;
    flight.pitch = (rnd() - 0.5) * 1.2;
    for (let i = 0; i < 400; i++) {
      flight.step(0.1, flight.basis().fwd.map((x) => x * 8));
      flight.sense();
      if (i % 20 === 0 && flight.pos.F - flight.room > UP) flown.push({ seed, i, flight: snapshot(flight) });
    }
  }
  return flown;
}
// (A flight where another is now, to look from: the same place and facing.)
function snapshot(flight) {
  const f = new Flight(arcology);
  Object.assign(f.pos, { F: flight.pos.F, frac: flight.pos.frac.slice(), digits: new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()])) });
  f.yaw = flight.yaw;
  f.pitch = flight.pitch;
  f.begin();
  return f;
}

// (A room of the relief's levels, which are drawn only near F, keeps its one
// plane, which can let a ray past its other walls: ledger B49. So, for now,
// does a room further up than view.fit: ledger B45, step 3.)
test('flying at walls, what is drawn never lets a ray past a surface the world has (but in the relief\'s rooms, and those too far up)', () => {
  const states = atWalls().filter(({ flight }) => !arcology.nearOnly.includes(flight.room) && flight.pos.F - flight.room <= FIT);
  assert.ok(states.length >= 20, `only ${states.length} states with the room far up`);
  const bad = states.map(({ seed, i, flight }) => ({ seed, i, F: flight.pos.F, room: flight.room, ...seenPast(flight, [0]) })).filter((x) => x.past);
  assert.deepEqual(bad, []);
});

test('a room coarser than the levels looked at as a rule is drawn, as itself, unless it is the relief\'s or too coarse', () => {
  let relief = 0, drawn = 0;
  for (const { flight } of atWalls()) {
    const { recs, view } = makeView(flight, SHOWN), gap = flight.pos.F - flight.room;
    // (Nothing coarser than fit, nor of the relief's levels coarser than the rule.)
    assert.ok(recs.every((r) => r.level >= flight.pos.F - FIT && (r.level >= flight.pos.F - UP || !arcology.nearOnly.includes(r.level))), 'a level drawn that cannot be');
    // (The levels coarser than the rule come first: view.wide of them.)
    assert.ok(recs.slice(0, view.wide).every((r) => r.level < flight.pos.F - UP) && recs.slice(view.wide).every((r) => r.level >= flight.pos.F - UP));
    if (arcology.nearOnly.includes(flight.room)) {
      relief++;
      assert.ok(view.outer && view.outer.level === flight.room, `the relief's room ${flight.room} has no plane`);
    } else if (gap <= FIT) {
      drawn++;
      assert.ok(recs.some((r) => r.level === flight.room), `the room ${gap} levels up is not drawn`);
      assert.equal(view.outer, null);
    } else assert.ok(view.outer, `the room ${gap} levels up has no plane`);
  }
  assert.ok(relief > 0 && drawn > 0, `${relief} relief rooms, ${drawn} drawn`);
});

// More levels have air in sight than can be drawn: a level coarser than the
// rule takes no place from one the rule looks at, unless it is the space we
// are in.
test('a coarser level is drawn only where there is room left, unless it is the space we are in', () => {
  let crowded = 0;
  for (const { flight } of atWalls()) {
    const maxT = 4 * flight.fog, all = visible(flight, maxT, 99).recs, { recs } = visible(flight, maxT, 12);
    if (all.length <= 12) continue;
    crowded++;
    const within = (flight.sensed.find((s) => s.air < 0) ?? flight.sensed[0]).level, kept = new Set(recs.map((r) => r.level));
    const coarse = recs.filter((r) => r.level < flight.pos.F - UP && r.level !== within);
    if (coarse.length) assert.ok(all.every((r) => r.level < flight.pos.F - UP || kept.has(r.level)), 'a coarser level took the place of one looked at as a rule');
    if (all.some((r) => r.level === within)) assert.ok(kept.has(within), 'the space we are in is not drawn');
  }
  assert.ok(crowded > 0);
});

// A relief level colours its surfaces as the level just coarser (gSkin: the
// shader's slot i - 1, ledger B50), which holds only where that level is the
// one drawn before it, or, first of those drawn, the one whose colours slot
// -1 has (the outer plane's level if it is on, else the level just coarser
// than the first drawn: see setView in renderer.js). Here, with the relief's
// levels never drawn coarser than the rule (nearOnly), it always is.
test('a level coloured as the one coarser than it is next to that one in what is drawn', () => {
  const states = [...atWalls().map(({ flight }) => flight)];
  for (let seed = 1; seed <= 4; seed++) {
    const flight = new Flight(arcology), rnd = rand(300 + seed);
    elsewhere(flight, rnd);
    for (let i = 0; i < 300; i++) {
      flight.yaw += 0.01;
      flight.step(1 / 30, flight.basis().fwd);
      if (i % 30 === 0) states.push(snapshot(flight));
    }
  }
  let skins = 0;
  for (const flight of states) {
    const { recs, view } = makeView(flight, SHOWN), CITY = Math.min(...arcology.nearOnly);
    recs.forEach((r, i) => {
      if (r.level !== CITY + 1) return;
      skins++;
      const before = i > 0 ? recs[i - 1].level : view.outer ? view.outer.level : r.level - 1;
      assert.equal(before, CITY, `the relief's level drawn after level ${before}, at F ${flight.pos.F}`);
    });
  }
  assert.ok(skins > 0);
});
