import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight, PITCH_MAX, FLIGHT } from '../../src/flight.js';
import { camera } from '../../src/view.js';
import { elsewhere } from '../../src/arrival.js';
import { Pilot, awayFrom } from '../../src/pilot.js';
import { Planner } from '../../src/planner.js';
import arcology from '../../src/spaces/arcology.js';
import { inside } from './inside.js';
import { rand } from './rand.js';
import * as P from '../../src/pieces.js';

const R = arcology.R;

// Fly a while, wandering: n steps of dt seconds, the heading drifting and now
// and then turning, calling each(flight, len) after every step.
function wander(flight, n, each, seed = 1, dt = 1 / 60, boost = 1) {
  const rnd = rand(seed);
  let yaw = 0, pitch = 0, turn = 0;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) turn = (rnd() - 0.5) * 3;
    yaw += turn * dt;
    pitch = Math.max(-1, Math.min(1, pitch + (rnd() - 0.5) * 0.05));
    flight.yaw = yaw;
    flight.pitch = pitch;
    const wish = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)].map((x) => x * boost);
    const len = flight.step(dt, wish);
    each?.(flight, len);
  }
}

test('a first visit begins somewhere with room to stand', () => {
  const flight = new Flight(arcology);
  flight.begin(true);
  assert.ok(flight.clearance > 0.05, `clearance ${flight.clearance}`);
  assert.ok(flight.fog > 0 && flight.scale > 0);
});

test('flying never ends a step in solid, nor goes more than half the way open', () => {
  // (Also at ten frames a second with shift held, where steps are long; and
  // inside the building, among the halls' thin doors and windows.)
  for (const [seed, dt, boost, n, within] of [[1, 1 / 60, 1, 1500], [2, 1 / 60, 1, 1500], [3, 0.1, 8, 600], [4, 1 / 60, 1, 1500, true], [5, 0.1, 8, 600, true]]) {
    const flight = new Flight(arcology);
    if (within) inside(flight, rand(seed));
    else flight.begin(true);
    const levels = new Set();
    wander(flight, n, (f, len) => {
      // (The step in cells of the level it was made at; how far the way was
      // open, of the level we work at since: see Flight.lastMove.)
      const open = f.opened * Math.pow(R, f.lastMove.F - f.pos.F);
      assert.ok(len <= 0.5 * open * (1 + 1e-9) || !(f.clearance > 0), `stepped ${len} of ${open} open`);
      f.sense();
      assert.ok(f.clearance > 0, `in solid at level ${f.pos.F}, ${f.pos.frac}`);
      levels.add(f.pos.F);
    }, seed, dt, boost);
    assert.ok(levels.size >= 2, 'the flight went through more than one level');
  }
});

test('the working level follows how much room there is', () => {
  const flight = new Flight(arcology);
  flight.begin(true);
  wander(flight, 1000, (f) => {
    f.sense();
    // (Out in the open, the sky alone can leave us coarser than it says.)
    if (f.sky > 0) return;
    assert.ok(f.clearance <= 0.5 && f.clearance >= 0.29 / R, `clearance ${f.clearance} at level ${f.pos.F}`);
  }, 4);
});

// The pace goes toward paced(the way open): up, eased (on a log scale, over
// flight.ease seconds); down, at once (to the curve, or a twentieth of the
// clearance). At either curve.
test('speeding up is eased; slowing down is not', () => {
  for (const curve of [0.5, 1]) {
    const flight = new Flight(arcology, { curve });
    flight.begin(true);
    let before = null, rose = 0;
    wander(flight, 1500, (f) => {
      // (In cells of one fixed level, since F moves.)
      const k = Math.pow(R, -f.pos.F), pace = f.pace * k, target = f.paced(f.opened) * k;
      if (before && pace > before.pace) {
        rose++;
        const most = before.pace * Math.pow(Math.max(target / before.pace, 1), 1 - Math.exp(-1 / 60));
        assert.ok(pace <= most * (1 + 1e-9), `curve ${curve}: sped up from ${before.pace} to ${pace}, at most ${most}`);
      }
      assert.ok(pace <= Math.max(target, 0.05 * f.scale * k) * (1 + 1e-9), `curve ${curve}: going at ${pace}, over the curve's ${target}`);
      before = { pace };
    }, 5);
    assert.ok(rose > 100, `curve ${curve}: sped up only ${rose} times`);
  }
});

// The curve: where the way open is the clearance, as fast as in proportion
// to it; four clearances open, twice the clearance's pace (the square root),
// not four times; in proportion at curve 1, to the bit (the way seen however
// far open: reach 0). And as it flies, the way seen no further than 16
// clearances (flight.reach).
test('the pace follows the square root of the way open, in clearances', () => {
  const f = new Flight(arcology, { reach: 0 });
  f.begin(true);
  const c = f.scale;
  assert.ok(Math.abs(f.paced(c) / c - 1) < 1e-12 && Math.abs(f.paced(4 * c) / c - 2) < 1e-12 && Math.abs(f.paced(100 * c) / c - 10) < 1e-12);
  const d = new Flight(arcology);
  d.begin(true);
  assert.ok(Math.abs(d.paced(4 * d.scale) / d.scale - 2) < 1e-12 && Math.abs(d.paced(100 * d.scale) / d.scale - 4) < 1e-12, 'the way seen no further than 16 clearances');
  const g = new Flight(arcology, { curve: 1, reach: 0 });
  g.begin(true);
  for (const x of [0.3, 1, 7.7, 1e6]) assert.equal(g.paced(x * g.scale), x * g.scale);
  assert.throws(() => new Flight(arcology, { curve: 0 }), /flight\.curve is a power/);
  assert.throws(() => new Flight(arcology, { curve: 2 }), /flight\.curve is a power/);
});

test('rewinding comes back to where we started', () => {
  const flight = new Flight(arcology);
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

// The arcology with nothing finer than level 0: there, a wall never opens.
const bare = { ...arcology, cellAir: (L, f, id, seed, dg, level, up) => (level <= 0 ? arcology.cellAir(L, f, id, seed, dg, level, up) : 1) };

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
// are really in ever further up: further than sense() looks as a rule. (From
// inside the building, in its halls, where a wall is never far ahead.)
test('held at a surface for ever, we still know where the air is', () => {
  const flight = inside(new Flight(bare), rand(21));
  press(flight, 80, 1000, (f) => assert.ok(f.clearance > 0, `in solid at level ${f.pos.F}`));
  // (Past where it used to be lost: UP + FAR = 72 levels up.)
  assert.ok(flight.pos.F - flight.room > 72, `the room was never more than ${flight.pos.F - flight.room} levels up`);
});

test('sent somewhere deep, we find the room we are in', () => {
  const flight = inside(new Flight(bare), rand(21));
  press(flight, 80, 1000);
  const { F, frac } = flight.pos;
  const digits = new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()]));
  // (As a link would: nothing known but where.)
  const there = new Flight(bare);
  Object.assign(there.pos, { F, frac: frac.slice(), digits });
  there.begin();
  assert.ok(there.clearance > 0 && there.room < F - 72, `clearance ${there.clearance}, room ${there.room} at ${F}`);
});

// (Past about 223 levels down, a level-0 cell is more level-F cells than a
// number holds, and the room we were in, at level 0, is too far up to ask.)
test('however deep, where the sky is stays a number', () => {
  const flight = new Flight(arcology);
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
    const flight = new Flight(arcology);
    elsewhere(flight, rnd);
    assert.ok(flight.clearance >= 0.08 && flight.sky < 0, `clearance ${flight.clearance}, sky ${flight.sky}`);
    // (Facing the most open of the four ways along the walls.)
    const open = (yaw) => flight.ahead([Math.sin(yaw), 0, -Math.cos(yaw)]);
    const most = Math.max(...[0, 1, 2, 3].map((k) => open((k * Math.PI) / 2)));
    assert.ok(open(flight.yaw) >= most && flight.pitch === 0, 'not facing the most open way');
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
    name: 'two boxes', R: 24, start: [0.5, 0.5, 0.25], fogK: 1, ancestorDigit: () => [0, 0, 0],
    // (The sky far over level 0's cell, and level 0's cell where it is.)
    skyPlane: (j) => (j === 0 ? 1e6 : 0),
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
    const flight = Object.assign(new Flight(twoBoxes(0)), { yaw: Math.PI, pitch });
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
        const flight = Object.assign(new Flight(twoBoxes(wall)), { yaw: Math.PI, pitch });
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
// (From a first visit, out on the plaza; and from inside the building, in
// its halls, for longer.)
test('the way found open is air all the way', () => {
  for (const within of [false, true]) {
  const flight = new Flight(arcology);
  if (within) inside(flight, rand(3));
  else elsewhere(flight, rand(3));
  const rnd = rand(51);
  let i = 0;
  wander(flight, within ? 1500 : 600, (f) => {
    if (i++ % 5) return;
    f.sense();
    for (let k = 0; k < 4; k++) {
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
      const dir = d.map((x) => x / l), open = f.ahead(dir);
      for (let j = 1; j <= 200; j++) {
        const t = (open * j) / 200;
        // (The clearance worked out here, not by Flight.clearanceAt: kept
        // apart from the code it checks.)
        assert.ok(Math.max(f.sky + dir[1] * t, ...f.here.map((r) => -f.airAt(r, dir.map((x) => x * t)) / r.sig)) > -1e-9 * open, `${within ? 'inside' : 'a first visit'}: solid at ${t} of ${open} open`);
      }
    }
  }, 1);
  }
});

// Turning: up or down no further than PITCH_MAX, however far asked; and the
// camera, looking level, is the way we face.
test('turning stops at the furthest up or down, and the camera looking level is the facing', () => {
  const flight = new Flight(arcology);
  flight.turn(0.4, 3);
  assert.equal(flight.pitch, PITCH_MAX);
  assert.equal(flight.yaw, 0.4);
  flight.turn(0, -10);
  assert.equal(flight.pitch, -PITCH_MAX);
  flight.pitch = 0;
  assert.deepEqual(camera(flight), flight.basis());
});

// Sensed after every move: what the view is drawn from is of where we are
// (every level around us, as around() has them, each with its air here);
// sensing again where we are changes nothing; and the last move says which
// level's cells it was in, whatever level we work at since.
test('the flight is sensed where it is, after every move', () => {
  const state = (f) => JSON.stringify([f.pos.F, f.pos.frac, f.clearance, f.scale, f.pace, f.fog, f.fogTarget, f.opened, f.sky, f.room, f.sensed, f.airs]);
  let moves = 0, refined = 0;
  wander(new Flight(arcology), 1500, (f, len) => {
    const asked = f.around().map((rec) => ({ rec, air: f.airAt(rec) }));
    assert.equal(JSON.stringify(f.airs), JSON.stringify(asked), 'the airs are not of where we are');
    const was = state(f);
    f.sense();
    assert.equal(state(f), was, 'sensing again where we are changed something');
    if (len > 0) {
      moves++;
      if (f.lastMove.F !== f.pos.F) refined++;
      assert.ok(Math.abs(Math.hypot(...f.lastMove.delta) - len) <= 1e-12 * len, 'the last move is not the step taken');
    }
  });
  assert.ok(moves > 1000 && refined > 0, `${moves} moves, ${refined} of them followed by a change of level`);
});

// How it flies, as a link may set it (see FLIGHT): at twice the speed, the
// first step out of a room is twice as long; an unknown setting is refused.
test('a flight flies as its settings say', () => {
  const step = (settings) => {
    const f = new Flight(arcology, settings);
    f.begin(true);
    return f.step(1 / 600, [0, 0, -1]);
  };
  const one = step(undefined), two = step({ speed: 2 });
  assert.ok(one > 0 && Math.abs(two / one - 2) < 1e-12, `${one}, ${two}`);
  assert.equal(new Flight(arcology).settings, FLIGHT);
  assert.throws(() => new Flight(arcology, { sped: 2 }), /there is no flight\.sped/);
});

// The tour's travel is carried, not paced (see Flight.step's carry): flown
// with hand flight's settings changed (speed twice or half, speeding up
// eased over 0 s or 3 s), a tour flies the same way, step for step, and
// gets somewhere; each step goes as far as it asks, or half the way open
// where that is less (a carry far too fast, toward whatever is ahead, goes
// exactly half); with the keys' wish too, only the wish's part follows
// flight.speed; and where a sense due at the start of a step moves the
// level, what is carried is taken to the new level's cells.
test('the tour\'s travel is carried, not paced: the same at any flight.speed and flight.ease, as far as it asks, capped at half the way open', () => {
  const opened = (f) => f.opened * Math.pow(R, f.lastMove.F - f.pos.F); // (in the cells of the level the move was made at)
  // (From a first visit, out on the plaza, where the tour goes by looking;
  // and from inside the building, where it plans its way through the halls.)
  const tour = (settings, within) => {
    const flight = new Flight(arcology, settings);
    // (Inside: a start, of those tried, where it has a way to plan.)
    if (within) inside(flight, rand(4));
    else elsewhere(flight, rand(3));
    const pilot = new Pilot(R);
    pilot.planner = new Planner(flight);
    const random = Math.random;
    let s = 77;
    Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    try {
      pilot.start(flight.pos.F);
      const out = [];
      let went = 0, capped = 0, planned = 0;
      for (let i = 0; i < 600; i++) {
        const v = pilot.fly(1 / 60, flight, 1, () => awayFrom(flight), false);
        const F = flight.pos.F, asked = (Math.hypot(...v) / 60) * Math.pow(R, flight.pos.F - F);
        const len = flight.step(1 / 60, [0, 0, 0], [0, 0, 0], v);
        const most = Math.min(asked, 0.5 * opened(flight));
        assert.ok(Math.abs(len - most) <= 1e-12 * most, `step ${i}: went ${len}, asked ${asked}, half the way open ${0.5 * opened(flight)}`);
        if (asked > 0.5 * opened(flight)) capped++;
        went += len / flight.scale;
        pilot.moved(flight.lastMove, flight.pos.F);
        if (pilot.plan) planned++;
        out.push(JSON.stringify([flight.pos.F, flight.pos.frac, flight.yaw, flight.pitch]));
      }
      return { out, went, capped, planned };
    } finally {
      Math.random = random;
    }
  };
  for (const within of [false, true]) {
    const one = tour(undefined, within), where = within ? 'inside' : 'a first visit';
    assert.ok(one.went > 1, `${where}: the tour went ${one.went} clearances in 10 s`);
    assert.ok(!within || one.planned > 60, `inside: the tour followed a plan on ${one.planned} steps`);
    for (const settings of [{ speed: 2 }, { speed: 0.5 }, { ease: 0 }, { ease: 3 }, { speed: 2, ease: 0.2 }]) assert.deepEqual(tour(settings, within).out, one.out, `${where}: ${JSON.stringify(settings)}`);
  }
  // (A carry far too fast: exactly half the way open, and still in air.)
  const f = new Flight(arcology);
  f.begin(true);
  for (let i = 0; i < 30; i++) {
    const { fwd } = f.basis();
    const len = f.step(1 / 60, [0, 0, 0], [0, 0, 0], fwd.map((x) => x * 1e6));
    assert.ok(Math.abs(len - 0.5 * opened(f)) <= 1e-12 * len && f.clearance > 0, `went ${len} of ${opened(f)} open, clearance ${f.clearance}`);
  }
  // (The keys' wish with a carry: the wish's part goes twice as far at
  // flight.speed 2, the carried part the same.)
  const both = (speed) => {
    const g = new Flight(arcology, { speed });
    g.begin(true);
    const pace = g.pace, { fwd, right } = g.basis(), carry = right.map((x) => x * 0.2 * g.scale);
    g.step(1 / 600, fwd, [0, 0, 0], carry);
    const d = g.lastMove.delta, c = carry.map((x) => x / 600);
    return { hand: Math.hypot(...d.map((x, a) => x - c[a])) / pace, carried: d };
  };
  const [s1, s2] = [both(1), both(2)];
  assert.ok(Math.abs(s2.hand / s1.hand - 2) < 0.02, `the wish's part at speed 2 is ${s2.hand / s1.hand} times that at 1`);
  // (Twelve levels too fine, as after a jump: the sense due at the start of
  // a step moves the level the rest of the way, and what is carried is
  // taken to the new level's cells.)
  const jumped = new Flight(arcology);
  jumped.begin(true);
  for (let i = 0; i < 12; i++) jumped.pos.refine();
  jumped.sense();
  assert.ok(jumped.due, 'twelve levels too fine, a sense is due');
  const F = jumped.pos.F, v = [0, 0, -1e-3 * jumped.scale];
  const len = jumped.step(1 / 60, [0, 0, 0], [0, 0, 0], v);
  const asked = (Math.hypot(...v) / 60) * Math.pow(R, jumped.lastMove.F - F);
  assert.ok(jumped.lastMove.F !== F && Math.abs(len - Math.min(asked, 0.5 * opened(jumped))) <= 1e-9 * len, `went ${len}, asked ${asked} (level ${F} to ${jumped.lastMove.F})`);
});

// Somewhere new, the pace is how open it is here (as for a way open as far
// as our clearance), not what senses on the way there left: flying by hand
// gets going at once.
test('somewhere new, flying by hand gets going at once', () => {
  for (const seed of [4, 9, 12]) {
    const f = new Flight(arcology);
    elsewhere(f, rand(seed));
    assert.equal(f.pace, f.paced(f.scale), `seed ${seed}: pace ${f.pace}, scale ${f.scale}`);
    const { fwd } = f.basis();
    let frames = 0;
    while (!(f.step(1 / 60, fwd) * 60 > 0.5 * f.scale) && frames < 600) frames++;
    assert.ok(frames < 6, `seed ${seed}: half a clearance a second after ${frames} frames`);
  }
});

// flight.rise: speeding up never more than rise times over in a second, step
// by step, at any frame rate alike; slowing as without it; out of range
// refused. And flight.reach: the curve sees the way open no further than
// that many clearances.
test('flight.rise caps speeding up, alike at any frame rate, and leaves slowing alone; flight.reach caps the way the curve sees', () => {
  const fly = (settings, hz, seconds = 6, each, within = false) => {
    const f = new Flight(arcology, settings);
    if (within) inside(f, rand(5));
    else f.begin(true);
    for (let i = 0; i < seconds * hz; i++) {
      const was = f.pace * Math.pow(R, -f.pos.F);
      const { fwd } = f.basis();
      f.step(1 / hz, fwd);
      each?.(f, was);
    }
    return f;
  };
  let capped = 0;
  fly({ rise: 1.2 }, 60, 6, (f, was) => {
    const pace = f.pace * Math.pow(R, -f.pos.F);
    assert.ok(pace <= was * Math.pow(1.2, 1 / 60) * (1 + 1e-9), `rose from ${was} to ${pace} in a frame`);
    if (pace >= was * Math.pow(1.2, 1 / 60) * (1 - 1e-9)) capped++;
  });
  assert.ok(capped > 60, `the cap bound on only ${capped} frames`);
  // (Where it ends up after 6 s, at 30, 60 and 120 frames a second: alike.)
  const at = (hz) => {
    const f = fly({ rise: 1.2 }, hz);
    return { pace: f.pace * Math.pow(R, -f.pos.F) };
  };
  const [p30, p60, p120] = [30, 60, 120].map(at);
  for (const p of [p30, p120]) assert.ok(Math.abs(Math.log(p.pace / p60.pace)) < 0.05, `the pace after 6 s: ${p30.pace}, ${p60.pace}, ${p120.pace}`);
  // (Slowing: a cut to the curve, as without the cap. Inside the building,
  // where a wall comes up ahead.)
  let cuts = 0;
  fly({ rise: 1.5 }, 60, 10, (f, was) => {
    const pace = f.pace, target = Math.max(f.paced(f.opened), 0.05 * f.scale);
    assert.ok(pace <= target * (1 + 1e-9), `going at ${pace}, over the curve's ${target}`);
    if (pace * Math.pow(R, -f.pos.F) < was * 0.98) cuts++;
  }, true);
  assert.ok(cuts > 0, 'never slowed');
  for (const rise of [1, 0.5, -2, Infinity]) assert.throws(() => new Flight(arcology, { rise }), /flight\.rise is 0 \(no limit\) or a factor more than 1/, String(rise));
  // (reach: no further than that many clearances.)
  const g = new Flight(arcology, { reach: 8 });
  g.begin(true);
  assert.ok(Math.abs(g.paced(100 * g.scale) / (Math.sqrt(8) * g.scale) - 1) < 1e-12 && Math.abs(g.paced(4 * g.scale) / (2 * g.scale) - 1) < 1e-12);
  for (const reach of [0.5, -1, Infinity]) assert.throws(() => new Flight(arcology, { reach }), /flight\.reach is 0 \(no limit\) or a number of clearances/, String(reach));
});
