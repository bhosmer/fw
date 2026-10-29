import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS } from '../../src/worlds.js';
import { Flight } from '../../src/flight.js';
import { rand } from './rand.js';

// What every world must be, whatever its arrangement: asked of each in turn
// as the flight asks it (every level around places it might be), so that a
// new world, or a new arrangement of one, is held to them without new tests.

const controls = () => ({ yaw: 0, pitch: 0, boost: () => 1 });

// Places in a world: first visits, and where short flights from them lead.
function places(space, seed, n = 8) {
  const rnd = rand(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    let flight = new Flight(space, controls());
    flight.elsewhere(rnd);
    for (let k = 0; k < 4; k++) {
      flight.sense();
      out.push(flight);
      const next = new Flight(space, controls());
      Object.assign(next.pos, { F: flight.pos.F, frac: flight.pos.frac.slice(), digits: new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()])) });
      next.begin();
      const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      for (let s = 0; s < 40; s++) next.step(1 / 30, dir.map((x) => x * 4));
      flight = next;
    }
  }
  return out;
}

for (const space of WORLDS) {
  // A distance that never overstates changes no faster than the point
  // moves: were it to, one of the two values would be more than the true
  // distance. Pairs of points near the camera and near the surfaces round
  // it, a short way apart (across cell sides and levels as they fall).
  test(`${space.name}: no level's distance changes faster than the point moves`, () => {
    const rnd = rand(11);
    let pairs = 0, worst = 0;
    for (const flight of places(space, 3)) {
      const c = Math.max(flight.clearance, 1e-3);
      for (const r of flight.here) {
        for (let k = 0; k < 30; k++) {
          const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
          const v1 = d.map((x) => (x / l) * c * 2 * rnd());
          const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e);
          const step = c * Math.pow(10, -4 + 4 * rnd());
          const v2 = v1.map((x, a) => x + (e[a] / m) * step);
          const change = Math.abs(flight.airAt(r, v2) - flight.airAt(r, v1)) / r.sig;
          worst = Math.max(worst, change / step);
          assert.ok(change <= step * (1 + 1e-6) + 1e-9 / r.sig, `level ${r.level} at F ${flight.pos.F}: changed ${change} over ${step}`);
          pairs++;
        }
      }
    }
    assert.ok(pairs > 5000 && worst > 0.5, `${pairs} pairs, the steepest ${worst}: the test reaches surfaces`);
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
      const flight = new Flight(space, controls());
      Object.assign(flight.pos, { F, frac: [0.5, 0.5, 0.5], digits: new Map() });
      const [parent] = flight.pos.levels(F - 1, F - 1);
      assert.ok(flight.airAt(parent) >= 0.5, `level ${F} at ${space.ancestorDigit(F)}: ${flight.airAt(parent)}`);
    }
  });

  // For a ray: where a level says how far a ray from a point goes in its air
  // (known), it is in air there just when that is not less than 0; it goes
  // no less far than the distance (each plane is at least that far off
  // along any ray); all of the way is air at that level; and the surface it
  // meets there faces back along it. Along random directions, the axes and
  // the diagonals (where a plane is met exactly edge on).
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
          const dir = e.map((x) => x / m);
          const ray = { dir };
          const a = flight.airAt(r, v, ray);
          assert.equal(a, flight.airAt(r, v), 'the distance is the same, asked with a ray or not');
          if (!ray.known) continue;
          rays++;
          const where = `level ${r.level} at F ${flight.pos.F}, v ${v}, dir ${dir}`;
          assert.equal(ray.reach >= 0, a <= 0, `in air (${a}) but reach ${ray.reach}, ${where}`);
          if (ray.reach < 0) continue;
          inAir++;
          assert.ok(ray.reach >= -a - 1e-9, `reach ${ray.reach} less than the distance ${-a}, ${where}`);
          assert.ok(Math.abs(Math.hypot(ray.nx, ray.ny, ray.nz) - 1) < 1e-9 && ray.nx * dir[0] + ray.ny * dir[1] + ray.nz * dir[2] <= 1e-12, `normal ${[ray.nx, ray.ny, ray.nz]}, ${where}`);
          // (Covered by balls of air, each as big as the distance says.)
          const end = ray.reach / r.sig;
          for (let t = 0, n = 0; t < end * (1 - 1e-6) && n < 4000; n++) {
            const b = flight.airAt(r, v.map((x, i) => x + dir[i] * t));
            assert.ok(b <= 1e-9, `solid (${b}) at ${t * r.sig} of reach ${ray.reach}, ${where}`);
            t += Math.max(-b / r.sig, end * 1e-6);
          }
        }
      }
    }
    if (space.name === 'halls') assert.ok(rays > 1000 && inAir > 300, `${rays} rays, ${inAir} in air: the test reaches what it means to`);
  });

  test(`${space.name}: the world is the same every time`, () => {
    const [a, b] = [places(space, 5, 2), places(space, 5, 2)];
    a.forEach((f, i) => f.here.forEach((r, j) => assert.equal(f.airAt(r, [0.1, 0.2, 0.3]), b[i].airAt(b[i].here[j], [0.1, 0.2, 0.3]))));
  });
}
