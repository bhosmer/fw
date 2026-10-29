import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import halls from '../../src/spaces/halls.js';
import { rand } from './rand.js';
import * as P from '../../src/pieces.js';

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

// The halls with nothing finer than level 0: there, a wall never opens.
const bare = { ...halls, cellAir: (L, f, id, seed, dg, level, up) => (level <= 0 ? halls.cellAir(L, f, id, seed, dg, level, up) : 1) };

// Fly straight ahead at speed until the room we are in is more than levels
// up, calling each(flight) after every step; at most n steps.
function press(flight, levels, n, each) {
  for (let i = 0; i < n && !(flight.pos.F - flight.room > levels); i++) {
    flight.step(0.1, [0, 0, -8]);
    flight.sense();
    each?.(flight);
  }
}

// Flying at a surface that never opens takes us ever finer, and the space we
// are really in ever further up: further than sense() looks as a rule.
test('held at a surface for ever, we still know where the air is', () => {
  const flight = new Flight(bare, controls());
  flight.begin(true);
  press(flight, 80, 1000, (f) => assert.ok(f.clearance > 0, `in solid at level ${f.pos.F}`));
  // (Past where it used to be lost: UP + FAR = 72 levels up.)
  assert.ok(flight.pos.F - flight.room > 72, `the room was never more than ${flight.pos.F - flight.room} levels up`);
});

test('sent somewhere deep, we find the room we are in', () => {
  const flight = new Flight(bare, controls());
  flight.begin(true);
  press(flight, 80, 1000);
  const { F, frac } = flight.pos;
  const digits = new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()]));
  // (As a link would: nothing known but where.)
  const there = new Flight(bare, controls());
  Object.assign(there.pos, { F, frac: frac.slice(), digits });
  there.begin();
  assert.ok(there.clearance > 0 && there.room < F - 72, `clearance ${there.clearance}, room ${there.room} at ${F}`);
});

// (Past about 223 levels down, a level-0 cell is more level-F cells than a
// number holds, and the room we were in, at level 0, is too far up to ask.)
test('however deep, where the sky is stays a number', () => {
  const flight = new Flight(halls, controls());
  flight.begin(true);
  for (let i = 0; i < 300; i++) flight.pos.refine();
  assert.ok(Number.isFinite(flight.skyHeight()) && Number.isFinite(flight.skyHeight(1)), `sky ${flight.skyHeight()}, ${flight.skyHeight(1)}`);
  flight.sense();
  assert.ok(Number.isFinite(flight.sky) && Number.isFinite(flight.clearance), `sky ${flight.sky}, clearance ${flight.clearance}`);
  // (The room we were in, too far up to ask, is worked back up to.)
  for (let i = 0; i < 60; i++) flight.step(1 / 60, [0, 0, -1]);
  assert.ok(Number.isFinite(flight.clearance) && flight.clearance > 0 && Number.isFinite(flight.scale), `clearance ${flight.clearance}, scale ${flight.scale}`);
  assert.ok(flight.pos.F < 100, `still working at level ${flight.pos.F}`);
});

test('a first visit begins somewhere different each time, with room ahead', () => {
  const rnd = rand(9);
  const places = new Set();
  for (let i = 0; i < 30; i++) {
    const flight = new Flight(halls, controls());
    elsewhere(flight, rnd);
    assert.ok(flight.clearance >= 0.08 && flight.sky < 0, `clearance ${flight.clearance}, sky ${flight.sky}`);
    // (Facing the most open of the four ways along the walls.)
    const open = (yaw) => flight.ahead([Math.sin(yaw), 0, -Math.cos(yaw)]);
    const most = Math.max(...[0, 1, 2, 3].map((k) => open((k * Math.PI) / 2)));
    assert.ok(open(flight.controls.yaw) >= most && flight.controls.pitch === 0, 'not facing the most open way');
    places.add(JSON.stringify([flight.pos.F, [...flight.pos.digits].sort()]));
  }
  assert.ok(places.size >= 25, `only ${places.size} different places in 30`);
});

// A room of two boxes of air one after the other along z, at level 0 (every
// other level solid), meeting at z = 12 lattice units, or split there by a
// wall wall units thick; answering rays as the worlds do. Where they only
// touch, the clearance goes to nothing at the face they share, though
// nothing is there.
function twoBoxes(wall) {
  const box = (p, z0, z1) => {
    P.airPiece();
    P.airSpan(p[0][0], p[0][1], 1, 23, 0);
    P.airSpan(p[1][0], p[1][1], 1, 23, 1);
    P.airSpan(p[2][0], p[2][1], z0, z1, 2);
    return P.S.d;
  };
  return {
    name: 'two boxes', R: 24, start: [0.5, 0.5, 0.25], fogK: 1, ground: 1e6, ancestorDigit: () => [0, 0, 0],
    cellAir(L, f, id, seed, dg, level, up, ray) {
      if (ray) (ray.known = true), (ray.reach = -1);
      if (level !== 0) return 24;
      // (Each axis as L and f apart, as the worlds keep it, for precision.)
      const p = [0, 1, 2].map((a) => [L[a], f[a]]);
      P.at(L, f, null);
      let d = 1e9;
      for (const [z0, z1] of [[1, 12], [12 + wall, 23]]) {
        const a = box(p, z0, z1);
        d = Math.min(d, a);
        if (ray && a <= 0) {
          (P.S.ray = true), (P.S.dx = ray.dir[0]), (P.S.dy = ray.dir[1]), (P.S.dz = ray.dir[2]);
          box(p, z0, z1);
          P.S.ray = false;
          if (P.S.x > ray.reach) ray.reach = P.S.x;
        }
      }
      return d;
    },
  };
}

// How far past z = 12 lattice units of level 0 a flight is (in those units;
// short of it, less than 0), from its digits finer than that, so as to keep
// its precision however deep.
function past(flight) {
  const { pos } = flight;
  if (pos.F < 1) return (pos.digit(0)[2] + pos.frac[2]) * 24 - 12;
  // (The whole lattice units, and the rest from the finer digits: past the
  // face by less than a unit, the rest alone, which keeps every digit.)
  const whole = pos.digit(0)[2] * 24 + pos.digit(1)[2] - 12;
  let rest = pos.frac[2];
  for (let j = pos.F; j >= 2; j--) rest = (rest + pos.digit(j)[2]) / 24;
  return whole === 0 ? rest : whole + rest;
}

test('a face two pieces of air only share is flown through, head on and aslant', () => {
  for (const pitch of [0, 0.3, -0.6]) {
    const flight = new Flight(twoBoxes(0), { yaw: Math.PI, pitch, boost: () => 1 });
    flight.begin();
    const dir = [0, Math.sin(pitch), Math.cos(pitch)];
    let frames = 0;
    while (!(past(flight) > 0.5) && frames < 600) flight.step(1 / 60, dir), frames++;
    assert.ok(frames < 300, `at pitch ${pitch}, still short of the face after ${frames} frames (${past(flight)} past)`);
  }
});

test('a wall however thin is never flown through', () => {
  for (const wall of [1e-7, 1e-3, 0.5]) {
    for (const pitch of [0, 0.3, -0.6, 1.0]) {
      for (const [dt, boost] of [[1 / 60, 1], [0.1, 8]]) {
        const flight = new Flight(twoBoxes(wall), { yaw: Math.PI, pitch, boost: () => 1 });
        flight.begin();
        const dir = [0, Math.sin(pitch) * boost, Math.cos(pitch) * boost];
        for (let i = 0; i < 600; i++) {
          flight.step(dt, dir);
          assert.ok(past(flight) <= 0, `into a wall ${wall} thick, at pitch ${pitch}, step ${i} (${past(flight)} past its face)`);
        }
        // (And it came up to the wall, not to a stop somewhere short of it.)
        assert.ok(past(flight) > -0.5, `at pitch ${pitch}, still ${-past(flight)} short of the wall`);
      }
    }
  }
});

// However far the way ahead is found open, all of it is air: along rays every
// which way from places on a wander, nothing solid comes before it.
test('the way found open is air all the way', async () => {
  const { default: arcology } = await import('../../src/spaces/arcology.js');
  for (const space of [halls, arcology]) {
  const flight = new Flight(space, controls());
  if (space === halls) flight.begin(true);
  else elsewhere(flight, rand(3));
  const rnd = rand(51);
  let i = 0;
  wander(flight, space === halls ? 1500 : 600, (f) => {
    if (i++ % 5) return;
    f.sense();
    for (let k = 0; k < 4; k++) {
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
      const dir = d.map((x) => x / l), open = f.ahead(dir);
      for (let j = 1; j <= 200; j++) {
        const t = (open * j) / 200;
        assert.ok(Math.max(f.sky + dir[1] * t, ...f.here.map((r) => -f.airAt(r, dir.map((x) => x * t)) / r.sig)) > -1e-9 * open, `${space.name}: solid at ${t} of ${open} open`);
      }
    }
  }, 1);
  }
});
