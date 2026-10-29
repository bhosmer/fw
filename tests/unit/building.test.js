import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { makeArcology } from '../../src/spaces/arcology.js';
import { shape, hexahedron } from '../../src/spaces/hexahedron.js';
import { viewFrag } from '../../src/shaders.js';
import { Flight } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';
import { rayHolds } from './rays.js';

// The building's shape follows from a few numbers (see shape in
// hexahedron.js): the star's ring, the masses' slopes, the bands. Shapes
// other than its own are built, and hold what they must; what cannot be
// built is refused, saying why.

// Shapes that the relief's measure and the town allow: the upper steeper
// and shallower, the open storey taller and lower, the plate thicker.
const SHAPES = [
  { slopes: { upper: [1, 16] } },
  { slopes: { upper: [3, 80] } },
  { slopes: { upper: [1, 28] } },
  { slopes: { upper: [3, 64] } },
  { bands: { storey: 2.5 } },
  { bands: { storey: 0.75 } },
  { bands: { plate: 1.25 } },
];
test('the building as it is: its heights and planes as they have always been', () => {
  assert.deepEqual(shape().heights, { apexLo: 0, roofLo: 16.25, roofHi: 17, plateLo: 18.5, plateHi: 19.25, apexHi: 34.25 });
  const planes = Object.fromEntries(hexahedron().filter((s) => s.name !== 'pillar').map((s) => [s.name, s.planes.map((p) => [...p.n, p.K])]));
  assert.deepEqual(planes.upper.slice(0, 3), [[0, 52, -90, 1781], [78, 52, 45, 1781], [-78, 52, 45, 1781]]);
  assert.deepEqual(planes.lower.slice(0, 3), [[0, -8, 15, 0], [26, -16, -15, 0], [-26, -16, -15, 0]]);
});

test('the building in other shapes: built, and holding what it must', () => {
  const shader = viewFrag(12, arcology, true);
  for (const set of SHAPES) {
    const where = JSON.stringify(set), made = makeArcology({ building: set }), def = made.def.building;
    const { heights, d, hex } = shape(def), D = d[0] / d[1];
    assert.notEqual(viewFrag(12, made.arcology, true), shader, `${where}: the same shader as the building's own`);
    // (Each mass's apex on all its faces; each rim's sides its mass's base
    // edges; each pillar where two of the triangles' sides cross.)
    const solids = hexahedron(def), on = (p, X) => Math.abs(p.n[0] * X[0] + p.n[1] * X[1] + p.n[2] * X[2] - p.K) < 1e-9 * Math.hypot(...p.n);
    const upper = solids.find((s) => s.name === 'upper'), lower = solids.find((s) => s.name === 'lower');
    assert.ok(upper.planes.slice(0, 3).every((p) => on(p, [0, heights.apexHi, 0])), `${where}: the upper's apex`);
    assert.ok(lower.planes.slice(0, 3).every((p) => on(p, [0, 0, 0])), `${where}: the lower's apex`);
    const plate = solids.find((s) => s.name === 'plate'), roof = solids.find((s) => s.name === 'roof');
    for (const [rim, mass, y] of [[plate, upper, heights.plateHi], [roof, lower, heights.roofLo]])
      rim.planes.slice(0, 3).forEach((p, i) => {
        // (Where the mass's face meets its base height, square to the side: a
        // point on the rim's side.)
        const [nx, , nz] = p.n, h = Math.hypot(nx, nz), X = [(nx / h) * ((p.K / h)), y, (nz / h) * (p.K / h)];
        assert.ok(on(mass.planes[i], X), `${where}: ${rim.name}'s side ${i} off ${mass.name}'s base edge`);
      });
    const lines = (OUT) => OUT.map(([x, z]) => (X) => Math.abs(x * X[0] + z * X[1] - 30 * D) < 1e-9);
    const ups = lines([[0, -30], [26, 15], [-26, 15]]), downs = lines([[0, 30], [26, -15], [-26, -15]]);
    for (const c of hex) assert.ok(ups.some((l) => l(c)) && downs.some((l) => l(c)), `${where}: a pillar at ${c} not where the triangles cross`);
    // (Its slants no more than the building's own: the uniforms' arrays.
    // Fewer where the masses' faces share their directions.)
    assert.ok(made.arcology.slants.length <= arcology.slants.length, `${where}: ${made.arcology.slants.length} slants`);
  }
});

// Three of them flown through: what a level says of a ray holds (see
// rayHolds), at first visits and where short flights from them lead.
test('the building in other shapes: rays hold in it', () => {
  for (const set of [SHAPES[0], SHAPES[1], SHAPES[4]]) {
    const space = makeArcology({ building: set }).arcology, rnd = rand(29);
    let rays = 0, inAir = 0;
    for (let i = 0; i < 6; i++) {
      const flight = new Flight(space, { yaw: 0, pitch: 0, boost: () => 1 });
      elsewhere(flight, rnd);
      for (let s = 0; s < 3; s++) {
        flight.sense();
        const c = Math.max(flight.clearance, 1e-3);
        for (const r of flight.here)
          for (let k = 0; k < 6; k++) {
            const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e), d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
            const said = rayHolds(flight, r, d.map((x) => (x / l) * c * 2 * rnd()), e.map((x) => x / m), JSON.stringify(set));
            rays += said.known;
            inAir += said.inAir;
          }
        const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
        for (let t = 0; t < 30; t++) flight.step(1 / 30, dir.map((x) => x * 4));
      }
    }
    assert.ok(rays > 500 && inAir > 50, `${JSON.stringify(set)}: ${rays} rays, ${inAir} in air: the test reaches what it means to`);
  }
});

test('a shape that cannot be built is refused, saying why', () => {
  for (const [set, said] of [
    [{ ring: 11 }, /ring 11: a multiple of 5\/4/],
    [{ ring: 11.25 }, /the lower's slope \[1,16\] puts its base at 18\.28125, not a whole quarter \(slopes that would, at ring 11\.25: \[1,15\]/],
    [{ slopes: { lower: [1, 20] } }, /the roof band's top at 13\.75, not a whole cell, as the town needs \(bands\.roof 1 would\)/],
    [{ bands: { roof: 1 } }, /the roof band's top at 17\.25, not a whole cell/],
    [{ bands: { plate: 0.75, storey: 2.25 } }, /the plate's top at 20: it must be a whole quarter, not a whole cell/],
    [{ slopes: { upper: [2, 35] } }, /the faces of upper are too fine for the relief's whole numbers \(zone tests\)/],
    [{ slopes: { upper: [1, 8] } }, /over the sky/],
  ])
    assert.throws(() => makeArcology({ building: set }), said, JSON.stringify(set));
});
