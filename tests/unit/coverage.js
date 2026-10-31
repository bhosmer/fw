// What the relief's cover covers, checked exhaustively (plan relief-cover.md
// 6.2): wherever pieces of air meet with air all round, a piece holds the
// point strictly. Written on its own, sharing no code with cover.js.
//
// On each facet of each physical piece (its plane, within its other
// planes), the planes of every piece touching the facet cut it into strata
// (vertices, edges and faces), each represented by a point; a piece holds an
// open stratum wholly or not at all, since each is cut by the piece's planes
// too. A stratum about which a small ball is in the physical pieces' air
// must be held strictly by a piece of the field (cover or physical). Each
// piece counts only where its level's list holds it, in the table cell of
// the point (as carve asks them), and no point inside a solid without
// relief is air. Floats with margins.
//
// The fields: fine (the finer level's own pieces, without those joining the
// levels), city (the city's own), union (both, and the joins). Faded by fr:
// the finer level's backs risen by fr of their fading depth (fz), as carve
// has them at a fade of fr; every other plane stays (the city's own uniform
// shrinking, which takes air from every piece alike, is not asked after).
//
//   node tests/unit/coverage.js [field[,field]] [fr[,fr]] [every] [without]
// prints each field's count at each fr (every: one facet in so many, 1 all).
// (The unit suite asks one facet in several: see cover.test.js.)
import { _V2, VOLUME } from '../../src/spaces/arcology.js';

const R = 24, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], hyp = (v) => Math.hypot(v[0], v[1], v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const COVER_SRC = 0x40000000;
// (Unit directions about a point, golden-angle spaced.)
const sphere = (n, t0) => Array.from({ length: n }, (_, i) => { const z = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - z * z), t = i * 2.39996 + t0; return [r * Math.cos(t), r * Math.sin(t), z]; });
const SPH = sphere(64, 0.1), DENSE = sphere(20000, 0.3);
const most = (ps, X) => { let d = -Infinity; for (const p of ps) { const v = dot(p.a, X) - p.b; if (v > d) d = v; } return d; };

let built = null;
// The pieces as listed (physical and cover, each from its row, its planes
// in finer units), the lists as sets, and the solids without relief.
function pieces() {
  if (built) return built;
  const L = _V2.listed(), B = L._built, f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
  const all = B.rows.map((row, id) => {
    const planes = row.pl.map((pi) => {
      const q = B.planeRows[pi], sg = q[0] & 256 ? -1 : 1, m = L.dirs[q[0] & 255].m;
      return { n: m.map((x) => sg * x), K: q[1] * (row.lv === 0 ? R : 1), back: q[0] >> 9 === 1 && row.lv === 1, fz: ((i32[0] = q[2]), f32[0]) };
    });
    return { id, lv: row.lv, planes, cover: row.src >= COVER_SRC, cross: !!row.cross, bb: row.bb.map(([a, b]) => [a - 1e-6, b + 1e-6]) };
  });
  const lists = L._lists.map((ls) => ls.map((l) => new Set(l)));
  const bare = _V2.BARE_BOX.map(([lo, hi]) => [lo.map((x) => x * R), hi.map((x) => x * R)]);
  return (built = { all, lists, bare });
}

// The check of one field at fade fr, every: one facet in so many; without
// (for the check's own check) 'cover' or 'joins', those pieces left out.
// What is held by no piece though air all round, as counts of strata by
// dimension (and a few of them); and how much was asked.
export function coverage(field, fr = 0, every = 1, without = null) {
  const { all, lists, bare } = pieces();
  const inBare = (Y) => bare.some(([lo, hi]) => Y.every((x, a) => x > lo[a] && x < hi[a]));
  const vlo = VOLUME.lo.map((x, a) => x - _V2.ORIGIN[a]);
  const cellOf = (X) => { const v = X.map((x, a) => Math.floor(x / R) - vlo[a]); return VOLUME.within(v) ? VOLUME.at(v) : -1; };
  const listedAt = (x, ci) => ci >= 0 && lists[x.p.lv][ci].has(x.p.id);
  const lvs = { fine: [1], city: [0], union: [0, 1] }[field];
  const unit = (p) => ({ p, ps: p.planes.map((q) => { const l = hyp(q.n); return { a: q.n.map((x) => x / l), b: q.K / l - (q.back ? fr * q.fz : 0) }; }), bb: p.bb });
  const phys = all.filter((p) => !p.cover && lvs.includes(p.lv)).map(unit);
  const cov = [...phys, ...all.filter((p) => p.cover && lvs.includes(p.lv) && (field === 'union' || !p.cross) && !(without === 'cover' || (without === 'joins' && p.cross))).map(unit)];
  // (A hash of 8-unit cells, for the pieces near a facet.)
  const H = 8, hash = new Map();
  const cellsOf = (bb, f) => { const lo = bb.map(([a]) => Math.floor(a / H)), hi = bb.map(([, b]) => Math.floor(b / H)); for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) f(`${i},${j},${k}`); };
  for (const [kind, xs] of [['phys', phys], ['cov', cov]]) for (const x of xs) cellsOf(x.bb, (k) => (hash.get(k) ?? hash.set(k, { phys: [], cov: [] }).get(k))[kind].push(x));
  const near = (bb) => { const P = new Set(), C = new Set(); cellsOf(bb, (k) => { const e = hash.get(k); if (e) e.phys.forEach((x) => P.add(x)), e.cov.forEach((x) => C.add(x)); }); return { P: [...P], C: [...C] }; };
  const overlap = (a, b) => a.every(([x0, x1], i) => x1 >= b[i][0] && x0 <= b[i][1]);
  const out = { field, fr, facets: 0, met: 0, strata: [0, 0, 0], held: [0, 0, 0], wedges: 0, uncovered: [0, 0, 0], ex: [] };
  let nf = 0;
  for (const P of phys)
    for (let fi = 0; fi < P.ps.length; fi++) {
      if (nf++ % every) continue;
      out.facets++;
      // (The facet's plane: o on it, e1 and e2 along it; a plane's trace on it
      // a u + b v <= c, or, parallel, whether it holds the plane or lies on it.)
      const pl = P.ps[fi], n = pl.a, o = n.map((x) => x * pl.b), c0 = cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]), e1 = c0.map((x) => x / hyp(c0)), e2 = cross(n, e1);
      const to3 = (u, v) => [o[0] + u * e1[0] + v * e2[0], o[1] + u * e1[1] + v * e2[1], o[2] + u * e1[2] + v * e2[2]];
      const trace = (q) => { const a = dot(q.a, e1), b = dot(q.a, e2), c = q.b - dot(q.a, o), l = Math.hypot(a, b); return l < 1e-9 ? { par: true, inside: c >= -1e-9, on: Math.abs(c) <= 1e-9 } : { a: a / l, b: b / l, c: c / l }; };
      const polygon = (hs) => { const vs = []; for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const d = hs[i].a * hs[j].b - hs[i].b * hs[j].a; if (Math.abs(d) < 1e-12) continue; const u = (hs[i].c * hs[j].b - hs[i].b * hs[j].c) / d, v = (hs[i].a * hs[j].c - hs[i].c * hs[j].a) / d; if (hs.every((h) => h.a * u + h.b * v <= h.c + 1e-7)) vs.push([u, v]); } return vs; };
      const F = [];
      let none = false;
      for (let j = 0; j < P.ps.length && !none; j++) { if (j === fi) continue; const t = trace(P.ps[j]); if (!t.par) F.push(t); else if (!t.inside || t.on) none = true; }
      if (none) continue;
      const Fv = polygon(F);
      if (Fv.length < 3) continue;
      const fbb = [0, 1, 2].map((a) => { const xs = Fv.map(([u, v]) => to3(u, v)[a]); return [Math.min(...xs) - 1e-6, Math.max(...xs) + 1e-6]; });
      const { P: Pn, C: Cn } = near(fbb);
      // (A piece touching the facet: its traces with the facet's leave some of it.)
      const touch = (x) => {
        if (!overlap(x.bb, fbb)) return null;
        const hs = [...F];
        let on = false;
        for (const q of x.ps) { const t = trace(q); if (t.par) { if (!t.inside) return null; on ||= t.on; } else hs.push(t); }
        return polygon(hs).length ? { hs: hs.slice(F.length), on } : null;
      };
      const others = Pn.filter((x) => x !== P).map((x) => ({ x, t: touch(x) })).filter((y) => y.t);
      if (!others.length) continue;
      out.met++;
      const covers = Cn.map((x) => ({ x, t: touch(x) })).filter((y) => y.t);
      // (The lines cutting the facet: its own sides, and each touching piece's.)
      const lines = [];
      for (const h of [...F, ...[...others, ...covers].flatMap((y) => y.t.hs)]) if (!lines.some((g) => Math.abs(g.a - h.a) < 1e-9 && Math.abs(g.b - h.b) < 1e-9 && Math.abs(g.c - h.c) < 1e-7)) lines.push(h);
      const inF = (u, v, e = 1e-7) => F.every((h) => h.a * u + h.b * v <= h.c + e);
      // (On each line in the facet, where the others cross it (vertices); between
      // them, the middle (an edge), and a little off it either way (faces).)
      const reps = [], seen = new Set();
      for (const g of lines) {
        const p0 = [g.a * g.c, g.b * g.c], dir = [-g.b, g.a], ts = [];
        for (const h of lines) {
          const den = h.a * dir[0] + h.b * dir[1];
          if (h === g || Math.abs(den) < 1e-12) continue;
          const t = (h.c - h.a * p0[0] - h.b * p0[1]) / den;
          if (inF(p0[0] + t * dir[0], p0[1] + t * dir[1])) ts.push(t);
        }
        ts.sort((x, y) => x - y);
        const at = ts.filter((x, k) => k === 0 || x - ts[k - 1] > 1e-7);
        for (const t of at) { const u = p0[0] + t * dir[0], v = p0[1] + t * dir[1], k = `${u.toFixed(6)},${v.toFixed(6)}`; if (!seen.has(k)) seen.add(k), reps.push({ dim: 0, u, v }); }
        for (let k = 0; k + 1 < at.length; k++) {
          const t = (at[k] + at[k + 1]) / 2, u = p0[0] + t * dir[0], v = p0[1] + t * dir[1];
          if (!inF(u, v)) continue;
          reps.push({ dim: 1, u, v });
          const off = Math.min(1e-4, (at[k + 1] - at[k]) / 4);
          for (const s of [-1, 1]) if (inF(u + s * off * g.a, v + s * off * g.b, -1e-9)) reps.push({ dim: 2, u: u + s * off * g.a, v: v + s * off * g.b });
        }
      }
      const around = [P, ...others.map((y) => y.x)];
      for (const s of reps) {
        out.strata[s.dim]++;
        const X = to3(s.u, s.v), ci = cellOf(X), here = around.filter((x) => listedAt(x, ci));
        if (covers.some((y) => !y.t.on && listedAt(y.x, ci) && most(y.x.ps, X) < -1e-7)) { out.held[s.dim]++; continue; }
        // (Air all round: a small ball about it in the pieces listed there,
        // sampled, then densely, as a thin solid wedge can slip between few.)
        const air = (dirs) => dirs.every((e) => { const Y = X.map((x, a) => x + 2e-6 * e[a]); return !inBare(Y) && here.some((x) => most(x.ps, Y) < 0); });
        if (!air(SPH)) continue;
        if (!air(DENSE)) { out.wedges++; continue; }
        out.uncovered[s.dim]++;
        if (out.ex.length < 4) out.ex.push({ dim: s.dim, X: X.map((x) => +x.toFixed(4)), piece: P.p.id, others: others.map((y) => y.x.p.id) });
      }
    }
  return out;
}

if (import.meta.main) {
  const [fields = 'city,fine,union', frs = '0,0.5,1', every = '1', without = null] = process.argv.slice(2);
  for (const field of fields.split(','))
    for (const fr of frs.split(',').map(Number)) {
      const t0 = performance.now(), o = coverage(field, fr, +every, without);
      console.log(JSON.stringify({ ...o, ms: Math.round(performance.now() - t0) }));
    }
}
