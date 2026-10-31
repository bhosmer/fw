import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../../src/flight.js';
import { makeView, camera, FOV_TAN } from '../../src/view.js';
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
const PLACES = [['corner', 13], ['corner', 30], ['edge', 13], ['edge', 30], ['ceiling', 13], ['ceiling', 30]];
function places() {
  const out = [];
  for (const [to, gap] of PLACES)
    for (let seed = 1; seed <= 12; seed++) {
      const got = into(new Flight(arcology), { seed, gap, to });
      if (got) {
        out.push({ to, gap, seed, flight: got.flight });
        break;
      }
    }
  return out;
}

test('close to a coarse room\'s walls and corners, what is drawn never lets a ray past a surface the world has', { todo: 'ledger B45: the outer plane stands for one wall of the room' }, () => {
  const found = places();
  assert.equal(found.length, PLACES.length, 'every place was found');
  const bad = found.map(({ to, gap, flight }) => ({ to, gap, ...seenPast(flight) })).filter((x) => x.past);
  assert.deepEqual(bad, []);
});

// Flying straight at whatever is ahead, from inside the building and from
// first visits: at walls that do not open for many levels, the room ends
// up far coarser than the levels drawn as a rule.
test('flying at walls, what is drawn never lets a ray past a surface the world has', { todo: 'ledger B45: the outer plane stands for one wall of the room' }, () => {
  let states = 0;
  const bad = [];
  for (let seed = 1; seed <= 8; seed++) {
    const flight = new Flight(arcology), rnd = rand(100 + seed);
    if (seed % 2) inside(flight, rnd);
    else elsewhere(flight, rnd);
    flight.yaw += rnd() * 6.28;
    flight.pitch = (rnd() - 0.5) * 1.2;
    for (let i = 0; i < 400; i++) {
      flight.step(0.1, flight.basis().fwd.map((x) => x * 8));
      flight.sense();
      if (i % 20 || flight.pos.F - flight.room <= 12) continue;
      states++;
      const { past } = seenPast(flight, [0]);
      if (past) bad.push({ seed, i, F: flight.pos.F, room: flight.room, past });
    }
  }
  assert.ok(states >= 20, `only ${states} states with the room far up`);
  assert.deepEqual(bad, []);
});
