import { test } from 'node:test';
import assert from 'node:assert/strict';
import halls from '../../src/spaces/halls.js';
import { levelSeed } from '../../src/util.js';
import { rand } from './rand.js';

const R = halls.R;
const P = R * R;
const wrapId = (id) => id.map((a) => a - P * Math.floor((a + 0.5) / P));

// The distance at a point given as lattice coordinates q (0..R) in cell id.
function air(q, id, seed) {
  const L = q.map(Math.round);
  return halls.cellAir(L, q.map((x, a) => x - L[a]), id, seed, wrapId);
}

// A distance that never overstates changes no faster than the point moves:
// were it to, one of the two values would be more than the true distance.
test('cellAir never changes faster than the point moves', () => {
  const rnd = rand(5);
  let worst = 0;
  for (let n = 0; n < 20000; n++) {
    const id = wrapId([0, 1, 2].map(() => Math.floor(rnd() * P)));
    const seed = levelSeed(Math.floor(rnd() * 40) - 20);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const step = 10 ** (rnd() * 3 - 3); // 0.001 .. 1 lattice units
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...dir);
    const q2 = q.map((x, a) => Math.min(R - 0.51, Math.max(0.51, x + (dir[a] / len) * step)));
    const moved = Math.hypot(...q2.map((x, a) => x - q[a]));
    const change = Math.abs(air(q2, id, seed) - air(q, id, seed));
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${id}`);
  }
  assert.ok(worst > 0.5, 'the test moves through enough surfaces to mean something');
});

test('a cell sits somewhere solid in its parent', () => {
  // ancestorDigit(j) is where the level j cell sits in its level j - 1
  // parent, whose own place is ancestorDigit(j - 1) in its parent: that
  // child cell of the parent must be solid all through.
  for (let j = 5; j >= -30; j--) {
    const d = halls.ancestorDigit(j);
    const up = halls.ancestorDigit(j - 1), upper = halls.ancestorDigit(j - 2);
    const parent = wrapId(up.map((x, a) => x + R * upper[a]));
    const centre = d.map((x) => x + 0.5);
    assert.ok(air(centre, parent, levelSeed(j - 1)) >= 0.5, `level ${j} at ${d}`);
  }
});

test('the world is the same every time', () => {
  const a = [-3, 0, 4].map((j) => halls.ancestorDigit(j).join());
  const b = [-3, 0, 4].map((j) => halls.ancestorDigit(j).join());
  assert.deepEqual(a, b);
  assert.deepEqual(halls.palette(7), halls.palette(7));
  assert.notDeepEqual(halls.palette(7), halls.palette(8));
});
