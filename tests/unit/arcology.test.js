import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { CITY, ROW_ID, ROWS } from '../../src/spaces/arcology.js';
import { levelSeed, wrapId as wrapIdR } from '../../src/util.js';
import { rand } from './rand.js';

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
