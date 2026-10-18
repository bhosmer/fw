import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { CITY, ROW_ID, ROWS, VOLUME } from '../../src/spaces/arcology.js';
import { levelSeed, wrapId as wrapIdR } from '../../src/util.js';
import { rand } from './rand.js';
import { Flight } from '../../src/flight.js';

const R = arcology.R;
const P = R * R;
const wrapId = (id) => wrapIdR(id, R);
const seed = levelSeed(CITY);

// The distance at a point given as lattice coordinates q (0..R) in cell id
// of the city's level.
function air(q, id) {
  const L = q.map(Math.round);
  return arcology.cellAir(L, q.map((x, a) => x - L[a]), id, seed, undefined, CITY);
}
const anywhere = (rnd, row) => wrapId([Math.floor(rnd() * P), row, Math.floor(rnd() * P)]);

// (As for the halls: a distance that never overstates changes no faster
// than the point moves.) In the city, the halls under it and the sky over it.
test('the city never changes faster than the point moves', () => {
  const rnd = rand(7);
  let worst = 0;
  for (let n = 0; n < 30000; n++) {
    const id = anywhere(rnd, ROW_ID + [-1, 0, 0, 1, 2][n % 5]);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const step = 10 ** (rnd() * 3 - 3);
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...dir);
    const q2 = q.map((x, a) => Math.min(R - 0.51, Math.max(0.51, x + (dir[a] / len) * step)));
    const moved = Math.hypot(...q2.map((x, a) => x - q[a]));
    const change = Math.abs(air(q2, id) - air(q, id));
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${id}`);
  }
  assert.ok(worst > 0.5, 'the test moves through enough surfaces to mean something');
});

// Where a city cell meets the hall under it, the two say the same about
// what is air (the light wells go through), and neither says air is further
// off than the other finds it.
test('the city and the halls under it agree where they meet', () => {
  const rnd = rand(8);
  let wells = 0;
  for (let n = 0; n < 20000; n++) {
    const id = anywhere(rnd, ROW_ID);
    const below = wrapId([id[0], id[1] - 1, id[2]]);
    const x = 0.6 + rnd() * (R - 1.2), z = 0.6 + rnd() * (R - 1.2);
    const up = air([x, 0.01, z], id), down = air([x, R - 0.01, z], below);
    if (up < -0.03 || down < -0.03) wells++;
    assert.ok(Math.abs(up - down) <= 0.02 + 1e-9, `at ${x}, ${z} in ${id}: ${up} above, ${down} below`);
  }
  assert.ok(wells > 100, `the test meets light wells (${wells} times)`);
});

// Above the city there is only sky: a cell there says how far down the city
// is, which is never more than how far down its air is.
test('over the city, a cell says no more than how far down it is', () => {
  const rnd = rand(9);
  for (let n = 0; n < 2000; n++) {
    const id = anywhere(rnd, ROW_ID + ROWS + Math.floor(rnd() * 3));
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const down = q[1] + R * (id[1] - ROW_ID - ROWS);
    assert.ok(Math.abs(air(q, id) - down) < 1e-9);
  }
});

test('coarser than the city, all is solid', () => {
  for (const level of [CITY - 1, CITY - 5]) {
    assert.ok(arcology.cellAir([12, 12, 12], [0, 0, 0], [0, ROW_ID, 0], levelSeed(level), undefined, level) >= 1e8);
  }
});

// Just what Flight needs of the controls.
const controls = () => ({ yaw: 0, pitch: 0, boost: () => 1 });
// Fly straight ahead (yaw 0, level) n steps from somewhere in the city,
// given as the digits of our level -2 and -1 cells.
function flyFrom(d2, d1, frac, n, each) {
  const flight = new Flight(arcology, controls());
  flight.pos.F = -1;
  flight.pos.frac = frac;
  flight.pos.digits.set(-2, d2);
  flight.pos.digits.set(-1, d1);
  flight.begin();
  for (let i = 0; i < n; i++) {
    flight.step(1 / 60, [0, 0, -1]);
    each(flight, i);
  }
}

test('flying level just over the city goes as fast as its buildings are clear', () => {
  // (Not by how far over the sky's plane we are: half a cell over it, that
  // was about a cell a second.)
  let moved = 0;
  flyFrom([12, ROW_ID % R + ROWS, 12], [12, 0, 0], [0.5, 0.5, 0.5], 600, (f, i) => {
    if (i >= 300) moved += Math.hypot(...f.lastMove) * Math.pow(R, -1 - f.pos.F);
  });
  assert.ok(moved > 10, `${moved} cells in 5 s`);
});

test('pressed against a building many levels down, flight stays out of it', () => {
  // (Toward the face of a shaft of the great hexahedron, from just in front.)
  flyFrom([12, ROW_ID % R, 12], [9, 3, 8], [0.13, 0.18, 0.5], 6000, (f) => assert.ok(f.clearance > 0, `F ${f.pos.F}: ${f.clearance}`));
});

test('the galleries are boxes, each said alike by every cell its air reaches, and none touches another', () => {
  const { size, data } = VOLUME;
  const box = new Map(); // each cell with a gallery's air in it: that gallery, as absolute cells
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const i = x + size[0] * (y + size[1] * z), m = data[2 * i];
    if (!(m & (1 << 30))) continue;
    const c = [x, y, z];
    const lo = c.map((v, a) => v + ((m >>> (8 * a)) & 15) - 8), hi = c.map((v, a) => v + ((m >>> (8 * a + 4)) & 15) - 8);
    const taken = !!(m & (1 << 31)), inBox = c.every((v, a) => v >= lo[a] && v <= hi[a]);
    assert.equal(taken, inBox, `cell ${c}: all air exactly when it is in its gallery`);
    box.set(i, `${lo}|${hi}|${(m >>> 24) & 63}`);
  }
  assert.ok(new Set(box.values()).size > 100, `${new Set(box.values()).size} galleries`);
  for (const [i, name] of box) {
    const c = [i % size[0], Math.floor(i / size[0]) % size[1], Math.floor(i / (size[0] * size[1]))];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = c[0] + dx + size[0] * (c[1] + dy + size[1] * (c[2] + dz));
      if (box.has(j)) assert.equal(box.get(j), name, `two galleries meet at ${c}`);
    }
  }
});
