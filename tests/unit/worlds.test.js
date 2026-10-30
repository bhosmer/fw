import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, makeWorld } from '../../src/worlds.js';
import { Flight } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';
import { rayHolds } from './rays.js';

// What every world must be, whatever its arrangement: asked of each in turn
// as the flight asks it (every level around places it might be), so that a
// new world, or a new arrangement of one, is held to them without new tests.

// Places in a world: first visits, and where short flights from them lead.
function places(space, seed, n = 8) {
  const rnd = rand(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    let flight = new Flight(space);
    elsewhere(flight, rnd);
    for (let k = 0; k < 4; k++) {
      flight.sense();
      out.push(flight);
      const next = new Flight(space);
      Object.assign(next.pos, { F: flight.pos.F, frac: flight.pos.frac.slice(), digits: new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()])) });
      next.begin();
      const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      for (let s = 0; s < 40; s++) next.step(1 / 30, dir.map((x) => x * 4));
      flight = next;
    }
  }
  return out;
}

for (const { space } of await Promise.all(WORLDS.map((name) => makeWorld(name)))) {
  // A distance that never overstates mostly changes no faster than the
  // point moves: an exact one cannot, and were it to here, one of the two
  // values would likely be more than the true distance. But a distance may
  // say less than the truth (a cell's is capped at its sides, as the
  // buildings' are, where the next cell's air may be just across): beside
  // one that is not, it may change faster. There the ball each value claims
  // (air all through, or none) is asked about directly. Pairs of points near
  // the camera and near the surfaces round it, a short way apart (across
  // cell sides and levels as they fall).
  test(`${space.name}: no level's distance changes faster than the point moves, or overstates`, () => {
    const rnd = rand(11);
    let pairs = 0, worst = 0, balls = 0;
    // (The ball round v that a, the level's distance there, claims: no point
    // in it on the other side of the surface.)
    const claim = (flight, r, v, a, where) => {
      const tol = 1e-9 + 1e-9 * Math.abs(a);
      for (let k = 0; k < 400; k++) {
        const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...e), t = (Math.abs(a) / r.sig) * Math.cbrt(k < 100 ? 1 : rnd()) * (1 - 1e-9);
        const b = flight.airAt(r, v.map((x, i) => x + (e[i] / l) * t));
        assert.ok(a > 0 ? b > -tol : b < tol, `level ${r.level} at F ${flight.pos.F}: ${a} at ${v}, but ${b} within it, ${where}`);
      }
    };
    for (const flight of places(space, 3)) {
      const c = Math.max(flight.clearance, 1e-3);
      for (const r of flight.here) {
        for (let k = 0; k < 30; k++) {
          const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
          const v1 = d.map((x) => (x / l) * c * 2 * rnd());
          const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e);
          const step = c * Math.pow(10, -4 + 4 * rnd());
          const v2 = v1.map((x, a) => x + (e[a] / m) * step);
          const a1 = flight.airAt(r, v1), a2 = flight.airAt(r, v2), change = Math.abs(a2 - a1) / r.sig;
          worst = Math.max(worst, change / step);
          if (change > step * (1 + 1e-6) + 1e-9 / r.sig) {
            const where = `changed ${change} over ${step}`;
            claim(flight, r, v1, a1, where);
            claim(flight, r, v2, a2, where);
            balls++;
          }
          pairs++;
        }
      }
    }
    assert.ok(pairs > 5000 && worst > 0.5, `${pairs} pairs, the steepest ${worst}: the test reaches surfaces`);
    // (The balls are asked about seldom: were they often, the distance
    // would be capped widely, and the rule above would say little.)
    assert.ok(balls <= pairs / 100, `${balls} of ${pairs} pairs changed faster than the point moved`);
  });

  // Where nothing says otherwise, a cell sits in its parent at
  // ancestorDigit, which must be solid all through. (Not where a world puts
  // its default place in air on purpose: the arcology's, standing on the
  // plaza, at the two levels finer than the city. Which rule holds for every world is open:
  // ledger A1.)
  const onPurpose = space.name === 'arcology' ? [-1, 0] : [];
  test(`${space.name}: a cell sits somewhere solid in its parent`, () => {
    for (let F = -8; F <= 6; F++) {
      if (onPurpose.includes(F)) continue;
      const flight = new Flight(space);
      Object.assign(flight.pos, { F, frac: [0.5, 0.5, 0.5], digits: new Map() });
      const [parent] = flight.pos.levels(F - 1, F - 1);
      assert.ok(flight.airAt(parent) >= 0.5, `level ${F} at ${space.ancestorDigit(F)}: ${flight.airAt(parent)}`);
    }
  });

  // What a level says of a ray holds (see rayHolds), along random
  // directions, the axes and the diagonals (where a plane is met exactly
  // edge on).
  test(`${space.name}: what a level says of a ray holds`, () => {
    const rnd = rand(17);
    const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, -1], [Math.SQRT1_2, 0, Math.SQRT1_2], [0, -Math.SQRT1_2, Math.SQRT1_2]];
    let rays = 0, inAir = 0;
    for (const flight of places(space, 7)) {
      const c = Math.max(flight.clearance, 1e-3);
      for (const r of flight.here) {
        for (let k = 0; k < 12; k++) {
          const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
          const v = d.map((x) => (x / l) * c * 2 * rnd());
          const e = k < dirs.length ? dirs[k] : [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
          const m = Math.hypot(...e);
          const said = rayHolds(flight, r, v, e.map((x) => x / m));
          rays += said.known;
          inAir += said.inAir;
        }
      }
    }
    assert.ok(rays > 1000 && inAir > 100, `${rays} rays, ${inAir} in air: the test reaches what it means to`);
  });

  test(`${space.name}: the world is the same every time`, () => {
    const [a, b] = [places(space, 5, 2), places(space, 5, 2)];
    a.forEach((f, i) => f.here.forEach((r, j) => assert.equal(f.airAt(r, [0.1, 0.2, 0.3]), b[i].airAt(b[i].here[j], [0.1, 0.2, 0.3]))));
  });
}
