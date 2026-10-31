// The relief as listed pieces (src/spaces/relief.js): the same air as its
// decisions cut before (relief-air.json), but where the listed form is
// declared to differ; lists that hold every piece's air where it is; rows
// that say what the pieces and lists say; and both copies' carve, which
// asks them, never overstating, nor changing faster than the point moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _V2, VOLUME } from '../../src/spaces/arcology.js';
import { rand } from './rand.js';
import { reliefSamples } from './relief-samples.js';

const { ORIGIN: O, FACES } = _V2, R = 24, BAND_OUT = 1.01;
const L = _V2.listed(), pieces = L._pieces;
const vlo = VOLUME.lo.map((x, a) => x - O[a]), vsz = VOLUME.size, NC = vsz[0] * vsz[1] * vsz[2];
const cellIndex = (c) => { const v = c.map((x, a) => x - vlo[a]); return VOLUME.within(v) ? VOLUME.at(v) : -1; };
const corner = (ci) => [(ci % vsz[0]) + vlo[0], (Math.floor(ci / vsz[0]) % vsz[1]) + vlo[1], Math.floor(ci / vsz[0] / vsz[1]) + vlo[2]];
const word = (ci, w) => VOLUME.data[VOLUME.words * ci + w];
const faceOf = (p) => (p.src >>> 24) >> 2;
// (A piece's distance at X, finer units from the origin: the most of its planes'.)
const dist = (p, X) => { let d = -Infinity; for (const q of p.planes) d = Math.max(d, (q.a[0] * X[0] + q.a[1] * X[1] + q.a[2] * X[2] - q.b) / Math.hypot(...q.a)); return d; };
// (The table's cell of X, finer units, at either level: the city's level's
// table cells are its lattice's units, R finer units.)
const cellOf = (X) => cellIndex(X.map((x) => Math.floor(x / R)));
// The listed relief at X (finer units) at level lv: the least over its cell's list.
const listedAt = (lv, X) => { const ci = cellOf(X); let d = Infinity; if (ci >= 0) for (const i of L._lists[lv][ci]) d = Math.min(d, dist(pieces[i], X)); return d; };
// The JavaScript's carve at X (finer units) at level lv, as the city's cell
// or the table's skin cell asks it (in the level's units); one level finer,
// only in a skin cell.
function carveAt(lv, X) {
  const Xl = lv === 0 ? X.map((x) => x / R) : X;
  const c = Xl.map((x) => Math.floor(x / R)), q = Xl.map((x, a) => x - R * c[a]), W = q.map(Math.round), f = q.map((x, a) => x - W[a]);
  if (lv === 1) { const ci = cellIndex(c); if (ci < 0 || (word(ci, 0) & 3) !== _V2.BITS.SKIN) return Infinity; }
  _V2.setPoint(W, f);
  return _V2.reliefCarve(lv, W, f, c.map((x) => x * R));
}
// Where the listed relief is declared to differ (plan 2.2):
// - at the city's level, past BAND_OUT in front of a face but short of its
//   pockets' out-plane (a unit past the face, in its own whole numbers),
//   where the faces the city's pockets were asked of stopped;
// - one level finer, within a unit of n_h . X of a terrace's wall, now on
//   the lattice of n_h (a plane across, a = n_h / c, fading as a back).
function declared(lv, X) {
  if (lv === 0) return FACES.some((F) => { const s = (F.n[0] * X[0] + F.n[1] * X[1] + F.n[2] * X[2]) / R - F.K; return s / F.nl > BAND_OUT && s <= Math.ceil(F.nl) + 1e-9; });
  const ci = cellOf(X);
  return ci >= 0 && L._lists[1][ci].some((i) => pieces[i].planes.some((q, j) => q.a[1] === 0 && (pieces[i].rows[j][0] >> 9) === 1 && Math.abs(q.a[0] * X[0] + q.a[2] * X[2] - q.b) <= 1));
}
const SAMPLES = reliefSamples(VOLUME, O, _V2.BITS.SKIN, R);
// (The air at them as the relief's decisions cut it before (relief-air.json):
// 0 on a surface, 1 air, 2 solid.)
const AIR = JSON.parse(readFileSync(new URL('./relief-air.json', import.meta.url), 'utf8'));
const airBits = Buffer.from(AIR.bits, 'base64'), airAt = (i) => (airBits[i >> 2] >> (2 * (i & 3))) & 3;

test('the listed relief is the air its decisions cut, but where it is declared to differ', () => {
  assert.equal(AIR.n, SAMPLES.length);
  const out = [0, 1].map(() => ({ pts: 0, air: 0, declared: 0, differ: 0 })), ex = [];
  SAMPLES.forEach(({ lv, X }, i) => {
    const was = airAt(i), b = listedAt(lv, X), c = carveAt(lv, X);
    // (Both copies alike: the pieces' own distances in air, and air where they are.)
    if (b < 0 || c < 0) assert.ok(Math.abs(b - (lv === 0 ? c * R : c)) < 1e-6 * R, `level ${lv} at ${X}: listed ${b}, carve ${c}`);
    if (was === 0 || Math.abs(b) < 1e-9) return;
    const o = out[lv];
    o.pts++;
    if (was === 1) o.air++;
    if ((was === 1) === b < 0) return;
    if (declared(lv, X)) return void o.declared++;
    o.differ++;
    if (ex.length < 5) ex.push({ lv, X, was, b });
  });
  for (const o of out) assert.ok(o.pts > 25000 && o.air > 2000, JSON.stringify(out));
  assert.equal(out[0].differ + out[1].differ, 0, JSON.stringify({ out, ex }));
  // (And the declared differences are as many as they were found to be: so
  // that one in their strips that should not be cannot pass unseen.)
  assert.deepEqual(out.map((o) => o.declared), [7, 0]);
});

test("every piece's air is air by its cell's list, and by carve, wherever the piece may be", () => {
  // (One level finer, a piece may be only in the skin cells of its face.)
  const rnd = rand(6);
  let n = 0;
  const missing = [];
  for (const p of pieces) for (let k = 0; k < 8; k++) {
    const X = p.bb.map(([lo, hi]) => lo + rnd() * (hi - lo));
    if (!(dist(p, X) < -1e-9)) continue;
    const ci = cellOf(X);
    if (p.lv === 1 && (ci < 0 || (word(ci, 0) & 3) !== _V2.BITS.SKIN || !((word(ci, 0) >> 2) & (1 << faceOf(p))))) continue;
    n++;
    if (!(listedAt(p.lv, X) < 0 && carveAt(p.lv, X) < 0) && missing.length < 5) missing.push({ lv: p.lv, src: p.src, X });
  }
  assert.ok(n > 30000, `${n} points`);
  assert.deepEqual(missing, []);
});

test('the rows say what the pieces and lists say', () => {
  // (Read as the shader reads them: from a cell's row, its list's ints, each
  // its piece's rows (its bounds, and its planes' ints), each its plane's row.)
  const D = L.data, row = (i) => D.subarray(4 * i, 4 * i + 4);
  let n = 0, listedCells = 0;
  SAMPLES.forEach(({ X }, s) => {
    if (s & 1) return;
    const ci = cellOf(X), cr = row(ci);
    for (const lv of [0, 1]) {
      const first = cr[2 * lv], count = cr[2 * lv + 1] & 65535;
      assert.equal(count, L._lists[lv][ci].length);
      if (lv === 0) assert.ok((((cr[1] >> 16) & 15) === 0) === count > 0);
      let d = Infinity;
      for (let j = 0; j < count; j++) {
        const pr = D[first + j], h = row(pr), b = row(pr + 1), p = pieces[L._lists[lv][ci][j]];
        assert.equal(pr, L.at.PIECE0 + 2 * L._lists[lv][ci][j]);
        assert.ok(h[1] === p.planes.length && h[2] === p.lv && h[3] === p.src);
        // (Its bounds hold it.)
        for (let a = 0; a < 3; a++) assert.ok((b[a] & 65535) - 32768 <= p.bb[a][0] && ((b[a] >>> 16) & 65535) - 32768 >= p.bb[a][1]);
        let g = -Infinity;
        for (let k = 0; k < h[1]; k++) {
          const q = row(D[h[0] + k]), m = L.dirs[q[0] & 255].m, sg = q[0] & 256 ? -1 : 1, K = q[1] * (lv === 0 ? R : 1);
          // (Its plane: a sign times a direction's m, K at its level, and its fade.)
          assert.ok(m.every((x, a) => sg * x === p.planes[k].a[a]) && K === p.planes[k].b && (q[0] >> 9) === (p.rows[k][0] >> 9));
          g = Math.max(g, (sg * (m[0] * X[0] + m[1] * X[1] + m[2] * X[2]) - K) / Math.hypot(...m));
        }
        d = Math.min(d, g);
        n++;
      }
      assert.equal(d, listedAt(lv, X));
      listedCells += count > 0;
    }
  });
  assert.ok(n > 10000 && listedCells > 1000, `${n} pieces read, ${listedCells} listed cells`);
});

test("the city's relief never overstates what its lists leave out, nor changes faster than the point moves", () => {
  // (Each list's air is in its own cells: in a cell without one, carve is
  // no further than the nearest cell with one. And between points close
  // together, across cells' sides and the table's, it changes no more than
  // they are apart.)
  const rnd = rand(9), listed = [];
  for (let ci = 0; ci < NC; ci++) if (L._lists[0][ci].length) listed.push(corner(ci));
  let far = 0, worst = 0;
  for (let i = 0; i < 6000; i++) {
    const c = corner(Math.floor(rnd() * NC));
    // (A point in the cell; or, one in six, up to a cell past it, and so
    // past the table at its edges.)
    const X = c.map((x) => x + (i % 6 ? rnd() : rnd() * 3 - 1));
    const v = carveAt(0, X.map((x) => x * R)), ci = cellIndex(X.map(Math.floor));
    if (ci < 0 || !L._lists[0][ci].length) {
      let least = Infinity;
      for (const o of listed) least = Math.min(least, Math.hypot(...X.map((x, a) => Math.max(o[a] - x, x - o[a] - 1, 0))));
      assert.ok(v <= least + 1e-9, `at ${X}: ${v}, a list ${least} off`);
      far += v > 1;
    }
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], len = Math.hypot(...dir), step = 10 ** (rnd() * 2 - 2);
    const Y = X.map((x, a) => x + (dir[a] / len) * step), w = carveAt(0, Y.map((x) => x * R));
    worst = Math.max(worst, Math.abs(w - v) / step);
    assert.ok(Math.abs(w - v) <= step * (1 + 1e-6) + 1e-9, `from ${X} (${v}) to ${Y} (${w}): ${step} apart`);
  }
  assert.ok(far > 200 && worst > 0.5, `${far} points more than a cell from a list's air, the steepest ${worst}`);
});

test('the listed relief is built within its time and room', () => {
  // (Not a benchmark: a guard against the builder growing well past its
  // plan, .claude/design/relief-cover.md: about 0.4 s and 2 MB here.)
  assert.ok(L.data.byteLength < 4e6, `${L.data.byteLength} bytes`);
  assert.ok(L.stats.ms < 3000, `${L.stats.ms} ms`);
});
