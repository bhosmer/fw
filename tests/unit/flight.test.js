import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../../src/flight.js';
import halls from '../../src/spaces/halls.js';
import { rand } from './rand.js';

const R = halls.R;

// Just what Flight needs of the controls.
const controls = () => ({ yaw: 0, pitch: 0, boost: () => 1 });

// Fly a while, wandering: n steps of dt seconds, the heading drifting and now
// and then turning, calling each(flight, len) after every step.
function wander(flight, n, each, seed = 1, dt = 1 / 60, boost = 1) {
  const rnd = rand(seed);
  let yaw = 0, pitch = 0, turn = 0;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) turn = (rnd() - 0.5) * 3;
    yaw += turn * dt;
    pitch = Math.max(-1, Math.min(1, pitch + (rnd() - 0.5) * 0.05));
    flight.controls.yaw = yaw;
    flight.controls.pitch = pitch;
    const wish = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)].map((x) => x * boost);
    const len = flight.step(dt, wish);
    each?.(flight, len);
  }
}

test('a first visit begins somewhere with room to stand', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  assert.ok(flight.clearance > 0.05, `clearance ${flight.clearance}`);
  assert.ok(flight.fog > 0 && flight.scale > 0);
});

test('flying never ends a step in solid, nor goes more than half the way open', () => {
  // (Also at ten frames a second with shift held, where steps are long.)
  for (const [seed, dt, boost, n] of [[1, 1 / 60, 1, 1500], [2, 1 / 60, 1, 1500], [3, 0.1, 8, 600]]) {
    const flight = new Flight(halls, controls());
    flight.begin(true);
    const levels = new Set();
    wander(flight, n, (f, len) => {
      assert.ok(len <= 0.5 * f.opened * (1 + 1e-9) || !(f.clearance > 0), `stepped ${len} of ${f.opened} open`);
      f.sense();
      assert.ok(f.clearance > 0, `in solid at level ${f.pos.F}, ${f.pos.frac}`);
      levels.add(f.pos.F);
    }, seed, dt, boost);
    assert.ok(levels.size >= 2, 'the flight went through more than one level');
  }
});

test('the working level follows how much room there is', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  wander(flight, 1000, (f) => {
    f.sense();
    // (Out in the open, the sky alone can leave us coarser than it says.)
    if (f.sky > 0) return;
    assert.ok(f.clearance <= 0.5 && f.clearance >= 0.29 / R, `clearance ${f.clearance} at level ${f.pos.F}`);
  }, 4);
});

test('speeding up is eased; slowing down is not', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  let before = null;
  wander(flight, 1500, (f) => {
    // (In cells of one fixed level, since F moves.)
    const pace = f.pace * Math.pow(R, -f.pos.F), open = f.opened * Math.pow(R, -f.pos.F);
    if (before && pace > before.pace) {
      const most = before.pace * Math.pow(Math.max(open / before.pace, 1), 1 - Math.exp(-1 / 60));
      assert.ok(pace <= most * (1 + 1e-9), `sped up from ${before.pace} to ${pace}, at most ${most}`);
    }
    before = { pace };
  }, 5);
});

test('rewinding comes back to where we started', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  const start = { F: flight.pos.F, frac: flight.pos.frac.slice() };
  wander(flight, 600, null, 6);
  for (let i = 0; i < 2000 && flight.travelled > 0; i++) flight.retrace(1 / 60, -1);
  assert.equal(flight.travelled, 0);
  flight.sense();
  // (Coarser or finer, the place is the same; compare at the level we began.)
  while (flight.pos.F > start.F) flight.pos.coarsen();
  while (flight.pos.F < start.F) flight.pos.refine();
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(flight.pos.frac[a] - start.frac[a]) < 1e-9, `${flight.pos.frac} not ${start.frac}`);
});

test('the thread is the way we came, within reach', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  wander(flight, 600, null, 7);
  const range = 50 * flight.scale;
  const pts = flight.thread(range, 64);
  assert.ok(pts.length > 0 && pts.length <= 64 * 3 && pts.length % 3 === 0);
  for (let i = 0; i < pts.length; i += 3) assert.ok(Math.hypot(pts[i], pts[i + 1], pts[i + 2]) < range);
});

// Flying at a surface that never opens takes us ever finer, and the space we
// are really in ever further up: further than sense() looks as a rule.
test('held at a surface for ever, we still know where the air is', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  let deepest = 0;
  wander(flight, 1500, (f) => {
    f.sense();
    assert.ok(f.clearance > 0, `in solid at level ${f.pos.F}`);
    deepest = Math.max(deepest, f.pos.F - f.room);
  }, 3, 0.1, 8);
  // (Past where it used to be lost: UP + FAR = 72 levels up.)
  assert.ok(deepest > 72, `the room was never more than ${deepest} levels up`);
});

test('sent somewhere deep, we find the room we are in', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  wander(flight, 1261, null, 3, 0.1, 8); // (to where the room is 73 levels up)
  const { F, frac } = flight.pos;
  const digits = new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()]));
  // (As a link would: nothing known but where.)
  const there = new Flight(halls, controls());
  Object.assign(there.pos, { F, frac: frac.slice(), digits });
  there.begin();
  assert.ok(there.clearance > 0 && there.room < F - 72, `clearance ${there.clearance}, room ${there.room} at ${F}`);
});
