// The relief as listed pieces (src/spaces/relief.js): the same air as its
// decisions cut before (relief-air.json), but where the listed form is
// declared to differ; lists that hold every piece's air where it is; rows
// that say what the pieces and lists say; and both copies' carve, which
// asks them, never overstating, nor changing faster than the point moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _V2, VOLUME } from '../../src/spaces/arcology.js';
import { writeRows } from '../../src/spaces/relief.js';
import arcology from '../../src/spaces/arcology.js';
import { unionExit, reliefFade, fadeAt } from './fade.js';
import { known } from './known.js';
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
// only in a skin cell. (And for a ray ({ dir }), how far it goes in it; from
// the world's rows, or carve's: see carveOver; faded as fade says.)
function carveAt(lv, X, ray = null, carve = _V2.reliefCarve, fade = undefined) {
  const Xl = lv === 0 ? X.map((x) => x / R) : X;
  const c = Xl.map((x) => Math.floor(x / R)), q = Xl.map((x, a) => x - R * c[a]), W = q.map(Math.round), f = q.map((x, a) => x - W[a]);
  if (lv === 1) { const ci = cellIndex(c); if (ci < 0 || (word(ci, 0) & 3) !== _V2.BITS.SKIN) return Infinity; }
  _V2.setPoint(W, f);
  return carve(lv, W, f, c.map((x) => x * R), ray, fade);
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

// The same air divided otherwise (.claude/design/test-oracles.md, C8): the
// rows written again from the pieces and lists as built say what they said;
// with every list in another order, the relief answers just as it did; and
// with every piece cut in two halves that overlap, a ray through it ends
// where it did, on the same surface, and no point is in more air.
const BUILT = L._built;
// (A ray from X (finer units) along dir through the relief at level lv
// alone, asked again just past each way out, until it is in none: where it
// ends (finer units), the surface there, and how many asks it took. Each
// step stops at its table cell's side, if sooner, to ask the next cell's
// list there: a piece may run on into a cell that does not list it, where
// the world's coarser air takes the ray on, so that a step past the side
// could land where the relief alone has no air, and its pieces otherwise
// divided, not.)
function through(lv, X, dir, carve, fade = null) {
  const unit = lv === 0 ? R : 1;
  let t = 0, n = null;
  for (let k = 0; k < 64; k++) {
    // (Faded, the fade grown by the way come, in the level's units.)
    const g = t / unit, at = fade ? { o: fade.o + fade.a * g, a: fade.a, scale: fade.scale + fade.rate * g, rate: fade.rate } : undefined;
    const Y = X.map((x, a) => x + dir[a] * t), ray = { dir }, d = carveAt(lv, Y, ray, carve, at);
    if (d === Infinity || !(ray.reach >= 0)) return { t, n, k };
    const side = Math.min(...[0, 1, 2].map((a) => (dir[a] === 0 ? Infinity : ((Math.floor(Y[a] / R) + (dir[a] > 0 ? 1 : 0)) * R - Y[a]) / dir[a])));
    if (ray.reach * unit < side) (t += ray.reach * unit), (n = [ray.nx, ray.ny, ray.nz]);
    else (t += side), (n = null);
    t += 1e-9 * Math.max(t, unit);
  }
  return { t, n, k: 64 };
}
// (Rays from points in the pieces' air, as the every-piece test finds them.)
const throughRays = (() => {
  const rnd = rand(31), out = [];
  for (const p of pieces) for (let k = 0; k < 3; k++) {
    const X = p.bb.map(([lo, hi]) => lo + rnd() * (hi - lo));
    if (!(dist(p, X) < -1e-6)) continue;
    const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e);
    out.push({ lv: p.lv, X, dir: e.map((x) => x / m) });
  }
  return out;
})();
// (Compared: each ray's end and surface, by the rows given against the
// world's; ties, where two ways out are equally far, may take either surface.
// only: at that level alone, faded as the march would fade it, each ray at
// one of FADES.)
function sameRays(carve, only = null) {
  const out = { rays: 0, inAir: 0, onSurface: 0, moved: [], turned: 0, capped: 0 };
  for (const [i, { lv, X, dir }] of throughRays.entries()) {
    if (only !== null && lv !== only) continue;
    const fade = only === null ? null : FADES[i % FADES.length];
    const a = through(lv, X, dir, _V2.reliefCarve, fade), b = through(lv, X, dir, carve, fade);
    out.rays++;
    out.inAir += a.t > 0;
    out.capped += a.k === 64 || b.k === 64;
    out.onSurface += a.n !== null;
    if (Math.abs(a.t - b.t) > 1e-6 * (1 + a.t)) { if (out.moved.length < 5) out.moved.push({ lv, X, dir, a, b }); continue; }
    if ((a.n === null) !== (b.n === null) || (a.n && b.n && a.n.some((x, i) => Math.abs(x - b.n[i]) > 1e-12))) out.turned++;
  }
  return out;
}

test('the rows written again from what they were built from are the rows', () => {
  const again = writeRows(BUILT);
  assert.deepEqual(again.size, L.size);
  assert.deepEqual(again.at, L.at);
  assert.ok(again.data.length === L.data.length && again.data.every((x, i) => Object.is(x, L.data[i])));
});

test('with every list in another order, the relief answers as it did', () => {
  const rnd = rand(41);
  const shuffled = BUILT.lists.map((ls) => ls.map((l) => { const c = l.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; }));
  const carve = _V2.carveOver(writeRows({ ...BUILT, lists: shuffled }).data);
  // (Distances, and a ray's reach, exactly; its surface but where two ways
  // out are equally far.)
  let n = 0, ties = 0;
  SAMPLES.forEach(({ lv, X }, i) => {
    if (i % 3) return;
    const e = [Math.sin(i), Math.cos(3 * i), Math.sin(7 * i)], m = Math.hypot(...e), dir = e.map((x) => x / m);
    const ra = { dir }, rb = { dir };
    const a = carveAt(lv, X, ra), b = carveAt(lv, X, rb, carve);
    assert.ok(Object.is(a, b), `level ${lv} at ${X}: ${a}, reordered ${b}`);
    assert.ok(Object.is(ra.reach, rb.reach), `level ${lv} at ${X} along ${dir}: reach ${ra.reach}, reordered ${rb.reach}`);
    if (ra.reach >= 0) n++;
    if (ra.nx !== rb.nx || ra.ny !== rb.ny || ra.nz !== rb.nz) ties++;
  });
  const r = sameRays(carve);
  assert.ok(n > 2000 && r.inAir > 10000 && r.onSurface > 0.6 * r.rays, `${n} sampled rays in air; ${r.inAir} rays through, ${r.onSurface} ending on a surface`);
  assert.deepEqual(r.moved, []);
  assert.ok(ties === 0 && r.turned === 0 && r.capped < 0.001 * r.rays, `${ties} ties of surface, ${r.turned} rays ending on another, ${r.capped} of ${r.rays} not ended in 64 asks`);
});

// Every piece cut across y (else x, else z) at a whole K of its level's
// units, its halves overlapping by a unit: { lists, rows, planeRows } to
// write rows from, and how many were cut. (The halves keep the whole
// piece's bounds, and are listed in its cells. Which piece wins a single
// ask, as the list's order has it, is the reordering's check: here, where a
// ray through the relief ends.)
function split() {
  const planeRows = BUILT.planeRows.slice(), rows = [], to = [];
  // (A plane across axis a, sg X_a <= K, as a row: the axes are the first
  // three directions.)
  const row = (a, sg, K) => planeRows.push([a | ((sg < 0 ? 1 : 0) << 8), K, 0, 0]) - 1;
  let cut = 0;
  BUILT.rows.forEach((r, i) => {
    const unit = r.lv === 0 ? R : 1;
    const a = [1, 0, 2].find((a) => Math.ceil(r.bb[a][0] / unit) + 2 < Math.floor(r.bb[a][1] / unit));
    if (a === undefined) return void to.push([rows.push(r) - 1]);
    const K = Math.floor((r.bb[a][0] + r.bb[a][1]) / 2 / unit);
    cut++;
    to.push([rows.push({ ...r, pl: [...r.pl, row(a, 1, K + 1)] }) - 1, rows.push({ ...r, pl: [...r.pl, row(a, -1, -K)] }) - 1]);
  });
  const lists = BUILT.lists.map((ls) => ls.map((l) => l.flatMap((i) => to[i])));
  return { built: { ...BUILT, lists, rows, planeRows }, cut };
}

test('with every piece cut in two halves that overlap, rays end where they did, on the same surface, and no point is in more air', () => {
  const { built, cut } = split();
  const carve = _V2.carveOver(writeRows(built).data);
  assert.ok(cut > 0.3 * BUILT.rows.length, `only ${cut} of ${BUILT.rows.length} pieces cut`);
  // (Distances: air where there was air, and never further into it.)
  let air = 0;
  SAMPLES.forEach(({ lv, X }, i) => {
    if (i % 3) return;
    const a = carveAt(lv, X), b = carveAt(lv, X, null, carve);
    if (Math.abs(a) > 1e-9) assert.equal(b < 0, a < 0, `level ${lv} at ${X}: ${a}, cut ${b}`);
    assert.ok(b >= a - 1e-9, `level ${lv} at ${X}: more air cut (${b}) than whole (${a})`);
    air += a < 0;
  });
  const r = sameRays(carve);
  assert.ok(air > 2000 && r.inAir > 10000 && r.onSurface > 0.6 * r.rays, `${air} points in air; ${r.inAir} rays through, ${r.onSurface} ending on a surface`);
  assert.deepEqual(r.moved, []);
  assert.ok(r.turned === 0 && r.capped < 0.001 * r.rays, `${r.turned} rays ending on another surface, ${r.capped} of ${r.rays} not ended in 64 asks`);
});

// Faded as the march fades the relief (fade.js): fade states for the
// relief's levels, a little, half way and nearly fully, aslant or face on.
const FADES = [0.01, 0.05, 0.2, 0.5, 0.9].flatMap((rel) => [0.6, 1].flatMap((slant) => [2e-3, 5e-3].map((pix) => fadeAt({ sig: R }, arcology, { rel, slant, pix }))));
// The relief at level lv faded, against the fading oracle (fade.js): from
// points in each listed piece, each at one of FADES, how far a ray goes in
// the faded air of its cell's list as each plane's fade rule says
// (reliefFade), and whether it is in air at all, by the carve and by the
// oracle (by the distance the ray ends off the plane it meets: |Δx| |n . d|);
// and along the way, within the cell (at 31 points), the carve's own faded
// distance says air (at the city's level, less its shrinking: see levelAir
// in shaders.js). (The oracle shares the builder's lists, and each plane's
// fade code and fz, with the carve: it checks how the carve fades what it
// is given, not what it is given.)
function fadedRelief(lv) {
  const rnd = rand(7), unit = lv === 0 ? R : 1, out = { rays: 0, inAir: 0, apart: 0, off: 0, worst: 0, solid: 0, first: null };
  const oracle = (X, dir, fade) => {
    const ci = cellOf(X);
    return ci < 0 ? null : unionExit(L._lists[lv][ci].map((i) => ({ planes: pieces[i].planes.map((q, k) => {
      const m = Math.hypot(...q.a);
      return { s: (q.a[0] * X[0] + q.a[1] * X[1] + q.a[2] * X[2] - q.b) / m / unit, n: q.a.map((x) => x / m), ...reliefFade(lv, (pieces[i].rows[k][0] >> 9) & 3, L.fval(pieces[i].rows[k][2]), { gO: fade.o, gA: fade.a }, { close: arcology.close, R }) };
    }) })), dir);
  };
  pieces.forEach((p, i) => {
    if (p.lv !== lv) return;
    for (let k = 0; k < 2; k++) {
      const X = p.bb.map(([lo, hi]) => lo + rnd() * (hi - lo)), e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e), dir = e.map((x) => x / m);
      const fade = FADES[(2 * i + k) % FADES.length], ray = { dir };
      if (carveAt(lv, X, ray, undefined, fade) === Infinity) continue;
      const ex = oracle(X, dir, fade);
      out.rays++;
      if ((ray.reach >= 0) !== !!ex) { out.apart++; out.first ??= { X, dir, fade, reach: ray.reach, oracle: ex }; continue; }
      if (!ex) continue;
      out.inAir++;
      const nd = Math.abs(ex.n[0] * dir[0] + ex.n[1] * dir[1] + ex.n[2] * dir[2]), err = (Math.abs(ray.reach - ex.x) * nd) / (1 + ex.x);
      out.worst = Math.max(out.worst, err);
      if (err > 1e-9) { out.off++; out.first ??= { X, dir, fade, reach: ray.reach, oracle: ex.x }; }
      const home = cellOf(X);
      for (let j = 1; j < 32; j++) {
        const t = (ray.reach * j) / 32, Y = X.map((q, a) => q + dir[a] * t * unit);
        if (cellOf(Y) !== home) break;
        const o = fade.o + fade.a * t, d = carveAt(lv, Y, null, undefined, { o, a: 0, scale: 0, rate: 0 });
        if ((lv === 0 ? d + o : d) > 1e-9 * (1 + o)) { out.solid++; out.first ??= { X, dir, fade, reach: ray.reach, solidAt: t }; break; }
      }
    }
  });
  return out;
}
const fadedHolds = (lv) => {
  const r = fadedRelief(lv);
  assert.ok(r.rays > 2000 && r.inAir > 200, `level ${lv}: ${r.rays} rays, ${r.inAir} in air: the test reaches what it means to`);
  assert.ok(r.apart === 0 && r.off === 0 && r.solid === 0, `level ${lv}: ${r.apart} rays in air by one and not the other, ${r.off} ending elsewhere (worst ${r.worst}), ${r.solid} going through faded solid, of ${r.inAir}: ${JSON.stringify(r.first)}`);
};
test('one level finer than the city, the relief fades as its planes say', () => fadedHolds(1));
// (The city's pockets are meant to shrink as the rest of the level does,
// growing as the ray goes; the carve keeps the shrinking but drops the
// growth: ledger B43.)
test("at the city's level, the relief fades as its planes say", (t) => known(t, 'B43', () => fadedHolds(0)));

// And faded, the same air divided otherwise ends rays where it did: one
// level finer, where the planes that cut the pieces do not move; and at the
// city's level, where every plane shrinks alike, the cut's too (the pieces'
// planes have no kind to say which are only cuts: relief-cover.md 2.1, 3.6),
// but the halves overlap by a whole unit (the least whole one), and no city
// piece has a point more than half a unit inside it: shrunk by half a unit,
// where the overlap would close, it is gone too.
const fadedSplit = (lv) => {
  const carve = _V2.carveOver(writeRows(split().built).data), r = sameRays(carve, lv);
  assert.ok(r.inAir > (lv ? 1000 : 300) && r.onSurface > 0.5 * r.inAir, `level ${lv}: ${r.inAir} rays through, ${r.onSurface} ending on a surface`);
  assert.deepEqual(r.moved, []);
  assert.ok(r.turned === 0 && r.capped < 0.001 * r.rays, `level ${lv}: ${r.turned} rays ending on another surface, ${r.capped} of ${r.rays} not ended in 64 asks`);
};
test('faded, one level finer, with every piece cut in two, rays end where they did', () => fadedSplit(1));
test("faded, at the city's level, with every piece cut in two, rays end where they did", () => fadedSplit(0));
