// The relief as listed pieces (src/spaces/relief.js) against the relief's
// own decisions as carve asks them today: the same air, but where the listed
// form is declared to differ; lists that hold every piece's air where it is;
// and rows that say what the pieces and lists say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _V2, VOLUME } from '../../src/spaces/arcology.js';
import { readFileSync } from 'node:fs';
import { rand } from './rand.js';
import { reliefSamples } from './relief-samples.js';

const { ORIGIN: O, FACES } = _V2, R = 24, BAND_OUT = 1.01;
const L = _V2.listed(), pieces = L._pieces;
const vlo = VOLUME.lo.map((x, a) => x - O[a]), vsz = VOLUME.size;
const cellIndex = (c) => { const v = c.map((x, a) => x - vlo[a]); return VOLUME.within(v) ? VOLUME.at(v) : -1; };
const word = (ci, w) => VOLUME.data[VOLUME.words * ci + w];
const faceOf = (p) => (p.src >>> 24) >> 2;
// (A piece's distance at X, finer units from the origin: the most of its planes'.)
const dist = (p, X) => { let d = -Infinity; for (const q of p.planes) d = Math.max(d, (q.a[0] * X[0] + q.a[1] * X[1] + q.a[2] * X[2] - q.b) / Math.hypot(...q.a)); return d; };
// (The table's cell of X, finer units, at either level: the city's level's
// table cells are its lattice's units, R finer units.)
const cellOf = (X) => cellIndex(X.map((x) => Math.floor(x / R)));
// The listed relief at X (finer units) at level lv: the least over its cell's list.
const listedAt = (lv, X) => { const ci = cellOf(X); let d = Infinity; if (ci >= 0) for (const i of L._lists[lv][ci]) d = Math.min(d, dist(pieces[i], X)); return d; };
// Today's relief at X (finer units) at level lv, as the city's cell or the
// table's cell asks it.
function todayAt(lv, X) {
  const Xl = lv === 0 ? X.map((x) => x / R) : X;
  const c = Xl.map((x) => Math.floor(x / R)), q = Xl.map((x, a) => x - R * c[a]), W = q.map(Math.round), f = q.map((x, a) => x - W[a]);
  _V2.setPoint(W, f);
  const base = c.map((x) => x * R);
  if (lv === 0) return _V2.reliefCarve(0, W, f, base, _V2.reliefFaces(W, f, base.map((x, a) => x + O[a])));
  const ci = cellIndex(c);
  if (ci < 0 || (word(ci, 0) & 3) !== _V2.BITS.SKIN) return Infinity;
  Object.assign(_V2.CELL, { b: c, open: (word(ci, 0) >> _V2.BITS.OPEN_AT) & 63, cross: ((word(ci, 1) >> _V2.BITS.CROSS_AT) & 1) === 1, axis: -1 });
  return _V2.reliefCarve(1, W, f, base, (word(ci, 0) >> 2) & 63);
}
// Where the listed relief is declared to differ (plan 2.2):
// - at the city's level, past BAND_OUT in front of a face but short of its
//   pockets' out-plane (a unit past the face, in its own whole numbers),
//   where cityFaces let no pocket through;
// - one level finer, within a unit of n_h . X of a terrace's wall, now on
//   the lattice of n_h (a plane across, a = n_h / c, fading as a back).
function declared(lv, X) {
  if (lv === 0) return FACES.some((F) => { const s = (F.n[0] * X[0] + F.n[1] * X[1] + F.n[2] * X[2]) / R - F.K; return s / F.nl > BAND_OUT && s <= Math.ceil(F.nl) + 1e-9; });
  const ci = cellOf(X);
  return ci >= 0 && L._lists[1][ci].some((i) => pieces[i].planes.some((q, j) => q.a[1] === 0 && (pieces[i].rows[j][0] >> 9) === 1 && Math.abs(q.a[0] * X[0] + q.a[2] * X[2] - q.b) <= 1));
}
const SAMPLES = reliefSamples(VOLUME, O, _V2.BITS.SKIN, R);
// (Today's air at them, as relief-air.json has it: 0 on a surface, 1 air, 2 solid.)
const AIR = JSON.parse(readFileSync(new URL('./relief-air.json', import.meta.url), 'utf8'));
const airBits = Buffer.from(AIR.bits, 'base64'), airAt = (i) => (airBits[i >> 2] >> (2 * (i & 3))) & 3;

test("relief-air.json is today's air at the samples", () => {
  assert.equal(AIR.n, SAMPLES.length);
  const wrong = [];
  SAMPLES.forEach(({ lv, X }, i) => {
    const a = todayAt(lv, X), k = Math.abs(a) < 1e-9 ? 0 : a < 0 ? 1 : 2;
    if (k !== airAt(i) && wrong.length < 5) wrong.push({ i, lv, X, a });
  });
  assert.deepEqual(wrong, []);
});

test('the listed relief is the air its decisions cut, but where it is declared to differ', () => {
  const out = [0, 1].map(() => ({ pts: 0, air: 0, declared: 0, differ: 0 })), ex = [];
  const at = (lv, X, today) => {
    const b = listedAt(lv, X);
    if (today === 0 || Math.abs(b) < 1e-9) return;
    const o = out[lv];
    o.pts++;
    if (today === 1) o.air++;
    if ((today === 1) === b < 0) return;
    if (declared(lv, X)) return void o.declared++;
    o.differ++;
    if (ex.length < 5) ex.push({ lv, X, today, b });
  };
  // (At the samples, against today's air; and in every piece, against today's as carve asks it.)
  SAMPLES.forEach(({ lv, X }, i) => at(lv, X, airAt(i)));
  const rnd = rand(8);
  for (const p of pieces) for (let i = 0; i < 4; i++) {
    const X = p.bb.map(([lo, hi]) => lo + rnd() * (hi - lo));
    if (!(dist(p, X) < 0)) continue;
    const a = todayAt(p.lv, X);
    at(p.lv, X, Math.abs(a) < 1e-9 ? 0 : a < 0 ? 1 : 2);
  }
  for (const o of out) assert.ok(o.pts > 30000 && o.air > 5000, JSON.stringify(out));
  assert.equal(out[0].differ + out[1].differ, 0, JSON.stringify({ out, ex }));
});

test("every piece's air is air by its cell's list, wherever the piece may be", () => {
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
    if (!(listedAt(p.lv, X) < 0) && missing.length < 5) missing.push({ lv: p.lv, src: p.src, X });
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
      const first = cr[2 * lv], count = cr[2 * lv + 1] & 65535, near = cr[2 * lv + 1] >> 16;
      assert.equal(count, L._lists[lv][ci].length);
      assert.ok(near <= 15 && (count > 0) === (near === 0));
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

test('what a list leaves out is no nearer than its row says', () => {
  // (Every other list's air is in its own cell: no nearer than the cell's
  // sides and n - 1 cells more, n the cells to the nearest list.)
  const rnd = rand(9), D = L.data, NC = vsz[0] * vsz[1] * vsz[2];
  const listedCells = [0, 1].map((lv) => { const c = []; for (let ci = 0; ci < NC; ci++) if (L._lists[lv][ci].length) c.push(ci); return c; });
  const corner = (ci) => [ci % vsz[0] + vlo[0], (Math.floor(ci / vsz[0]) % vsz[1]) + vlo[1], Math.floor(ci / vsz[0] / vsz[1]) + vlo[2]];
  let tight = 0;
  for (const lv of [0, 1]) for (let i = 0; i < 4000; i++) {
    const ci = Math.floor(rnd() * NC), c = corner(ci), X = c.map((x) => x + rnd());
    const near = D[4 * ci + 2 * lv + 1] >> 16;
    const e = Math.min(...X.map((x, a) => Math.min(x - c[a], c[a] + 1 - x))) + Math.max(near - 1, 0);
    let least = Infinity;
    for (const cj of listedCells[lv]) {
      if (cj === ci) continue;
      const o = corner(cj), q = X.map((x, a) => Math.max(o[a] - x, x - o[a] - 1, 0));
      least = Math.min(least, Math.hypot(...q));
    }
    assert.ok(least >= e - 1e-12, `level ${lv}, cell ${ci}: a list ${least} cells off, ${e} said`);
    tight += least < e + 1;
  }
  assert.ok(tight > 1000, `${tight} within a cell of the bound`);
});

test('the listed relief is built within its time and room', () => {
  // (Not a benchmark: a guard against the builder growing well past its
  // plan, .claude/design/relief-cover.md: about 0.4 s and 2 MB here.)
  assert.ok(L.data.byteLength < 4e6, `${L.data.byteLength} bytes`);
  assert.ok(L.stats.ms < 3000, `${L.stats.ms} ms`);
});
