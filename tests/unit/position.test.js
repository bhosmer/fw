import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position, DIAGONALS, zoomed } from '../../src/position.js';
import { Flight } from '../../src/flight.js';
import { into } from './corner.js';
import arcology from '../../src/spaces/arcology.js';
import { rand } from './rand.js';

const R = arcology.R;
const fresh = (frac) => new Position(R, (j) => arcology.ancestorDigit(j), frac);

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

// Close to a room's corner, edge or ceiling far coarser than F, the room's
// level zoomed about where its planes near us meet is the level as it is:
// the same distances and rays, in level-F cells, out to valid.
test('a level zoomed about the corner of it we are near is as it is, out to where it holds', () => {
  for (const to of ['corner', 'edge', 'ceiling'])
    for (const gap of [26, 40, 80]) {
      let got = null;
      for (let seed = 1; !got && seed <= 12; seed++) got = into(new Flight(arcology), { seed, gap, to });
      assert.ok(got, `no place ${gap} levels below a room's ${to}`);
      const { flight, room } = got, rec = flight.airs.find((a) => a.rec.level === room).rec;
      const z = zoomed(rec, arcology.slants, Math.pow(R, flight.pos.F - room - 24), 1e21, { slanted: arcology.slanted(room) });
      assert.equal(z.valid, 1e21, `${to}, ${gap} up: it holds only ${z.valid}`);
      const rnd = rand(3);
      for (let i = 0; i < 200; i++) {
        const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d), r = 0.9 * z.valid * Math.pow(10, -22 * rnd());
        const v = d.map((x) => (x / l) * r), e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], el = Math.hypot(...e), dir = e.map((x) => x / el);
        const a = { dir }, b = { dir };
        const da = flight.airAt(rec, v, a) / rec.sig, db = flight.airAt(z.rec, v, b) / z.rec.sig;
        assert.ok(Math.abs(da - db) <= 1e-12 * Math.max(Math.abs(da), 1e-9 * r), `${to}, ${gap} up, ${r} away: ${da} as it is, ${db} zoomed`);
        assert.equal(a.reach >= 0, b.reach >= 0, `${to}, ${gap} up: in air one way and not the other`);
        if (a.reach >= 0) {
          const x = Math.min(a.reach / rec.sig, z.valid - r), y = Math.min(b.reach / z.rec.sig, z.valid - r);
          assert.ok(Math.abs(x - y) <= 1e-12 * Math.max(x, 1e-9 * r), `${to}, ${gap} up: a ray goes ${x} as it is, ${y} zoomed`);
        }
      }
    }
});

// Planes near us that do not meet where the others do: the zoom is about
// where those others meet, and holds no further than the one that misses.
test('a level zoomed holds no further than a plane near us that misses where the rest meet', () => {
  // (By hand: at (0.001, 0.2, 0.3) lattice units, sig 1. The nearest
  // planes, 3x + 5y = 1, x = 0 and z - y = 0, meet at (0, 0.2, 0.2); the next,
  // x - y = 0 and x + y = 0 (0.14 away) and y = 0 (0.2), miss it. Of the
  // first two alone, z - y = 0 misses where they meet nearest us.)
  const at = [0.001, 0.2, 0.3], slants = [[3, 5, 0]];
  const rec = { L: [0, 0, 0], f: at.slice(), sig: 1, Lp: [0, 0, 0], fp: [0, 0, 0], Lm: [0, 0, 0], fm: [0, 0, 0], Ls: [1], fs: [3 * at[0] + 5 * at[1] - 1] };
  DIAGONALS.forEach(([a, b], p) => {
    (rec.Lp[p] = Math.round(at[a] + at[b])), (rec.fp[p] = at[a] + at[b] - rec.Lp[p]);
    (rec.Lm[p] = Math.round(at[a] - at[b])), (rec.fm[p] = at[a] - at[b] - rec.Lm[p]);
  });
  const z = zoomed(rec, slants, 1, 0.25);
  // (Asking about the planes within a tenth: the first two meet in the line
  // x = 0, y = 0.2, p0 on it nearest us, (0, 0.2, 0.3); the nearest plane that
  // misses it is z - y = 0, 0.1 / root 2 off, less how far we are from p0,
  // 0.001. Asking further, about z - y = 0 too, p0 is (0, 0.2, 0.2), 0.1 from
  // us, and x - y = 0 0.2 / root 2 from it: it holds less far.)
  assert.ok(Math.abs(z.valid - (0.1 / Math.SQRT2 - 0.001)) < 1e-6, `it holds ${z.valid}, not ${0.1 / Math.SQRT2 - 0.001}`);
  // (Scaled by 1, it is the record as it was.)
  assert.deepEqual([z.rec.f, z.rec.fs, z.rec.sig], [rec.f, rec.fs, rec.sig]);
});
