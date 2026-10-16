import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position, DIAGONALS } from '../../src/position.js';
import halls from '../../src/spaces/halls.js';
import { rand } from './rand.js';

const R = halls.R;
const fresh = (frac) => new Position(R, (j) => halls.ancestorDigit(j), frac);

// Where we are in our level-k cell, as a fraction of it, worked out the slow,
// obvious way: fold the digits from F up to k + 1 into frac.
function within(pos, k) {
  const u = pos.frac.slice();
  for (let j = pos.F; j > k; j--) for (let a = 0; a < 3; a++) u[a] = (pos.digit(j)[a] + u[a]) / R;
  return u;
}

test('moving there and back returns to the same place', () => {
  const rnd = rand(7);
  for (let n = 0; n < 200; n++) {
    const pos = fresh([rnd(), rnd(), rnd()]);
    const start = { frac: pos.frac.slice(), digits: [0, -1, -2, -3].map((j) => pos.digit(j).slice()) };
    const d = [0, 1, 2].map(() => (rnd() - 0.5) * 10 ** (rnd() * 6 - 2)); // up to ~10^4 cells
    pos.move(d);
    pos.move(d.map((x) => -x));
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(pos.frac[a] - start.frac[a]) < 1e-9, `frac ${a}`);
    [0, -1, -2, -3].forEach((j, i) => assert.deepEqual(pos.digit(j), start.digits[i], `digit ${j}`));
  }
});

test('a move of whole cells carries into the digits', () => {
  const pos = fresh([0.25, 0.5, 0.75]);
  const before = within(pos, -3);
  pos.move([R * R, 0, -1]); // a whole level -2 cell along x, one cell back along z
  const after = within(pos, -3);
  // (Differences taken round the cell, in case the move crossed its edge.)
  const moved = (a) => ((after[a] - before[a] + 1.5) % 1) - 0.5;
  assert.ok(Math.abs(moved(0) - 1 / R) < 1e-12);
  assert.ok(Math.abs(moved(2) + 1 / R ** 3) < 1e-12);
  assert.equal(after[1], before[1]);
});

test('refining and coarsening are each other\'s inverse', () => {
  const rnd = rand(3);
  for (let n = 0; n < 100; n++) {
    const pos = fresh([rnd(), rnd(), rnd()]);
    const frac = pos.frac.slice();
    const k = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < k; i++) pos.refine();
    assert.equal(pos.F, k);
    for (let i = 0; i < k; i++) pos.coarsen();
    assert.equal(pos.F, 0);
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(pos.frac[a] - frac[a]) < 1e-12);
  }
});

test('levels() places us where the digits say, at every level', () => {
  const rnd = rand(11);
  for (let n = 0; n < 50; n++) {
    const pos = fresh([rnd(), rnd(), rnd()]);
    for (let i = Math.floor(rnd() * 5); i > 0; i--) pos.refine();
    for (const rec of pos.levels(pos.F - 4, pos.F + 2)) {
      assert.equal(rec.sig, Math.pow(R, rec.level + 1 - pos.F));
      for (let a = 0; a < 3; a++) {
        assert.ok(Number.isInteger(rec.L[a]) && rec.L[a] >= 0 && rec.L[a] <= R, 'L on the lattice');
        assert.ok(Math.abs(rec.f[a]) <= 0.5, 'f within half a unit');
      }
      // Finer than F, the slow way is just as exact; coarser, compare to it.
      if (rec.level >= pos.F) continue;
      const u = within(pos, rec.level);
      for (let a = 0; a < 3; a++) assert.ok(Math.abs(rec.L[a] + rec.f[a] - R * u[a]) < 1e-9, `level ${rec.level}`);
      DIAGONALS.forEach(([a, b], p) => {
        const sum = rec.L[a] + rec.f[a] + rec.L[b] + rec.f[b];
        const diff = rec.L[a] + rec.f[a] - (rec.L[b] + rec.f[b]);
        assert.ok(Math.abs(rec.Lp[p] + rec.fp[p] - sum) < 1e-9, 'sum along a diagonal');
        assert.ok(Math.abs(rec.Lm[p] + rec.fm[p] - diff) < 1e-9, 'difference along a diagonal');
        assert.ok(Math.abs(rec.fp[p]) <= 0.5 && Math.abs(rec.fm[p]) <= 0.5);
      });
    }
  }
});

test('close to a surface far coarser than F, the offset keeps its precision', () => {
  // Just off a lattice plane of level -1 (a level 0 cell boundary) by half a
  // cell of level 19: 0.5 * 24^-20 level 0 cells, far below what adding to
  // anything of order one could keep.
  const pos = fresh([0, 0, 0.5]);
  pos.digits.set(0, [3, 3, 3]);
  for (let i = 0; i < 20; i++) pos.refine();
  pos.frac[0] = 0.5;
  // (levels() works out from F, so the range must reach it.)
  const [rec] = pos.levels(-1, pos.F);
  assert.equal(rec.L[0], 3);
  assert.ok(Math.abs(rec.f[0] / (0.5 * R ** -20) - 1) < 1e-9, `f = ${rec.f[0]}`);
  // And a diagonal plane x + y = c, with y as close to its own plane as x.
  pos.frac[1] = 0.5;
  const [d] = pos.levels(-1, pos.F);
  const p = DIAGONALS.findIndex(([a, b]) => a === 0 && b === 1);
  assert.ok(Math.abs(d.fp[p] / (R ** -20) - 1) < 1e-9, `fp = ${d.fp[p]}`);
});

test('close to a diagonal plane, the offset along it keeps its precision', () => {
  // x + y just off a whole number where neither x nor y is anywhere near one
  // (x = 3 + 7/24, y = 2 + 17/24 level 0 cells, then x a little more): their
  // offsets are each about 0.3 and cancel, so the sum has to be carried as
  // its own number to keep anything of the little more.
  const pos = fresh([7 / R, 17 / R, 0.5]);
  pos.digits.set(0, [3, 2, 3]);
  for (let i = 0; i < 20; i++) pos.refine();
  pos.frac[0] = 0.5;
  const [rec] = pos.levels(-1, pos.F);
  const p = DIAGONALS.findIndex(([a, b]) => a === 0 && b === 1);
  assert.equal(rec.Lp[p], 6);
  assert.ok(Math.abs(rec.fp[p] / (0.5 * R ** -20) - 1) < 1e-9, `fp = ${rec.fp[p]}`);
});
