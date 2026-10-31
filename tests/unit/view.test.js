import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../../src/flight.js';
import { makeView, visible, outerAir, camera, FOV_TAN, FIT } from '../../src/view.js';
import { UP } from '../../src/flight.js';
import { rayThrough } from '../../src/debug.js';
import arcology from '../../src/spaces/arcology.js';
import { into } from './corner.js';
import { inside } from './inside.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';
import * as P from '../../src/pieces.js';

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
test('close to a far coarser room\'s walls and corners, what is drawn never lets a ray past a surface the world has', () => {
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
// plane, which can let a ray past its other walls: ledger B49.)
test('flying at walls, what is drawn never lets a ray past a surface the world has (but in the relief\'s rooms)', () => {
  const states = atWalls().filter(({ flight }) => !arcology.nearOnly.includes(flight.room));
  assert.ok(states.some(({ flight }) => flight.pos.F - flight.room > FIT), 'no room further up than view.fit');
  assert.ok(states.length >= 20, `only ${states.length} states with the room far up`);
  const bad = states.map(({ seed, i, flight }) => ({ seed, i, F: flight.pos.F, room: flight.room, ...seenPast(flight, [0]) })).filter((x) => x.past);
  assert.deepEqual(bad, []);
});

test('a room coarser than the levels looked at as a rule is drawn, as itself or zoomed, unless it is the relief\'s', () => {
  let relief = 0, drawn = 0, zoomed = 0;
  for (const { flight } of atWalls()) {
    const { recs, view } = makeView(flight, SHOWN), gap = flight.pos.F - flight.room;
    // (Nothing coarser than fit but the room we are in, drawn zoomed (as a
    // level fit up: its sig); nothing of the relief's levels coarser than the
    // rule.)
    const fits = (r) => r.level >= flight.pos.F - FIT || (r.level === flight.room && Math.abs(r.sig / Math.pow(arcology.R, 1 - FIT) - 1) < 1e-12);
    assert.ok(recs.every((r) => fits(r) && (r.level >= flight.pos.F - UP || !arcology.nearOnly.includes(r.level))), 'a level drawn that cannot be');
    // (The levels coarser than the rule come first: view.wide of them.)
    assert.ok(recs.slice(0, view.wide).every((r) => r.level < flight.pos.F - UP) && recs.slice(view.wide).every((r) => r.level >= flight.pos.F - UP));
    if (arcology.nearOnly.includes(flight.room)) {
      relief++;
      assert.ok(view.outer && view.outer.level === flight.room, `the relief's room ${flight.room} has no plane`);
    } else if (gap <= FIT) {
      drawn++;
      assert.ok(recs.some((r) => r.level === flight.room), `the room ${gap} levels up is not drawn`);
      assert.equal(view.outer, null);
    } else {
      // (Further up than fit: drawn zoomed, holding as far as any ray goes.)
      zoomed++;
      assert.ok(recs.some((r) => r.level === flight.room && r.sig !== flight.airs.find((a) => a.rec.level === flight.room).rec.sig), `the room ${gap} levels up is not drawn zoomed`);
      assert.equal(view.outer, null);
      assert.ok(view.valid > view.maxT, `the room drawn zoomed holds only ${view.valid}, not out to ${view.maxT}`);
    }
  }
  assert.ok(relief > 0 && drawn > 0 && zoomed > 0, `${relief} relief rooms, ${drawn} drawn, ${zoomed} zoomed`);
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

// A room of air in every level-0 cell (1 to 23 lattice units each way), every
// other level solid: the review's corner (ledger B45), 0.4 level-F cells
// inside two of its walls, 13 and 40 levels below it.
const BOX = {
  name: 'a box', R: 24, start: [0.5, 0.5, 0.5], fogK: 250, ancestorDigit: () => [0, 0, 0],
  skyPlane: (j) => (j === 0 ? 1e6 : 0),
  cellAir(L, f, id, seed, dg, level, up, ray) {
    if (ray) (ray.known = true), (ray.reach = -1);
    if (level !== 0) return 24;
    const box = () => {
      P.airPiece();
      for (let a = 0; a < 3; a++) P.airSpan(L[a], f[a], 1, 23, a);
      return P.S.d;
    };
    P.at(L, f, dg);
    const d = box();
    if (ray && d <= 0) {
      (P.S.ray = true), (P.S.dx = ray.dir[0]), (P.S.dy = ray.dir[1]), (P.S.dz = ray.dir[2]);
      box();
      P.S.ray = false;
      (ray.reach = P.S.x), (ray.nx = P.S.nx), (ray.ny = P.S.ny), (ray.nz = P.S.nz);
    }
    return d;
  },
};
// (At F, k level-F cells from the box's walls x = 1 and y = 1, half way up
// it along z; or, with j0, from y = 1 by a digit of 1 at level j0 (and half
// a level-F cell).)
function inBox(F, k, j0 = null) {
  const flight = new Flight(BOX);
  const digits = new Map();
  for (let j = 1; j <= F; j++) digits.set(j, [j === 1 ? 1 : 0, j === 1 ? 1 : j === j0 ? 1 : 0, j === 1 ? 12 : 0]);
  Object.assign(flight.pos, { F, frac: [k, j0 === null ? k : 0.5, 0.5], digits });
  flight.begin();
  return flight;
}

test('a camera close inside two walls of a room far up: no ray goes through either', () => {
  for (const F of [13, 40]) {
    const flight = inBox(F, 0.4);
    assert.equal(flight.pos.F, F, 'the flight stayed where it was put');
    assert.equal(flight.room, 0);
    const { recs, view } = makeView(flight, SHOWN);
    // (13 levels up, the room is drawn as it is; 40, zoomed. No plane.)
    const room = recs.find((r) => r.level === 0);
    assert.ok(room, `${F}: the room is not drawn`);
    assert.equal(view.outer, null);
    assert.equal(room.sig === flight.airs.find((a) => a.rec.level === 0).rec.sig, F - 0 <= FIT, `${F}: drawn ${F <= FIT ? 'as it is' : 'zoomed'}`);
    // (Past the wall x = 1, the plane there was: no level drawn has air.)
    for (const v of [[-0.44, 0.2, 0], [0.2, -0.44, 0], [-0.44, -0.44, 0.3]]) assert.ok(recs.every((r) => flight.airAt(r, v) >= 0), `${F}: air drawn at ${v}, past a wall`);
    // (Nor does a ray go past one, every way round.)
    assert.deepEqual(seenPast(flight), { past: 0, rays: 576 });
  }
});

// Drawn as it is, or zoomed (view.fit fewer than how far up it is), a room is
// the same: every ray across the view goes as far in either, out to where the
// zoomed room holds.
test('a room drawn zoomed is the room drawn as it is', () => {
  for (const [to, gap] of [['corner', 16], ['edge', 20], ['corner', 24], ['ceiling', 24]]) {
    const flight = place(to, gap);
    for (const fit of [13, 14, 18]) {
      if (fit >= gap) continue;
      const a = makeView(flight, SHOWN), b = makeView(flight, { ...SHOWN, fit });
      assert.ok(b.recs.some((r) => r.level === flight.room && r.sig !== flight.airs.find((x) => x.rec.level === flight.room).rec.sig), `${to} ${gap} up, fit ${fit}: not zoomed`);
      // (Out to where the zoomed room holds: no ray goes further. The fewer
      // levels up it is drawn as, the nearer that is.)
      const far = Math.min(a.view.maxT, b.view.valid);
      assert.ok(far > 0);
      for (const dir of across(flight)) {
        const x = rayThrough(flight, dir, far, a.recs, a.view.outer), y = rayThrough(flight, dir, far, b.recs, b.view.outer);
        assert.equal(x.hit, y.hit, `${to} ${gap} up, fit ${fit}: one meets a surface, the other not`);
        assert.ok(Math.abs(x.t - y.t) <= 1e-9 * x.t + 1e-12, `${to} ${gap} up, fit ${fit}: ${x.t} as it is, ${y.t} zoomed`);
      }
    }
  }
});

// A room too far up that cannot be drawn zoomed (it would hold nowhere: see
// visible) keeps the plane, as before rooms were drawn at all: never worse.
test('a room not drawn keeps its plane', () => {
  const flight = place('corner', 30), all = flight.airs, { recs } = makeView(flight, SHOWN);
  assert.equal(outerAir(flight, all, recs.filter((r) => r.level !== flight.room))?.level, flight.room);
  assert.equal(outerAir(flight, all, recs), null);
});

// Into a room's edge, then pressed into one of its walls alone, on down to
// 34 levels below it (review148's m4): a plane of another family passes close
// by the wall there, which the zoom must keep clear of by what single
// precision can tell, not more. At every level past fit, the room is drawn,
// zoomed, holding out to where any ray goes, and we are in its air.
test('pressed into a coarse room\'s wall, the room is drawn zoomed all the way down', () => {
  let states = 0;
  for (const g0 of [6, 8, 10, 12])
    for (let seed = 1; seed <= 6; seed++) {
      const got = into(new Flight(arcology), { seed, gap: g0, to: 'edge' });
      if (!got) continue;
      const { flight, room } = got, sx = seed % 2 ? 1 : -1;
      let last = 0;
      for (let i = 0; i < 3000 && flight.pos.F - room < 34; i++) {
        flight.step(0.1, [8 * sx, 0, 0]);
        flight.sense();
        if (flight.room !== room) break;
        const gap = flight.pos.F - room;
        if (gap <= FIT || gap === last) continue;
        last = gap;
        states++;
        const { recs, view } = makeView(flight, SHOWN);
        assert.ok(recs.some((r) => r.level === room), `seed ${seed} from ${g0} levels: the room ${gap} levels up is not drawn`);
        assert.ok(recs.some((r) => flight.airAt(r, [0, 0, 0]) < 0), `seed ${seed} from ${g0} levels, ${gap} up: in no air drawn`);
        assert.equal(view.outer, null);
      }
    }
  assert.ok(states >= 40, `only ${states} states`);
});

// Close inside one wall of a room far up, another wall at any of many
// distances (review148's m3). Zoomed, that wall would be S times nearer than
// it is; the room is drawn so that it is not (zoomed about where both walls
// meet, if that is near enough), and holds as far as any ray goes; but for
// where neither can be, with the wall too far to zoom about and near enough
// that S times nearer is in sight: there it holds as far as that wall, and
// the diagonals through where the walls meet, are S times nearer, and no
// further (a haze where it ends, never a wall seen through).
test('close to one wall of a room far up, another far off cuts the view short only as far as zoomed it must', () => {
  for (const F of [30, 40])
    for (const j0 of [5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]) {
      if (j0 >= F) continue;
      const flight = inBox(F, 0.4, j0);
      const { recs, view } = makeView(flight, SHOWN), rec = flight.airs.find((a) => a.rec.level === 0).rec;
      assert.ok(recs.some((r) => r.level === 0), `F ${F}, j0 ${j0}: the room is not drawn`);
      assert.equal(view.outer, null);
      const wall = (rec.L[1] - 1 + rec.f[1]) / rec.sig, S = Math.pow(arcology.R, F - FIT);
      assert.ok(view.valid >= Math.min(view.maxT, (0.99 * wall) / Math.SQRT2 / S - 1), `F ${F}, j0 ${j0}: it holds ${view.valid}, short of ${view.maxT} (the wall ${wall} off)`);
    }
});
