// "Arcology": the halls, built up into a great building above the ground.
//
// Every level is halls (see halls.js) but one, the city's: there, one row of
// cells, running on in every direction to the horizon, is a plaza open to
// the sky, and in the middle of it stands a building. It is solid at the
// city's level, so the halls one level finer are its rooms (each of which is
// a great hall of the halls one level finer still). Under the plaza are more
// halls, whose light wells open up through its floor. Above the city's row
// there is only sky, and the levels coarser than the city's are solid
// throughout (as air, they would swallow parts of it).
//
// A building is a list of convex solids, each bounded by planes of any
// orientation (see hexahedron.js, the one building so far). A plane is
// n . X < K with n and K whole numbers, X in the city's lattice units (level
// CITY + 1 cells): through rational points, and kept exact at any depth by
// carrying each normal across levels (the space's slants: see
// Position.levels), as the halls' 45-degree planes are.
//
// One level finer, the cells near a mass's sloped faces are its skin: no
// rooms in them, but pockets cut into the face (see pocket), boxes of many
// sizes and depths in the face's own frame, so that a face reads as built
// up of masses small and large, as in the photograph of Soleri's model.
// Deeper in, the cells are halls; cells the other solids cross are solid.

import halls, { hallsGlsl, hallsAir, hallsRoom, hallsOpenings, built, R, M } from './halls.js';
import { hashCell, levelSeed, wrapId as wrapIdR } from '../util.js';
import { hexahedron, GROUND } from './hexahedron.js';

const wrapId = (id) => wrapIdR(id, R);
const C = R / 2;
export const CITY = -2; // the city's level
const ROW = 12; // which row of its parent the city's cells are in
const G = M; // the plaza's floor, up from the bottom of a city cell
export const ROWS = 2; // how many rows of cells high the city is, from its floor to the sky
// Ids are a cell's index in its parent plus R times its parent's in the
// grandparent: the city's row, and the cell in the middle of it, as ids.
export const ROW_ID = ROW + R * C;
const MID = C + R * C;
const ABOVE = 200; // how many rows over the city's are known to be over it

// The building, its solids' planes moved to the city's lattice: from the
// middle city cell's corner, its axis at the middle of that cell, the
// lower's apex a cell under the plaza's floor (see GROUND).
const SOLIDS = hexahedron();
const ORIGIN = [C, G - 1, C];

// Each plane's direction: an axis (0, 1, 2) where its normal is one, or else
// a slant (3 on): the normal itself, in whole numbers, so that the plane
// lies on a whole value of what is carried (a divisor of it, the primitive
// direction, could leave the plane between two whole values, where the small
// parts cancel). Scale: 1 or -1.
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export const SLANTS = [];
function slantOf(n) {
  const sign = Math.sign(n.find((x) => x !== 0));
  const m = n.map((x) => x * sign);
  let k = SLANTS.findIndex((t) => t.every((x, a) => x === m[a]));
  if (k < 0) k = SLANTS.push(m) - 1;
  return { k, sign };
}
const PLANES = []; // { dir, scale, m, n, K, len }
SOLIDS.forEach((s) => {
  s.first = PLANES.length;
  for (const { n, K } of s.planes) {
    const nz = n.filter((x) => x !== 0);
    let dir, scale, m;
    if (nz.length === 1 && Math.abs(nz[0]) === 1) (dir = n.findIndex((x) => x !== 0)), (scale = nz[0]), (m = n.map(Math.abs));
    else {
      const { k, sign } = slantOf(n);
      (dir = k + 3), (scale = sign), (m = SLANTS[k]);
    }
    // (In the lattice: n . X < K, X from the middle city cell's corner.)
    PLANES.push({ dir, scale, m, n, K: K + n[0] * ORIGIN[0] + n[1] * ORIGIN[1] + n[2] * ORIGIN[2], len: Math.hypot(...n) });
  }
  s.last = PLANES.length;
});

// Whether a level-(CITY + 1) cell, its corner c (lattice units from the
// middle cell's corner), is wholly inside a solid (all its corners are),
// and whether it is wholly outside it (all outside one of its planes).
const corners = (c) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [c[0] + (i & 1), c[1] + ((i >> 1) & 1), c[2] + ((i >> 2) & 1)]);
const side = (p, q) => p.n[0] * q[0] + p.n[1] * q[1] + p.n[2] * q[2] - p.K;
const planesOf = (s) => PLANES.slice(s.first, s.last);
const cellIn = (s, c) => corners(c).every((q) => planesOf(s).every((p) => side(p, q) <= 0));
const cellOut = (s, c) => planesOf(s).some((p) => corners(c).every((q) => side(p, q) >= 0));

// Each solid's bounds in the lattice (the cells it may touch).
for (const s of SOLIDS) {
  s.lo = [Infinity, Infinity, Infinity];
  s.hi = [-Infinity, -Infinity, -Infinity];
  for (let x = ORIGIN[0] - 40; x < ORIGIN[0] + 40; x++)
    for (let y = ORIGIN[1] - 2; y < ORIGIN[1] + 40; y++)
      for (let z = ORIGIN[2] - 40; z < ORIGIN[2] + 40; z++) {
        const c = [x, y, z];
        if (cellOut(s, c)) continue;
        for (let a = 0; a < 3; a++) (s.lo[a] = Math.min(s.lo[a], c[a])), (s.hi[a] = Math.max(s.hi[a], c[a] + 1));
      }
}
const TOP = Math.max(...SOLIDS.map((s) => s.hi[1]));

// The city cells, across from the middle one, that the building stands in:
// no light well opens in those (it would come up into it).
const BUILT = new Set();
for (const { lo, hi } of SOLIDS)
  for (let a = Math.floor(lo[0] / R); a <= Math.floor((hi[0] - 1) / R); a++)
    for (let b = Math.floor(lo[2] / R); b <= Math.floor((hi[2] - 1) / R); b++) BUILT.add(`${a},${b}`);
const BUILT_CELLS = [...BUILT].map((k) => k.split(',').map(Number));

// For each city cell (across from the middle one) with any solid near it,
// the solids that reach into the air it answers for (its plaza piece, see
// plaza): only those are asked about.
const NEAR = new Map();
SOLIDS.forEach(({ lo: [x0, y0, z0], hi: [x1, y1, z1] }, k) => {
  for (let a = Math.floor((x0 - 2 * R) / R); a <= Math.floor((x1 + R) / R); a++)
    for (let b = Math.floor((y0 - R - M) / R); b <= Math.floor((y1 + M) / R); b++)
      for (let c = Math.floor((z0 - 2 * R) / R); c <= Math.floor((z1 + R) / R); c++) {
        if (b < 0 || b >= ROWS) continue;
        const lo = [a * R - R, b * R + (b === 0 ? G : -M), c * R - R], hi = [a * R + 2 * R, b * R + R + M, c * R + 2 * R];
        if (x1 <= lo[0] || x0 >= hi[0] || y1 <= lo[1] || y0 >= hi[1] || z1 <= lo[2] || z0 >= hi[2]) continue;
        const key = `${a},${b},${c}`;
        if (!NEAR.has(key)) NEAR.set(key, []);
        NEAR.get(key).push(k);
      }
});
const NEAR_CELLS = [...NEAR.keys()].map((k) => k.split(',').map(Number));
const NEAR_START = [0];
for (const k of NEAR.keys()) NEAR_START.push(NEAR_START.at(-1) + NEAR.get(k).length);
const NEAR_BLOCKS = [...NEAR.values()].flat();

// Pockets: a face is cut, along it and up it, into rectangles: super-blocks
// sb long in rows sby high (rows by the height of the point's projection onto
// the face), each row shifted along by its own whole number of quanta (so
// that no line runs on up the face), each split `splits` times at whole
// quanta (along it, quanta of its own measure). Each rectangle is cut into
// the face to its own depth (depths, as often as weights), along its draft. The
// same rule at two levels: the city's own (lengths in its lattice units,
// cells), whose boxes make the masses and the ragged silhouettes; and the
// next (in its units), smaller boxes cut into those. What keeps anything
// from being cut loose is in the setup after BARE.
const LEVELS = [
  { sb: 4, sby: 2, quant: 1, splits: 3, min: 1, depths: [0, 0.25, 0.5, 1], weights: [0.25, 0.35, 0.25, 0.15] },
  { sb: 24, sby: 24, quant: 2, splits: 3, min: 3, depths: [0, 2, 4, 6, 8], weights: [0.3, 0.25, 0.2, 0.15, 0.1] },
];
for (const lv of LEVELS) lv.cumulative = lv.weights.map((_, i) => lv.weights.slice(0, i + 1).reduce((x, y) => x + y));
const ND = Math.max(...LEVELS.map((lv) => lv.depths.length));
const POCKET_SALT = 0x27d4eb2d, ROW_SALT = 0x165667b1, DEPTH_SALT = 0xd3a2646c;

// The faces that carry pockets: a mass's sloped faces. Each in its own
// frame: across it, h (the plane's normal laid flat, in whole numbers, out
// of the mass), along it, t (flat, along its edge), and up. Its plane is
// n . X < K (X in the city's lattice units from the building's origin; one
// level finer, R times both), with n = alpha h + (0, ny, 0); its pockets keep
// within heights lo to hi (4 y, so that the rims' quarter cells are whole).
// One rule, whatever way it faces.
const FOUR = slantOf([0, 4, 0]);
const FACES = [];
SOLIDS.forEach((s) => {
  for (const i of s.relief ?? []) {
    const { n, K } = s.planes[i];
    // (h and t are scaled by sub, so that a face's measure is fine enough
    // for a quarter cell's depth whichever way it faces: w = h . X is sub
    // times the distance in the plain direction's units.)
    const alpha = gcd(n[0], n[2]), h0 = [n[0] / alpha, 0, n[2] / alpha], sub = Math.max(1, Math.ceil(4 / Math.hypot(...h0)));
    const h = h0.map((x) => x * sub), t = [-h[2], 0, h[0]];
    const len = Math.hypot(...h);
    FACES.push({ n, K, alpha, sub, ny: n[1], plane: slantOf(n), h: slantOf(h), t: slantOf(t), hv: h, tv: t, len, len2: dot2(h),
                 q: LEVELS.map((lv) => Math.round(lv.quant * len)),
                 lo4: Math.round(s.ylo * 4), hi4: Math.round(s.yhi * 4), solid: s });
  }
});
function dot2(v) {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}
// (A cell's table entry has a bit for each, six in all.)
if (FACES.length > 6) throw new Error(`arcology: ${FACES.length} faces with relief, at most 6`);
// How far behind a face anything is cut (cells): DMAX, along its normal (see below).
const REACH = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R + 0.05;
// The city's pockets keep clear of the solids that are neither masses nor
// their rims (pillars, towers): those solids' bounds, from the building's origin.
const BARE = SOLIDS.filter((s) => !s.relief && !s.rim).map((s) => [s.lo.map((x, a) => x - ORIGIN[a]), s.hi.map((x, a) => x - ORIGIN[a])]);
// Relief v2 (.claude/design/relief-v2.md): pockets that follow the face's
// slope, and nothing ever cut loose. A pocket is a box over a rectangle of
// its face, along it (u) and up it by the height of the point's projection
// along its draft onto the face (yp), cut to its depth along the draft (see
// below): its walls hold the draft. The finer level's are cut into the city's (their
// depths add), tiled afresh in each city rectangle. Along each ridge, the
// two faces share notches, in rows by true height. And so that nothing is
// cut loose: a face's own pockets keep Z clear of its mass's other faces all
// the way down (Z = DMAX, as the draft keeps a column as far from them as
// its mouth), and nothing is cut near an apex (HCAP). Then from any
// point left, a way runs into the core (DMAX in from every face, never cut)
// through nothing cut: see the design note.
const DMAX = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R;
// How far in from a face, and out past it, anything of the city's is cut (cells).
const BAND_IN = LEVELS[0].depths.at(-1) + 0.01, BAND_OUT = 1.01;
// (A notch row's depth goes by cum, its share of each of the level's depths;
// its arm reaches the level's deepest, as far as it may toward the pockets,
// in a share long of rows, and otherwise anywhere from its depth to there.
// The city's rows are seldom empty and mostly long, so that the ridges are
// cut along most of their length and the cuts reach across to the pockets;
// one level finer they are as the pockets', since long, deep notches in its
// thin rows leave thin plates between them.)
const NOTCH = [
  { sb: 4, quant: 1, splits: 2, min: 1, arm: 0.25, cum: [0.1, 0.4, 0.7, 1], long: 0.7 },
  { sb: 24, quant: 2, splits: 2, min: 3, arm: 2, cum: LEVELS[1].cumulative, long: 0 },
];
for (const N of NOTCH) N.armLong = Math.floor(N.long * 16777216);
const NOTCH_SALT = 0x2f6b9a1d, TILE_SALT = 0x6c8e9cf5;
const solve3 = (M, b) => {
  const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det(M);
  return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((x, j) => (j === c ? b[i] : x)))) / D);
};
for (const F of FACES) {
  F.nn = dot2(F.n);
  F.nl = Math.sqrt(F.nn);
  const raw = [-F.ny * F.n[0], F.nn - F.ny * F.ny, -F.ny * F.n[2]], gs = raw.reduce(gcd);
  F.sv = raw.map((x) => x / gs);
  F.slen = Math.hypot(...F.sv);
  F.q2 = [F.q[0], (F.q[0] * LEVELS[1].quant) / LEVELS[0].quant];
}
FACES.forEach((F, k) => (F.index = k));
// Pockets are cut into a face along its draft, v = -n^ + kappa d^ (d^ along
// the face toward its mass's base), with kappa just enough that along v no
// other face of the mass comes nearer: then a pocket's whole column is as far
// from them as its mouth, and pockets need only keep DMAX clear of them, not
// DMAX (1 + c) (.claude/design/relief-edges.md). Their walls hold t and v; a
// point's height on the face (yp) is where v carries it to the face, counted
// across the planes m . X = p yp + q n . X, m = p e_y + q n, m . v = 0.
const DRAFT_MARGIN = 0.01;
for (const F of FACES) {
  const mass = FACES.filter((G) => G.solid === F.solid);
  F.near = mass.filter((G) => G !== F);
  const nh = F.n.map((x) => x / F.nl), sy = F.sv[1] / F.slen;
  let draft = null;
  for (const sg of [1, -1]) {
    // (G's depth changes along v at a - kappa b: at least 0 for kappa
    // between the most of a / b over b < 0 and the least over b > 0.)
    let k = 0, kHi = Infinity, ok = true;
    for (const G of F.near) {
      const a = dot(G.n, nh) / G.nl, b = (sg * dot(G.n, F.sv)) / F.slen / G.nl;
      if (b < 0) k = Math.max(k, a / b);
      else if (b > 0) kHi = Math.min(kHi, a / b);
      else if (a < 0) ok = false;
    }
    if (ok && k + 0.05 < kHi && (!draft || k < draft.k)) draft = { sg, k };
  }
  if (!draft) throw new Error(`arcology: face ${F.index} has no draft`);
  // (p the least multiple of nn that brings kappa within 0.03 of the least.)
  let P, q, kOf;
  for (let j = 1; ; j++) {
    P = j * F.nn;
    kOf = (q) => ((q / P + F.ny / F.nn) * F.nn) / (draft.sg * sy * F.nl);
    q = Math.round((-F.ny / F.nn + ((draft.k + DRAFT_MARGIN) * draft.sg * sy * F.nl) / F.nn) * P);
    while (kOf(q) < draft.k + DRAFT_MARGIN / 2) q += kOf(q + 1) > kOf(q) ? 1 : -1;
    if (kOf(q) < draft.k + 0.03 || j >= 16) break;
  }
  const m = [q * F.n[0], P + q * F.n[1], q * F.n[2]], gm = m.reduce(gcd);
  F.kappa = kOf(q);
  F.mv = m.map((x) => x / gm);
  F.gm = gm;
  F.ms = slantOf(F.mv);
  F.mlen = Math.hypot(...F.mv);
  F.p = P;
  F.yk = -q;
  // (Its rows in whole numbers: gm (m . X) and yp p, X over the building at
  // one level finer, well within 32 bits.)
  if ((F.gm * F.mv.reduce((t, x) => t + Math.abs(x), 0) + F.p) * 64 * R + Math.abs(F.yk * F.K) * R >= 2 ** 30) throw new Error('arcology: drafted rows overflow');
  const v = nh.map((x, a) => -x + (F.kappa * draft.sg * F.sv[a]) / F.slen);
  // The point on the face at (u, yp) (city measure, cells), and DELTA cells in along the draft.
  const M = [F.n, F.tv, [0, 1, 0]];
  F.at = (u, y, delta) => solve3(M, [F.K, u, y]).map((x, a) => x + delta * v[a]);
}
for (const F of FACES) {
  const mass = FACES.filter((G) => G.solid === F.solid);
  // Each other face's depth (cells) at (u, yp) on the face, as c0 + cu u + cy yp.
  F.aff = F.near.map((G) => {
    const d = (u, y) => (G.K - dot(G.n, F.at(u, y, 0))) / G.nl;
    const c0 = d(0, 0);
    return { c0, cu: d(1, 0) - c0, cy: d(0, 1) - c0 };
  });
  // (Along the draft no other face comes nearer, so Z is DMAX: see above.)
  F.Z = DMAX + 1e-3;
  const apex = solve3(mass.map((G) => G.n), mass.map((G) => G.K));
  const ny = Math.min(...mass.map((G) => Math.abs(G.ny) / G.nl));
  const hcap = F.Z / ny + 0.25;
  // Where anything may be cut, in height (cells).
  [F.cutLo, F.cutHi] = F.ny > 0 ? [F.solid.ylo, Math.min(F.solid.yhi, apex[1] - hcap)] : [Math.max(F.solid.ylo, apex[1] + hcap), F.solid.yhi];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
// The ridges: each pair of faces of a mass.
const RIDGES = [];
FACES.forEach((F, i) => FACES.forEach((G, j) => {
  if (i < j && F.solid === G.solid) RIDGES.push({ a: i, b: j, F, G });
}));
for (const r of RIDGES) {
  // The ridge's line: where the two planes meet, at heights y (cells).
  const dir = [r.F.n[1] * r.G.n[2] - r.F.n[2] * r.G.n[1], r.F.n[2] * r.G.n[0] - r.F.n[0] * r.G.n[2], r.F.n[0] * r.G.n[1] - r.F.n[1] * r.G.n[0]];
  r.at = (y) => solve3([r.F.n, r.G.n, [0, 1, 0]], [r.F.K, r.G.K, y]);
  r.dir = dir;
}
// Depths are a quarter cell's whole number (the city's) and a twelfth's
// (one level finer's): a face's depth plane at (ci, fi), in whole numbers of
// its measure (n . X) at each level (rounded in, so never deeper).
const NDQ = 5;
// (floor(p |n| / 12) for p twelfths, exactly: the largest m with (12 m)^2 <= p^2 nn.)
const depthN = (nn, p) => {
  let m = Math.floor(Math.sqrt(p * p * nn) / 12);
  while (144 * (m + 1) * (m + 1) <= p * p * nn) m++;
  while (m > 0 && 144 * m * m > p * p * nn) m--;
  return m;
};
for (const F of FACES) F.dn = [1, R].map((S) => Array.from({ length: NDQ * NDQ }, (_, i) => depthN(F.nn, (3 * Math.floor(i / NDQ) + (i % NDQ)) * S)));
if (Math.max(...FACES.map((F) => (3 * (NDQ - 1) + NDQ - 1) ** 2 * R * R * F.nn)) >= 2 ** 31) throw new Error('arcology: depths overflow');
const quarters = (x) => Math.round(x * 4), twelfths = (x) => Math.round(x * 12);
FACES.forEach((F) => (F.ridges = RIDGES.map((r, i) => (r.F === F ? i : r.G === F ? i : -1)).filter((i) => i >= 0)));
// The city's pockets and notches keep clear of the solids without relief
// (pillars, towers), half a cell around: worked out here once, so that the
// shader only compares a few whole numbers. For each face, the rectangles of
// it (u in its city measure, yp in cells, rounded out) over which a pocket
// could meet one; for each ridge, the heights (cells, rounded out) at which
// its notches could.
for (const F of FACES) {
  F.bare = [];
  // (Only the part of each box that a pocket could reach: from a cell out
  // to DMAX in, at the heights pockets are cut; sampled every quarter cell,
  // and rounded out by more than that.)
  const Q = 0.25;
  for (const [lo, hi] of BARE) {
    const a = [lo[0] - 0.5, Math.max(lo[1] - 0.5, F.solid.ylo), lo[2] - 0.5], b = [hi[0] + 0.5, Math.min(hi[1] + 0.5, F.solid.yhi), hi[2] + 0.5];
    // (Row by row of yp, so that a solid crossing the face at a slant
    // blanks its own footprint and not the rectangle round it.)
    const rows = new Map();
    for (let x = a[0]; x <= b[0] + 1e-9; x += Q)
      for (let y = a[1]; y <= b[1] + 1e-9; y += Q)
        for (let z = a[2]; z <= b[2] + 1e-9; z += Q) {
          const X = [x, y, z], depth = (F.K - dot(F.n, X)) / F.nl;
          if (depth < -1 - Q || depth > DMAX + Q) continue;
          const u = dot(F.tv, X), yp = (F.gm * dot(F.mv, X) + F.yk * F.K) / F.p;
          for (let r = Math.floor(yp - Q); r <= Math.floor(yp + Q); r++) {
            const o = rows.get(r) ?? [Infinity, -Infinity];
            rows.set(r, [Math.min(o[0], u), Math.max(o[1], u)]);
          }
        }
    for (const [r, [u0, u1]] of [...rows].sort((p, q) => p[0] - q[0])) {
      if (r + 1 <= F.cutLo || r >= F.cutHi) continue;
      const lo = Math.floor(u0 - Q * F.len), hi = Math.ceil(u1 + Q * F.len), last = F.bare.at(-1);
      if (last && last[3] === r && last[0] === lo && last[1] === hi) last[3] = r + 1;
      else F.bare.push([lo, hi, r, r + 1]);
    }
  }
}
const rectBare = (F, u0, u1, y0, y1) => F.bare.some(([a, b, c, d]) => u0 < b && u1 > a && y0 < d && y1 > c);
for (const r of RIDGES) {
  r.bare = [];
  const m = DMAX + 1;
  for (let y = Math.floor(r.F.cutLo); y < Math.ceil(r.F.cutHi); y += 0.25) {
    const a = r.at(y), b = r.at(y + 0.25);
    const lo = [0, 1, 2].map((k) => Math.min(a[k], b[k]) - m), hi = [0, 1, 2].map((k) => Math.max(a[k], b[k]) + m);
    if (!BARE.some(([p, q]) => [0, 1, 2].every((k) => lo[k] < q[k] + 0.5 && hi[k] > p[k] - 0.5))) continue;
    const y0 = Math.floor(y), y1 = Math.ceil(y + 0.25), last = r.bare.at(-1);
    if (last && y0 <= last[1]) last[1] = Math.max(last[1], y1);
    else r.bare.push([y0, y1]);
  }
}
const rowBare = (r, y0, y1) => r.bare.some(([a, b]) => y0 < b && y1 > a);
// Windows (S6): the upright faces of the solids that have them (pillars,
// towers) carry a grid of small windows one level finer, in the face's own frame:
// WIN wide and high (in the finer units), PITCH apart along and up, DEEP_WIN
// into the face.
const WIN = [6, 10], PITCH = [12, 16], DEEP_WIN = 3;
const WINDOWS = [];
SOLIDS.forEach((s) => {
  if (!s.windows) return;
  s.planes.forEach(({ n, K }) => {
    if (n[1] !== 0) return;
    const alpha = gcd(n[0], n[2]), h = [n[0] / alpha, 0, n[2] / alpha], t = [-h[2], 0, h[0]];
    WINDOWS.push({ n, K, alpha, h: slantOf(h), t: slantOf(t), hv: h, tv: t, len: Math.hypot(...h), solid: s });
  });
});
if (WINDOWS.length > 31) throw new Error(`arcology: ${WINDOWS.length} faces with windows, at most 31`);

// The table, one cell of level CITY + 1 to an entry (see volume in
// halls.js): in its first number, the cell's kind (KIND bits: 1 deep, its
// rooms the halls'; 2 skin, pockets and no rooms; 3 plain, solid), the faces
// whose pockets reach into it (FACE_AT, a bit each), and for a deep cell,
// for each of its six sides (+x, -x, +y, -y, +z, -z), whether its rooms'
// openings may run on across it (OPEN_AT: the next cell is deep too, or
// clear of every solid); for a skin cell, whether its pockets one level
// finer may, and whether they run on as one box or three (CROSS_AT: see
// runOn below).
const DEEP = 1, SKIN = 2, PLAIN = 3, FACE_AT = 2, OPEN_AT = 8, WIN_AT = 14, CROSS_AT = 19;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// (For the checks in .claude/verify.)
export const _V2 = { FACES, RIDGES, DMAX };
export const VOLUME = (() => {
  const lo = [0, 1, 2].map((a) => Math.min(...SOLIDS.map((s) => s.lo[a])) - 2);
  const hi = [0, 1, 2].map((a) => Math.max(...SOLIDS.map((s) => s.hi[a])) + 2);
  lo[1] = Math.max(lo[1], G);
  const size = hi.map((h, a) => h - lo[a]);
  const n = size[0] * size[1] * size[2];
  const at = ([x, y, z]) => x + size[0] * (y + size[1] * z);
  const within = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
  const kind = new Uint8Array(n), open = new Uint8Array(n), faces = new Uint8Array(n), win = new Uint8Array(n);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const c = [x + lo[0], y + lo[1], z + lo[2]], v = at([x, y, z]);
    const touched = SOLIDS.filter((s) => !cellOut(s, c));
    if (!touched.length) {
      open[v] = 1;
      continue;
    }
    // Faces whose pockets may reach in: some corner of the cell less than
    // REACH inside the face's plane, in its mass.
    let f = 0;
    FACES.forEach((F, i) => {
      if (cellOut(F.solid, c)) return;
      const ds = corners(c).map((q) => (F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]) - F.K) / Math.hypot(...F.n));
      if (Math.max(...ds) > -REACH) f |= 1 << i;
    });
    // Skin where pockets reach and only masses and their rims touch it; deep
    // where it is wholly inside some solid (whatever else crosses it) and no
    // pocket reaches; plain otherwise.
    if (f && touched.every((s) => s.relief || s.rim)) (kind[v] = SKIN), (faces[v] = f);
    else kind[v] = !f && touched.some((s) => cellIn(s, c)) ? DEEP : PLAIN;
    // A plain cell that only one solid touches, crossed by its upright faces,
    // has the windows of the one passing nearest its middle.
    if (kind[v] === PLAIN && touched.length === 1) {
      const cs = corners(c), mid = [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5];
      const crossed = planesOf(touched[0]).filter((p) => p.n[1] === 0 && cs.some((q) => side(p, q) < 0) && cs.some((q) => side(p, q) >= 0));
      crossed.sort((p, q) => Math.abs(side(p, mid)) / p.len - Math.abs(side(q, mid)) / q.len);
      const w = crossed.length ? WINDOWS.findIndex((W) => W.solid === touched[0] && W.n.every((x, a) => x === crossed[0].n[a])) : -1;
      if (w >= 0) win[v] = w + 1;
    }
  }
  // A skin cell's pockets one level finer run on a cell past each side in
  // OPEN_AT, so that a pocket across the side is one piece and not two that
  // only touch (shrunk with distance, two would leave a sheet between them).
  // A side is open unless the next cell is one that a pocket of the cell's
  // faces could reach (from its lip past the face to REACH in) and that would
  // not cut it (deaf): a deep or plain cell. A skin cell cuts the same
  // pockets (they are the point's alone), and a cell clear of every solid is
  // the city's air. The open sides make one box, across edges and corners
  // too; where that box would take in a deaf cell, each piece is three
  // instead, each run on along one axis only (CROSS_AT).
  const lip = Math.max(...FACES.map((F) => Math.ceil(F.nl) / F.nl)) / R + 1e-3;
  const deaf = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    if (kind[v] !== DEEP && kind[v] !== PLAIN) continue;
    const c = [v % size[0], Math.floor(v / size[0]) % size[1], Math.floor(v / size[0] / size[1])].map((x, a) => x + lo[a]);
    FACES.forEach((F, i) => {
      const ds = corners(c).map((q) => (F.K - (F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]))) / F.nl);
      if (Math.min(...ds) < REACH && Math.max(...ds) > -lip) deaf[v] |= 1 << i;
    });
  }
  const runOn = (x, y, z, f) => {
    const ok = (dx, dy, dz) => {
      const u = [x + dx, y + dy, z + dz];
      return !within(u) || !(deaf[at(u)] & f);
    };
    let open = 0;
    SIDES.forEach((e, k) => ok(...e) && (open |= 1 << k));
    const ax = [0, 1, 2].map((a) => [0, ...(open & (1 << (2 * a)) ? [1] : []), ...(open & (2 << (2 * a)) ? [-1] : [])]);
    const box = ax[0].every((dx) => ax[1].every((dy) => ax[2].every((dz) => ok(dx, dy, dz))));
    return (open << OPEN_AT) | (box ? 0 : 1 << CROSS_AT);
  };
  const data = new Uint32Array(2 * n);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = at([x, y, z]);
    if (!kind[v]) continue;
    let word = kind[v] | (faces[v] << FACE_AT) | (win[v] << WIN_AT);
    if (kind[v] === DEEP)
      SIDES.forEach((e, k) => {
        const u = [x + e[0], y + e[1], z + e[2]];
        if (!within(u) || open[at(u)] || kind[at(u)] === DEEP) word |= 1 << (OPEN_AT + k);
      });
    if (kind[v] === SKIN) word |= runOn(x, y, z, faces[v]);
    data[2 * v] = word >>> 0;
  }
  return { lo, size, data, kind, open, at, within };
})();

// The ways into the building from the plaza, for the tour (see
// Planner.waysFromCity): each a room of the halls one level finer than the
// city's, in a deep cell, with an opening in one of its walls straight out
// onto open air. As { id, e }: the room's cell's id at that level, and the
// way out of it through the opening.
export const ENTRANCES = (() => {
  const { lo, size, kind, open, at, within } = VOLUME;
  const seed = levelSeed(CITY + 1), out = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = [x, y, z];
    if (kind[at(v)] !== DEEP) continue;
    const id = wrapId([x + lo[0] + R * C, y + lo[1] + R * ROW, z + lo[2] + R * C]);
    if (!hallsRoom(id, seed)) continue;
    for (const o of hallsOpenings(id, seed)) {
      if (o.e[1] !== 0) continue;
      const u = v.map((q, a) => q + o.e[a]);
      if (within(u) && open[at(u)]) out.push({ id, e: o.e, at: o.at });
    }
  }
  return out;
})();

const ivecs = (rows) => rows.map(([x, y, z]) => `ivec3(${x}, ${y}, ${z})`).join(', ');
const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// One solid's distance, as GLSL: each plane's offset worked out in whole
// numbers (o is the cell's corner from the middle cell's), and only the
// small parts in floats.
function solidGlsl(s, j) {
  const lines = planesOf(s).map((p) => {
    const nrm = `vec3(${p.n.map((x) => glf(x / p.len)).join(', ')})`;
    if (p.dir < 3) {
      const a = 'xyz'[p.dir];
      return `  solidPlane((float(${p.scale} * L.${a} - (${p.K} - ${p.scale} * o.${a})) + ${glf(p.scale)} * f.${a}) * ${glf(1 / p.len)}, ${nrm});`;
    }
    const m = p.m, k = `${p.K} - ${p.scale} * (${m[0]} * o.x + ${m[1]} * o.y + ${m[2]} * o.z)`;
    return `  fr = slantAt(${p.dir - 3}, n);\n  solidPlane((float(${p.scale} * n - (${k})) + ${glf(p.scale)} * fr) * ${glf(1 / p.len)}, ${nrm});`;
  });
  return `float solid${j}(ivec3 L, vec3 f, ivec3 o) {\n  int n;\n  float fr;\n  solidPiece();\n${lines.join('\n')}\n  return solidDone();\n}`;
}

const glsl = /* glsl */ `
const int G = ${G};
const int NS = ${SOLIDS.length};
const ivec3 SLO[NS] = ivec3[NS](${ivecs(SOLIDS.map((s) => s.lo))});
const ivec3 SHI[NS] = ivec3[NS](${ivecs(SOLIDS.map((s) => s.hi))});
const int NNEAR = ${NEAR_CELLS.length};
const ivec3 NEAR_CELLS[NNEAR] = ivec3[NNEAR](${ivecs(NEAR_CELLS)});
const int NEAR_START[NNEAR + 1] = int[NNEAR + 1](${NEAR_START.join(', ')});
const int NEAR_BLOCKS[${NEAR_BLOCKS.length}] = int[${NEAR_BLOCKS.length}](${NEAR_BLOCKS.join(', ')});
const int NBUILT = ${BUILT_CELLS.length};
const ivec2 BUILT_CELLS[NBUILT] = ivec2[NBUILT](${BUILT_CELLS.map(([a, b]) => `ivec2(${a}, ${b})`).join(', ')});

const ivec3 VOL_LO = ivec3(${VOLUME.lo.join(', ')});
const ivec3 VOL_SIZE = ivec3(${VOLUME.size.join(', ')});
const ivec3 ORIGIN = ivec3(${ORIGIN.join(', ')});
const int FACE_AT = ${FACE_AT}, OPEN_AT = ${OPEN_AT}, CROSS_AT = ${CROSS_AT};
const uint POCKET_SALT = ${POCKET_SALT}u, ROW_SALT = ${ROW_SALT}u, DEPTH_SALT = ${DEPTH_SALT}u;
// The two levels' pockets (see LEVELS): sb, sby, quant, splits, and the
// least a part may be (LV_MIN, in quanta); and their depths' shares, ND to a
// level.
const int ND = ${ND};
const ivec4 LV[2] = ivec4[2](${LEVELS.map((l) => `ivec4(${l.sb}, ${l.sby}, ${l.quant}, ${l.splits})`).join(', ')});
const int LV_MIN[2] = int[2](${LEVELS.map((l) => l.min).join(', ')});
const float CUM[2 * ND] = float[2 * ND](${LEVELS.flatMap((l) => [...l.cumulative, ...Array(ND - l.depths.length).fill(2)]).map(glf).join(', ')});
const float NCUM[2 * ND] = float[2 * ND](${NOTCH.flatMap((N) => [...N.cum, ...Array(ND - N.cum.length).fill(2)]).map(glf).join(', ')});
const uint NLONG[2] = uint[2](${NOTCH.map((N) => `${N.armLong}u`).join(', ')});
const int NF = ${FACES.length};
// Each face (relief v2, see FACES and the setup after BARE): n's slant
// (index, sign), K, alpha; -q (its rows' K term, see F.yk); its unit normal;
// its h and t as slants (index, sign); its quanta along (q2, a level each);
// lo, hi (4 y); its rows' m's slant (index,
// sign), gm and p (its rows, see faceAt), and nn; |n|, gm |m|, and m's unit
// vector; Z; the heights it may be cut between (cells); and its depth along
// the mass's other faces (c0, cu, cy, see F.aff).
const ivec4 FPLANE[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.plane.k}, ${F.plane.sign}, ${F.K}, ${F.alpha})`).join(', ')});
const int FNY[NF] = int[NF](${FACES.map((F) => F.yk).join(', ')});
const int FNN[NF] = int[NF](${FACES.map((F) => F.nn).join(', ')});
const vec3 FN[NF] = vec3[NF](${FACES.map((F) => `vec3(${F.n.map((x) => glf(x / F.nl)).join(', ')})`).join(', ')});
const ivec4 FHT[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.h.k}, ${F.h.sign}, ${F.t.k}, ${F.t.sign})`).join(', ')});
const ivec4 FQY[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.q2[0]}, ${F.q2[1]}, ${F.lo4}, ${F.hi4})`).join(', ')});
const ivec3 FT[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.tv))});
const float FLEN[NF] = float[NF](${FACES.map((F) => glf(F.len)).join(', ')});
const ivec4 FSL[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.ms.k}, ${F.ms.sign}, ${F.gm}, ${F.p})`).join(', ')});
const vec2 FNS[NF] = vec2[NF](${FACES.map((F) => `vec2(${glf(F.nl)}, ${glf(F.gm * F.mlen)})`).join(', ')});
const vec3 FSV[NF] = vec3[NF](${FACES.map((F) => `vec3(${F.mv.map((x) => glf(x / F.mlen)).join(', ')})`).join(', ')});
const float FZ[NF] = float[NF](${FACES.map((F) => glf(F.Z)).join(', ')});
const vec2 FCUT[NF] = vec2[NF](${FACES.map((F) => `vec2(${glf(F.cutLo)}, ${glf(F.cutHi)})`).join(', ')});
const vec3 FAFF[NF * 2] = vec3[NF * 2](${FACES.flatMap((F) => F.aff.map((a) => `vec3(${[a.c0, a.cu, a.cy].map(glf).join(', ')})`)).join(', ')});
const vec3 FAT[NF * 4] = vec3[NF * 4](${FACES.flatMap((F) => {
  const x0 = F.at(0, 0, 0), xu = F.at(1, 0, 0), xy = F.at(0, 1, 0), xd = F.at(0, 0, 1);
  return [x0, xu.map((x, a) => x - x0[a]), xy.map((x, a) => x - x0[a]), xd.map((x, a) => x - x0[a])].map((v) => `vec3(${v.map(glf).join(', ')})`);
}).join(', ')});
const int FOUR = ${FOUR.k};
// Each level's depths (its own units), and its deepest; the ridges' notches
// (sb, quant, splits, least row in quanta) and their arms' quantum; the ridges: their faces, and
// the point on each at height y (P0 + Py y, cells).
const float DEPTHS[2 * ND] = float[2 * ND](${LEVELS.flatMap((l) => [...l.depths, ...Array(ND - l.depths.length).fill(0)]).map(glf).join(', ')});
const float DTOP[2] = float[2](${LEVELS.map((l) => glf(l.depths.at(-1))).join(', ')});
const ivec4 NOTCHP[2] = ivec4[2](${NOTCH.map((N) => `ivec4(${N.sb}, ${N.quant}, ${N.splits}, ${N.min})`).join(', ')});
const float NARM[2] = float[2](${NOTCH.map((N) => glf(N.arm)).join(', ')});
const uint NOTCH_SALT = ${NOTCH_SALT}u, TILE_SALT = ${TILE_SALT}u;
const int NRG = ${RIDGES.length};
const ivec2 RAB[NRG] = ivec2[NRG](${RIDGES.map((r) => `ivec2(${r.a}, ${r.b})`).join(', ')});
const vec3 RP[NRG * 2] = vec3[NRG * 2](${RIDGES.flatMap((r) => {
  const p0 = r.at(0), p1 = r.at(1);
  return [p0, p1.map((x, a) => x - p0[a])].map((v) => `vec3(${v.map(glf).join(', ')})`);
}).join(', ')});
const float DMAX = ${glf(DMAX)}, BAND_IN = ${glf(BAND_IN)}, BAND_OUT = ${glf(BAND_OUT)};
// The windows' faces (see WINDOWS): h and t as slants (index, sign); K, alpha
// (w = h . Y < K R / alpha inside); len; and the grid: pitch and width along
// (in u), the depth (in w).
const int NW = ${Math.max(WINDOWS.length, 1)};
const ivec4 WHT[NW] = ivec4[NW](${(WINDOWS.length ? WINDOWS : [{ h: { k: 0, sign: 1 }, t: { k: 0, sign: 1 } }]).map((W) => `ivec4(${W.h.k}, ${W.h.sign}, ${W.t.k}, ${W.t.sign})`).join(', ')});
const ivec2 WKA[NW] = ivec2[NW](${(WINDOWS.length ? WINDOWS : [{ K: 0, alpha: 1 }]).map((W) => `ivec2(${W.K}, ${W.alpha})`).join(', ')});
const ivec3 WH[NW] = ivec3[NW](${ivecs((WINDOWS.length ? WINDOWS : [{ hv: [1, 0, 0] }]).map((W) => W.hv))});
const ivec3 WT[NW] = ivec3[NW](${ivecs((WINDOWS.length ? WINDOWS : [{ tv: [0, 0, 1] }]).map((W) => W.tv))});
const float WLEN[NW] = float[NW](${(WINDOWS.length ? WINDOWS : [{ len: 1 }]).map((W) => glf(W.len)).join(', ')});
const ivec3 WGRID[NW] = ivec3[NW](${(WINDOWS.length ? WINDOWS : [{ len: 1 }]).map((W) => `ivec3(${Math.round(PITCH[0] * W.len)}, ${Math.round(WIN[0] * W.len)}, ${Math.round(DEEP_WIN * W.len)})`).join(', ')});
const int WIN_AT = ${WIN_AT}, WIN_H = ${WIN[1]}, PITCH_Y = ${PITCH[1]};
// Each face's mass's bounds, from the building's origin, in cells.
const ivec3 FLO[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.solid.lo.map((x, a) => x - ORIGIN[a])))});
const ivec3 FHI[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.solid.hi.map((x, a) => x - ORIGIN[a])))});
const int NBARE = ${BARE.length};
const ivec3 BARE_LO[NBARE] = ivec3[NBARE](${ivecs(BARE.map((b) => b[0]))});
const ivec3 BARE_HI[NBARE] = ivec3[NBARE](${ivecs(BARE.map((b) => b[1]))});

// Where the middle city cell is from this one, in lattice units.
ivec3 fromMiddle(ivec3 id) {
  return (id - ivec3(${MID}, ${ROW_ID}, ${MID})) * R;
}

// What the table says of the level-(CITY + 1) cell id, in a city cell
// (whose id is up): nothing, if it is not in the table. gCellB is set to the
// cell's corner from the building's origin, in cells.
ivec3 gCellB;
uvec2 relief(ivec3 id, ivec3 up) {
  if (up.y < ${ROW_ID} || up.y >= ${ROW_ID + ROWS}) return uvec2(0u);
  ivec3 own = id - R * ivec3(floor((vec3(id) + 0.5) / float(R)));
  ivec3 v = fromMiddle(up) + own - VOL_LO;
  if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) return uvec2(0u);
  gCellB = v + VOL_LO - ORIGIN;
  return texelFetch(uVolume, v, 0).rg;
}

int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); } // floor, b > 0
int cdiv(int a, int b) { return -fdiv(-a, b); } // ceiling, b > 0

// The rectangle of face k at level lv that the point is in (u along the
// face, in its own measure, y up by its projection's height, each a whole
// number and the rest), and its depth's index. One level finer, tiled afresh
// in each city rectangle (tile, from its corner; no rows shifted).
int gU0, gU1, gY0, gY1, gDepth;
void rectangle(int lv, int k, int u, float fu, int y, float fy, uint tile) {
  ivec4 lvp = LV[lv];
  int q = lv == 0 ? FQY[k].x : FQY[k].y, n = lvp.x / lvp.z, su = n * q;
  uint salt = uint(lv * 0x5bd1e995) ^ tile;
  int row = fdiv(y - (fy < 0.0 ? 1 : 0), lvp.y);
  int shift = lv == 0 ? q * int(hashCell(ivec3(row, k, lv), ROW_SALT ^ salt) % uint(n)) : 0;
  int col = fdiv(u - (fu < 0.0 ? 1 : 0) - shift, su);
  int u0 = col * su + shift, u1 = u0 + su, y0 = row * lvp.y, y1 = y0 + lvp.y;
  uint h = hashCell(ivec3(col, row, k), POCKET_SALT ^ salt);
  int m = LV_MIN[lv];
  for (int i = 0; i < lvp.w; i++) {
    int nu = (u1 - u0) / q, ny = (y1 - y0) / lvp.z;
    bool cu = nu >= 2 * m, cy = ny >= 2 * m;
    if (cu || cy) {
      bool alongU = cu && (!cy || (h & 0xffu) * uint(nu + ny) < 256u * uint(nu));
      int s = m + int((h >> 8) % uint((alongU ? nu : ny) - 2 * m + 1));
      if (alongU) { if (beyond(u, fu, u0 + s * q)) u0 += s * q; else u1 = u0 + s * q; }
      else { if (beyond(y, fy, y0 + s * lvp.z)) y0 += s * lvp.z; else y1 = y0 + s * lvp.z; }
    }
    h = hashCell(ivec3(u0, y0, u1 * 4099 + y1), (POCKET_SALT ^ salt) ^ uint(k));
  }
  float t = h01(hashCell(ivec3(u0, y0, k), DEPTH_SALT ^ salt));
  int j = 0;
  for (int i = 0; i < ND - 1; i++) if (t >= CUM[lv * ND + i]) j = i + 1;
  gU0 = u0; gU1 = u1; gY0 = y0; gY1 = y1; gDepth = j;
}

// Ridge r's notch row at level lv (see notchRow in the JS): its ends, depth
// and arms' reach.
int gNY0, gNY1;
float gND, gNA;
void notchRow(int lv, int r, int y, float fy, int origin, uint salt) {
  ivec4 N = NOTCHP[lv];
  int yr = y - origin;
  int row = fdiv(yr - (fy < 0.0 ? 1 : 0), N.x);
  int y0 = row * N.x, y1 = y0 + N.x;
  uint h = hashCell(ivec3(row, r, lv), NOTCH_SALT ^ salt);
  for (int i = 0; i < N.z; i++) {
    int ny = (y1 - y0) / N.y;
    if (ny >= 2 * N.w) {
      int k = N.w + int((h >> 8) % uint(ny - 2 * N.w + 1));
      if (beyond(yr, fy, y0 + k * N.y)) y0 += k * N.y; else y1 = y0 + k * N.y;
    }
    h = hashCell(ivec3(y0, y1, r), NOTCH_SALT ^ salt ^ uint(lv));
  }
  float t = h01(hashCell(ivec3(y0, r, lv), DEPTH_SALT ^ NOTCH_SALT ^ salt));
  int j = 0;
  for (int i = 0; i < ND - 1; i++) if (t >= NCUM[lv * ND + i]) j = i + 1;
  float d = DEPTHS[lv * ND + j];
  int steps = int(floor((DTOP[lv] - d) / NARM[lv] + 1e-6));
  uint hh = h >> 8;
  int k = hh < NLONG[lv] ? steps : int(((hh - NLONG[lv]) * uint(steps + 1)) / (16777216u - NLONG[lv]));
  gNY0 = y0 + origin; gNY1 = y1 + origin; gND = d;
  gNA = d + float(min(steps, k)) * NARM[lv];
}

// Whether face k's pocket over [u0, u1] x [y0, y1] (the city's measure and
// cells), or ridge i's notch row over [y0, y1], could meet a solid without
// relief (see F.bare and r.bare): straight comparisons, no loops.
bool rectBare(int k, int u0, int u1, int y0, int y1) {
${FACES.map((F, k) => `  if (k == ${k}) return ${F.bare.length ? F.bare.map(([a, b, c, d]) => `(u0 < ${b} && u1 > ${a} && y0 < ${d} && y1 > ${c})`).join(' || ') : 'false'};`).join('\n')}
  return false;
}
bool rowBare(int i, int y0, int y1) {
${RIDGES.map((r, i) => `  if (i == ${i}) return ${r.bare.length ? r.bare.map(([a, b]) => `(y0 < ${b} && y1 > ${a})`).join(' || ') : 'false'};`).join('\n')}
  return false;
}
bool inCut(int k, float S, int y0, int y1) {
  return float(y0) >= FCUT[k].x * S - 1e-6 && float(y1) <= FCUT[k].y * S + 1e-6;
}

// See allowed in the JS: [gA0, gA1], or false.
int gA0, gA1;
bool allowed(int k, int lv, int u0, int u1, int y0, int y1, int q) {
  float sc = lv == 0 ? 1.0 : float(R), lo = float(u0), hi = float(u1);
  bool none = false;
  for (int j = 0; j < 2; j++) {
    vec3 a = FAFF[k * 2 + j];
    for (int c = 0; c < 2; c++) {
      float rest = a.x + a.z * float(c == 0 ? y0 : y1) / sc;
      if (a.y > 1e-9) lo = max(lo, (FZ[k] - rest) * sc / a.y);
      else if (a.y < -1e-9) hi = min(hi, (FZ[k] - rest) * sc / a.y);
      else none = none || rest < FZ[k];
    }
  }
  if (none) return false;
  gA0 = u0 + int(ceil((lo - float(u0)) / float(q) - 1e-6)) * q;
  gA1 = u0 + int(floor((hi - float(u0)) / float(q) + 1e-6)) * q;
  return gA1 - gA0 >= LV_MIN[lv] * q;
}

// Where the point is on face k (see faceAt in the JS).
int gPu, gPy, gPYi, gPni;
float gPfu, gPfy, gPYf, gPnf;
void faceAt(int k, int S, ivec3 base) {
  ivec4 ht = FHT[k], sl = FSL[k], pl = FPLANE[k];
  int u, sn, nn;
  gPfu = float(ht.w) * slantAt(ht.z, u);
  gPu = ht.w * u + FT[k].x * base.x + FT[k].z * base.z;
  ivec3 ms = SLANT[sl.x], mn = SLANT[pl.x];
  float sf = float(sl.y) * slantAt(sl.x, sn);
  gPYi = sl.z * (sl.y * sn + sl.y * (ms.x * base.x + ms.y * base.y + ms.z * base.z)) + FNY[k] * pl.z * S;
  gPYf = float(sl.z) * sf;
  gPy = fdiv(gPYi + int(floor(gPYf)), sl.w);
  gPfy = (float(gPYi - gPy * sl.w) + gPYf) / float(sl.w);
  gPnf = float(pl.y) * slantAt(pl.x, nn);
  gPni = pl.y * (nn + mn.x * base.x + mn.y * base.y + mn.z * base.z);
}

// A face's depth planes (see notch and pocketAir): inside when more than x
// cells in (units at level scale S), or at most a unit out.
void depthIn(int k, int S, ivec2 x, int ni, float nf) {
  // (floor(p |n| / 12) for p twelfths, exactly: see depthN in the JS.)
  int p = (3 * x.x + x.y) * S, q = p * p * FNN[k];
  int dn = int(floor(sqrt(float(q)) / 12.0));
  if (144 * (dn + 1) * (dn + 1) <= q) dn++;
  if (dn > 0 && 144 * dn * dn > q) dn--;
  airPlane((float(FPLANE[k].z * S - dn - ni) - nf) / FNS[k].x, -FN[k]);
}
void depthOut(int k, int S, int ni, float nf) {
  float nl = FNS[k].x;
  airPlane((float(ni - FPLANE[k].z * S - int(ceil(nl))) + nf) / nl, FN[k]);
}

// The true heights lo..hi (in 4 y at the city's level; in units one level
// finer, and within the cell, or a cell past each side in gCarveOpen; as
// three pieces (gCarveCross), the piece gAxis runs on along that axis only:
// see runOn in the JS. (Set with gCarve, below.)
uint gCarveOpen;
bool gCarveCross;
int gAxis;
bool runsOn(int a, uint side) { return (gCarveOpen & (side << uint(2 * a))) != 0u && (gAxis < 0 || gAxis == a); }
int openLo(int a) { return runsOn(a, 2u) ? -R : 0; }
int openHi(int a) { return runsOn(a, 1u) ? 2 * R : R; }
void heights(int lv, ivec3 L, vec3 f, ivec3 base, int lo4, int hi4) {
  if (lv == 1) {
    airSpan(L.y, f.y, max(lo4 * R / 4 - base.y, openLo(1)), min(hi4 * R / 4 - base.y, openHi(1)), EY);
    airSpan(L.x, f.x, openLo(0), openHi(0), EX);
    airSpan(L.z, f.z, openLo(2), openHi(2), EZ);
  } else {
    int n4;
    float f4 = slantAt(FOUR, n4);
    n4 += 4 * base.y;
    airPlane((float(lo4 - n4) - f4) * 0.25, -EY);
    airPlane((float(n4 - hi4) + f4) * 0.25, EY);
  }
}

// The air of a pocket of face k over [u0, u1] x [y0, y1], D cells deep (the
// point's place on the face from faceAt), united with d.
float pocketAir(int k, int lv, ivec3 L, vec3 f, ivec3 base, int u0, int u1, int y0, int y1, ivec2 D, float d, bool ray, inout float reach, inout vec3 nrm) {
  int S = lv == 0 ? 1 : R;
  float inv = 1.0 / FLEN[k], ys = FNS[k].y;
  int nn = FSL[k].w; // (p: see faceAt)
  vec3 tn = vec3(FT[k]) * inv;
  int pieces = lv == 1 && gCarveCross ? 3 : 1;
  for (int a = 0; a < 3; a++) {
    if (a >= pieces) break;
    gAxis = pieces == 1 ? -1 : a;
    gRay = false;
    float g = 1e9;
    for (int pass = 0; pass < 2; pass++) {
      airPiece();
      airPlane((float(u0 - gPu) - gPfu) * inv, -tn);
      airPlane((float(gPu - u1) + gPfu) * inv, tn);
      airPlane((float(y0 * nn - gPYi) - gPYf) / ys, -FSV[k]);
      airPlane((float(gPYi - y1 * nn) + gPYf) / ys, FSV[k]);
      depthIn(k, S, D, gPni, gPnf);
      depthOut(k, S, gPni, gPnf);
      heights(lv, L, f, base, FQY[k].z, FQY[k].w);
      if (pass == 0) {
        g = gD;
        if (!ray || g + gO > 0.0) break;
        gRay = true;
      } else {
        gRay = false;
        if (gX > reach) { reach = gX; nrm = gN; }
      }
    }
    d = min(d, g);
  }
  return d;
}

// Face k's pockets where the point is, at level lv (see facePocket in the
// JS), united with d; and where it is in none, how far off its rectangle's
// edges are at least (the face's other pockets are beyond them). (Each
// part is asked after in one place only, in a loop over the levels: the
// compiler copies a function out wherever it is called.)
float facePocket(int lv, int k, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {
  int S = lv == 0 ? 1 : R;
  faceAt(k, S, base);
  int ru = gPu, ry = gPy;
  float rfu = gPfu, rfy = gPfy;
  if (lv == 1) {
    ru = fdiv(gPu + (gPfu < 0.0 ? -1 : 0), R);
    rfu = (float(gPu - R * ru) + gPfu) / float(R);
    ry = fdiv(gPy, R);
    rfy = (float(gPy - R * ry) + gPfy) / float(R);
  }
  int uc = ru;
  uint tile = 0u;
  int o0 = 0, o1 = 0, b0 = 0, b1 = 0, cu0 = 0, cu1 = 0, cy0 = 0, cy1 = 0, a0 = 0, a1 = 0, y0 = 0, y1 = 0;
  float Dc = 0.0, cap = 0.0;
  bool has = false, cut = false;
  ivec2 D = ivec2(0);
  float inv = 1.0 / FLEN[k], ys = FNS[k].y;
  int nn = FSL[k].w; // (p: see faceAt)
  for (int l = 0; l <= lv; l++) {
    rectangle(l, k, ru, rfu, ry, rfy, tile);
    int u0 = gU0 + o0, u1 = gU1 + o0;
    y0 = gY0 + o1; y1 = gY1 + o1;
    float Sl = l == 0 ? 1.0 : float(R), dl = DEPTHS[l * ND + gDepth];
    // (The city's pocket; one level finer, within it or out of it: the tiles align with its edges.)
    b0 = u0; b1 = u1;
    if (l == 0) { cu0 = u0; cu1 = u1; cy0 = y0; cy1 = y1; }
    else if (has) {
      if (uc >= a0 && uc < a1) { b0 = max(b0, R * a0); b1 = min(b1, R * a1); }
      else {
        Dc = 0.0;
        if (float(gPu) + gPfu < float(R * a0)) b1 = min(b1, R * a0); else b0 = max(b0, R * a1);
      }
    }
    bool ok = dl > 0.0 && b0 < b1 && inCut(k, Sl, y0, y1) && (l == 1 || !rectBare(k, b0, b1, y0, y1)) && allowed(k, l, b0, b1, y0, y1, l == 0 ? FQY[k].x : FQY[k].y);
    if (l == 0) {
      has = ok; a0 = gA0; a1 = gA1; Dc = has ? dl : 0.0;
      D = ivec2(int(round(Dc * 4.0)), 0);
      // (One level finer: tiled afresh from this rectangle's corner.)
      o0 = R * u0; o1 = R * y0;
      ru = gPu - o0; rfu = gPfu; ry = gPy - o1; rfy = gPfy;
      tile = hashCell(ivec3(u0, y0, k), TILE_SALT);
      cut = has && lv == 0;
      b0 = a0; b1 = a1;
    } else {
      cut = ok;
      b0 = gA0; b1 = gA1;
      D = ivec2(int(round(Dc * 4.0)), int(round(dl / 2.0)));
    }
    cap = min(min(float(gPu - u0) + gPfu, float(u1 - gPu) - gPfu) * inv,
              min((float(gPYi - y0 * nn) + gPYf) / ys, (float(y1 * nn - gPYi) - gPYf) / ys));
  }
  if (cut) d = pocketAir(k, lv, L, f, base, b0, b1, y0, y1, D, d, ray, reach, nrm);
  return min(d, max(cap, 0.0));
}

// Ridge i's notches where the point is, at level lv (see notch in the JS),
// united with d; and where it is in none, how far off its row's ends are.
float notch(int lv, int i, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {
  int S = lv == 0 ? 1 : R;
  int a = RAB[i].x, b = RAB[i].y;
  int y = base.y + L.y;
  float fy = f.y;
  int ry = lv == 0 ? y : fdiv(y + (fy < 0.0 ? -1 : 0), R), origin = 0;
  float rfy = lv == 0 ? fy : (float(y - R * ry) + fy) / float(R);
  uint salt = 0u;
  int ry0 = 0, ry1 = 0;
  ivec2 dd = ivec2(0), A = ivec2(0);
  for (int l = 0; l <= lv; l++) {
    notchRow(l, i, ry, rfy, origin, salt);
    ry0 = gNY0; ry1 = gNY1;
    float Sl = l == 0 ? 1.0 : float(R);
    if (gND > 0.0 && inCut(a, Sl, ry0, ry1) && (l == 1 || !rowBare(i, ry0, ry1))) {
      if (l == 0) { dd.x = int(round(gND * 4.0)); A.x = int(round(gNA * 4.0)); }
      else { dd.y = int(round(gND / 2.0)); A.y = int(round(gNA / 2.0)); }
    }
    ry = y; rfy = fy; origin = R * ry0; salt = hashCell(ivec3(ry0, i, 1), TILE_SALT);
  }
  float cap = min(float(y - ry0) + fy, float(ry1 - y) - fy);
  if (dd.x + dd.y > 0) {
    int ni[2];
    float nf[2];
    for (int s = 0; s < 2; s++) {
      faceAt(s == 0 ? a : b, S, base);
      ni[s] = gPni; nf[s] = gPnf;
    }
    int pieces = lv == 1 && gCarveCross ? 6 : 2;
    for (int j = 0; j < 6; j++) {
      if (j >= pieces) break;
      int side = j & 1;
      gAxis = pieces == 2 ? -1 : j >> 1;
      gRay = false;
      float g = 1e9;
      for (int pass = 0; pass < 2; pass++) {
        airPiece();
        depthIn(a, S, side == 0 ? dd : A, ni[0], nf[0]);
        depthIn(b, S, side == 0 ? A : dd, ni[1], nf[1]);
        depthOut(a, S, ni[0], nf[0]);
        depthOut(b, S, ni[1], nf[1]);
        airSpan(L.y, f.y, ry0 - base.y, ry1 - base.y, EY);
        heights(lv, L, f, base, FQY[a].z, FQY[a].w);
        if (pass == 0) {
          g = gD;
          if (!ray || g + gO > 0.0) break;
          gRay = true;
        } else {
          gRay = false;
          if (gX > reach) { reach = gX; nrm = gN; }
        }
      }
      d = min(d, g);
    }
  }
  return min(d, max(cap, 0.0));
}

// The pockets and notches at level lv of the faces with a bit in faces
// (base: the point's cell's corner from the building's origin, in the
// level's units). Asked after from one place (see cell): what asks for them
// leaves the level (or -1), the faces, base and the cell's own bound here.
int lowBit(uint m) { return int(round(log2(float(m & (~m + 1u))))); } // (findLSB, for small m)
int gCarve;
uint gCarveFaces;
ivec3 gCarveBase;
float gCarveE;
float carve(int lv, ivec3 L, vec3 f, ivec3 base, uint faces, float d, bool ray, inout float reach, inout vec3 nrm) {
  // (Over the bits set, so that the compiler makes one copy of each, not
  // one for every face or ridge.)
  uint ridges = 0u;
  for (int i = 0; i < NRG; i++)
    if ((faces & (1u << uint(RAB[i].x))) != 0u && (faces & (1u << uint(RAB[i].y))) != 0u) ridges |= 1u << uint(i);
  for (uint m = faces; m != 0u; m &= m - 1u) d = facePocket(lv, lowBit(m), L, f, base, d, ray, reach, nrm);
  for (uint m = ridges; m != 0u; m &= m - 1u) d = notch(lv, lowBit(m), L, f, base, d, ray, reach, nrm);
  return d;
}

// Which faces the city's pockets and notches may reach the point from (o
// its cell's corner from the middle cell's: from a cell past each to
// BAND_IN in); and, in gFar, how far off the rest are at least.
float gFar;
uint cityFaces(ivec3 L, vec3 f, ivec3 o) {
  ivec3 base = o - ORIGIN;
  gFar = 1e9;
  uint near = 0u;
  vec3 q = vec3(base + L) + f;
  for (int k = 0; k < NF; k++) {
    vec3 off = max(vec3(FLO[k]) - 2.0 - q, q - vec3(FHI[k]) - 2.0);
    float away = max(max(off.x, off.y), off.z);
    if (away > 0.0) { gFar = min(gFar, away); continue; }
    ivec4 pl = FPLANE[k];
    ivec3 m = SLANT[pl.x];
    int n;
    float fr = float(pl.y) * slantAt(pl.x, n);
    float s = (float(pl.y * n + pl.y * (m.x * base.x + m.y * base.y + m.z * base.z) - pl.z) + fr) / FNS[k].x;
    if (s < -BAND_IN) { gFar = min(gFar, -s - BAND_IN); continue; }
    if (s > BAND_OUT) { gFar = min(gFar, s - BAND_OUT); continue; }
    near |= 1u << uint(k);
  }
  return near;
}

// Window j's grid where the point is, in a plain cell: the window of its
// square of the grid (PITCH along and up), from DEEP_WIN behind the face to a
// unit past it, within the cell; and where the point is in none, how far off
// its square's edges are (the other windows are beyond them).
float windowAir(int j, ivec3 L, vec3 f, float d, bool ray, inout float reach, inout vec3 nrm) {
  ivec3 base = gCellB * R;
  ivec4 ht = WHT[j];
  ivec3 g = WGRID[j];
  int u, w;
  float fu = float(ht.w) * slantAt(ht.z, u), fw = float(ht.y) * slantAt(ht.x, w);
  u = ht.w * u + WT[j].x * base.x + WT[j].z * base.z;
  w = ht.y * w + WH[j].x * base.x + WH[j].z * base.z;
  int y = base.y + L.y - ${GROUND * R};
  int cu = fdiv(u - (fu < 0.0 ? 1 : 0), g.x), cy = fdiv(y - (f.y < 0.0 ? 1 : 0), PITCH_Y);
  float len = WLEN[j], inv = 1.0 / len;
  int u0 = cu * g.x + (g.x - g.y) / 2, u1 = u0 + g.y, y0 = cy * PITCH_Y + (PITCH_Y - WIN_H) / 2, y1 = y0 + WIN_H;
  float cap = min(min(float(u - cu * g.x) + fu, float((cu + 1) * g.x - u) - fu) * inv,
                  min(float(y - cy * PITCH_Y) + f.y, float((cy + 1) * PITCH_Y - y) - f.y));
  int K = WKA[j].x * R, a = WKA[j].y;
  int back = fdiv(K, a) - g.z, outer = -fdiv(-K, a) + int(ceil(len));
  gRay = false;
  float gw = 1e9;
  for (int pass = 0; pass < 2; pass++) {
    airPiece();
    airPlane((float(u0 - u) - fu) * inv, -vec3(WT[j]) * inv);
    airPlane((float(u - u1) + fu) * inv, vec3(WT[j]) * inv);
    airPlane((float(back - w) - fw) * inv, -vec3(WH[j]) * inv);
    airPlane((float(w - outer) + fw) * inv, vec3(WH[j]) * inv);
    airSpan(L.y, f.y, max(y0 + ${GROUND * R} - base.y, 0), min(y1 + ${GROUND * R} - base.y, R), EY);
    airSpan(L.x, f.x, 0, R, EX);
    airSpan(L.z, f.z, 0, R, EZ);
    if (pass == 0) {
      gw = gD;
      if (!ray || gw + gO > 0.0) break;
      gRay = true;
    } else {
      gRay = false;
      if (gX > reach) { reach = gX; nrm = gN; }
    }
  }
  return min(min(d, gw), max(cap, 0.0));
}

// A level-(CITY + 1) cell the table says something of: deep in the
// building, the halls (d, reach and nrm being what they say of it), cut off
// at its sides across which they may not run on; in its skin, pockets and no
// rooms (they are the city's surface, coloured as the city: gSkin); solid
// otherwise. Its air is never further off than its sides (the next cell's
// may be just across them).
float reliefCell(ivec3 L, vec3 f, ivec3 id, uint seed, uvec2 m, float d, inout float reach, inout vec3 nrm) {
  uint kind = m.x & 3u;
  bool ray = gRay;
  if (kind == ${DEEP}u) {
    uint open = (m.x >> uint(OPEN_AT)) & 63u;
    if (open == 63u) return d;
    gRay = false;
    for (int pass = 0; pass < 2; pass++) {
      airPiece();
      if ((open & 1u) == 0u) airPlane(float(L.x - R) + f.x, EX);
      if ((open & 2u) == 0u) airPlane(-float(L.x) - f.x, -EX);
      if ((open & 4u) == 0u) airPlane(float(L.y - R) + f.y, EY);
      if ((open & 8u) == 0u) airPlane(-float(L.y) - f.y, -EY);
      if ((open & 16u) == 0u) airPlane(float(L.z - R) + f.z, EZ);
      if ((open & 32u) == 0u) airPlane(-float(L.z) - f.z, -EZ);
      if (pass == 0) {
        // (Cut off at those sides; and the next cell's air, a skin's
        // pockets, may be just across them.)
        d = max(d, gD);
        if (d > 0.0) d = min(d, max(-gD, 0.0));
        if (!ray || reach < 0.0) break;
        gRay = true;
      } else if (gX < reach) { reach = gX; nrm = gN; }
    }
    gRay = ray;
    return d;
  }
  float e = min(min(min(float(R - L.x) - f.x, float(L.x) + f.x), min(float(R - L.y) - f.y, float(L.y) + f.y)),
                min(float(R - L.z) - f.z, float(L.z) + f.z));
  reach = -1.0;
  nrm = vec3(0.0);
  if (kind == ${PLAIN}u) {
    int j = int((m.x >> uint(WIN_AT)) & 31u) - 1;
    if (j < 0) {
      gSkin = false;
      return max(e, 0.0);
    }
    float a = windowAir(j, L, f, 1e9, ray, reach, nrm);
    gRay = ray;
    gSkin = ray ? reach >= 0.0 : a < 0.0;
    return min(a, max(e, 0.0));
  }
  // (Its pockets: see cell.)
  gCarve = 1;
  gCarveFaces = (m.x >> uint(FACE_AT)) & 63u;
  gCarveOpen = (m.x >> uint(OPEN_AT)) & 63u;
  gCarveCross = ((m.x >> uint(CROSS_AT)) & 1u) != 0u;
  gCarveBase = gCellB * R;
  gCarveE = e;
  return 1e9;
}

// The light well, if any, that the hall below opens up through the plaza:
// halls' own opening through its ceiling, as that hall has it (the two must
// agree), carried on up to the plaza.
float well(ivec3 L, vec3 f, ivec3 id, uint seed) {
  ivec3 below = wrapId(id - ivec3(0, 1, 0));
  uint h = hashCell(below, seed ^ 0x967a889bu);
  float t = h01(h);
  if (t < 0.66 || !(built(below, seed) || built(id, seed))) return 1e9;
  ivec3 o = fromMiddle(id) / R;
  for (int k = 0; k < NBUILT; k++) if (BUILT_CELLS[k] == o.xz) return 1e9;
  bool oculus = t < 0.88;
  int w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
  airPiece();
  airSpan(L.y, f.y, -M, G + 1, EY);
  airSpan(L.x - C, f.x, -w, w, EX);
  airSpan(L.z - C, f.z, -w, w, EZ);
  for (int j = 0; j < 4; j++) {
    int sx = (j & 1) == 1 ? 1 : -1, sz = (j & 2) == 2 ? 1 : -1;
    airPlane(diag(2, sx, sz, C, C, dg) * 0.70710678, vec3(float(sx), 0.0, float(sz)) * 0.70710678);
  }
  return gD;
}

${SOLIDS.map(solidGlsl).join('\n')}
float solid(int k, ivec3 L, vec3 f, ivec3 o) {
  switch (k) {
${SOLIDS.map((_, j) => `    case ${j}: return solid${j}(L, f, o);`).join('\n')}
  }
  return 1e9;
}

// The air over the plaza, less the building: the distance to the nearest
// solid (and, for a ray, where it strikes one, if before it leaves this
// piece of air). The piece runs a cell past this one's sides each way (so
// that it does not seem to close in at every one; narrower, rays far off
// crossed so many pieces that they ran out of steps), and the solids asked
// about are all that reach into it (see NEAR).
float plaza(ivec3 L, vec3 f, ivec3 id) {
  airPiece();
  airSpan(L.x, f.x, -R, 2 * R, EX);
  airSpan(L.z, f.z, -R, 2 * R, EZ);
  // (From the floor, in the bottom row; higher up, from a little below the
  // cell, into the air of the one under it.)
  airSpan(L.y, f.y, id.y == ${ROW_ID} ? G : -M, R + M, EY);
  float box = gD, d = 1e9;
  vec3 q = vec3(L) + f;
  ivec3 o = fromMiddle(id);
  int n = -1;
  for (int j = 0; j < NNEAR; j++) if (NEAR_CELLS[j] == o / R) n = j;
  if (n < 0) return box;
  for (int j = NEAR_START[n]; j < NEAR_START[n + 1]; j++) {
    int k = NEAR_BLOCKS[j];
    // (A solid further off than one already found, or than a ray goes in
    // this piece, is not asked about.)
    vec3 off = max(vec3(SLO[k] - o) - q, q - vec3(SHI[k] - o));
    float far = max(max(off.x, off.y), off.z);
    if (far >= d && (!gRay || far >= gX)) continue;
    d = min(d, solid(k, L, f, o));
  }
  return max(box, -d);
}

// A cell of the city.
float city(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {
  reach = -1.0;
  nrm = vec3(0.0);
  bool ray = gRay;
  gRay = false;
  float w = id.y == ${ROW_ID} ? well(L, f, id, seed) : 1e9;
  float p = plaza(L, f, id);
  if (ray && p + gO <= 0.0) {
    gRay = true;
    plaza(L, f, id);
    gRay = false;
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  if (ray && w + gO <= 0.0) {
    gRay = true;
    well(L, f, id, seed);
    gRay = false;
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  gRay = ray;
  // (Its pockets and notches: see cell.)
  gCarve = 0;
  gCarveFaces = cityFaces(L, f, fromMiddle(id));
  gCarveBase = fromMiddle(id) - ORIGIN;
  return min(min(p, w), gFar);
}

float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {
  if (level < ${CITY}) {
    reach = -1.0;
    nrm = vec3(0.0);
    return 1e9;
  }
  gCarve = -1;
  float d = 1e9;
  if (level == ${CITY} && id.y >= ${ROW_ID} && id.y < ${ROW_ID + ROWS}) d = city(L, f, id, seed, reach, nrm);
  else {
    // Over the city there is only sky, and the city's air comes right up to
    // the cells above it: all a cell up there can say is how far down it is.
    if (level == ${CITY} && id.y >= ${ROW_ID + ROWS} && id.y <= ${ROW_ID + ABOVE}) {
      reach = -1.0;
      nrm = vec3(0.0);
      return float(L.y + R * (id.y - ${ROW_ID + ROWS})) + f.y;
    }
    // (The halls asked after in one place only: the compiler copies them out
    // wherever they are asked after, and they are much the biggest part. Not
    // at all in the skin and plain cells, which have none.)
    uvec2 m = level == ${CITY + 1} ? relief(id, gUp) : uvec2(0u);
    uint kind = m.x & 3u;
    reach = -1.0;
    nrm = vec3(0.0);
    if (m == uvec2(0u) || kind == ${DEEP}u) d = hallsCell(L, f, id, seed, reach, nrm);
    if (m != uvec2(0u)) d = reliefCell(L, f, id, seed, m, d, reach, nrm);
  }
  // (The buildings' relief, asked after in one place only, as the halls are.)
  if (gCarve >= 0) {
    bool ray = gRay;
    float a = carve(gCarve, L, f, gCarveBase, gCarveFaces, 1e9, ray, reach, nrm);
    gRay = ray;
    if (gCarve == 0) d = min(d, a);
    else {
      gSkin = ray ? reach >= 0.0 : a < 0.0;
      d = min(a, max(gCarveE, 0.0));
    }
  }
  return d;
}
`;

// The same, in JavaScript, piece for piece (as in halls.js: a plane is only
// its distance).
const h01 = (h) => (h >>> 8) / 16777216;
let dLp, dFp, dLm, dFm, dLs, dFs;
const diag = (p, sa, sb, ca, cb, k) =>
  sa === sb ? sa * (dLp[p] - ca - cb) - k + sa * dFp[p] : sa * (dLm[p] - ca + cb) - k + sa * dFm[p];
let gD;
const piece = () => (gD = -Infinity);
const plane = (s) => (gD = Math.max(gD, s));
const span = (x, f, x0, x1) => (plane(x0 - x - f), plane(x - x1 + f));
const NONE = 1e9;
const fdiv = (a, b) => Math.floor(a / b);
const cdiv = (a, b) => Math.ceil(a / b);
const beyond = (x, f, c) => x > c || (x === c && f >= 0);

const fromMiddle = (id) => [(id[0] - MID) * R, (id[1] - ROW_ID) * R, (id[2] - MID) * R];

// The point along the slants (from dg, or else from L and f), and along the
// diagonals.
function setPoint(L, f, dg) {
  if (dg) ({ Lp: dLp, fp: dFp, Lm: dLm, fm: dFm } = dg);
  else {
    const pairs = [[0, 1], [2, 1], [0, 2]];
    dLp = pairs.map(([a, b]) => L[a] + L[b]);
    dFp = pairs.map(([a, b]) => f[a] + f[b]);
    dLm = pairs.map(([a, b]) => L[a] - L[b]);
    dFm = pairs.map(([a, b]) => f[a] - f[b]);
  }
  if (dg?.Ls) (dLs = dg.Ls), (dFs = dg.fs);
  else {
    // (Split again, as levelRay does: a whole number and the rest, at most a half.)
    dFs = SLANTS.map((m) => m[0] * f[0] + m[1] * f[1] + m[2] * f[2]);
    dLs = SLANTS.map((m, k) => m[0] * L[0] + m[1] * L[1] + m[2] * L[2] + Math.round(dFs[k]));
    dFs = dFs.map((x) => x - Math.round(x));
  }
}

function well(L, f, id, seed) {
  const below = wrapId([id[0], id[1] - 1, id[2]]);
  const t = h01(hashCell(below, seed ^ 0x967a889b));
  if (t < 0.66 || !(built(below, seed) || built(id, seed))) return NONE;
  if (BUILT.has(`${id[0] - MID},${id[2] - MID}`)) return NONE;
  const oculus = t < 0.88;
  const w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
  piece();
  span(L[1], f[1], -M, G + 1);
  span(L[0] - C, f[0], -w, w);
  span(L[2] - C, f[2], -w, w);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plane(diag(2, sx, sz, C, C, dg) * Math.SQRT1_2);
  return gD;
}

// One solid, o the cell's corner from the middle cell's (see solidGlsl).
function solid(s, L, f, o) {
  piece();
  for (const p of planesOf(s)) {
    if (p.dir < 3) {
      const a = p.dir;
      plane((p.scale * L[a] - (p.K - p.scale * o[a]) + p.scale * f[a]) / p.len);
    } else {
      const m = p.m, k = p.K - p.scale * (m[0] * o[0] + m[1] * o[1] + m[2] * o[2]);
      plane((p.scale * dLs[p.dir - 3] - k + p.scale * dFs[p.dir - 3]) / p.len);
    }
  }
  return gD;
}

function plaza(L, f, id) {
  piece();
  span(L[0], f[0], -R, 2 * R);
  span(L[2], f[2], -R, 2 * R);
  span(L[1], f[1], id[1] === ROW_ID ? G : -M, R + M);
  const box = gD;
  const o = fromMiddle(id);
  let d = NONE;
  for (const k of NEAR.get(o.map((x) => x / R).join()) ?? []) d = Math.min(d, solid(SOLIDS[k], L, f, o));
  return Math.max(box, -d);
}

let cellB = [0, 0, 0];
// The sides a skin cell's pockets run on across, whether as three pieces,
// and which of them is being asked about (see runOn).
let cellOpen = 0, cellCross = false, axis = -1;
const runsOn = (a, side) => cellOpen & (side << (2 * a)) && (axis < 0 || axis === a);
const openLo = (a) => (runsOn(a, 2) ? -R : 0), openHi = (a) => (runsOn(a, 1) ? 2 * R : R);
// The least of piece(), called once for each of the pieces (one level finer:
// three where the cell's pockets run on as three).
function eachPiece(lv, piece) {
  if (lv !== 1 || !cellCross) return (axis = -1), piece();
  let d = NONE;
  for (axis = 0; axis < 3; axis++) d = Math.min(d, piece());
  axis = -1;
  return d;
}
function relief(id, up) {
  if (!up || up[1] < ROW_ID || up[1] >= ROW_ID + ROWS) return [0, 0];
  const o = fromMiddle(up), v = [0, 1, 2].map((a) => o[a] + (((id[a] % R) + R) % R) - VOLUME.lo[a]);
  if (v.some((x, a) => x < 0 || x >= VOLUME.size[a])) return [0, 0];
  cellB = v.map((x, a) => x + VOLUME.lo[a] - ORIGIN[a]);
  const i = 2 * (v[0] + VOLUME.size[0] * (v[1] + VOLUME.size[1] * v[2]));
  return [VOLUME.data[i], VOLUME.data[i + 1]];
}

// See rectangle in the shader.
export function rectangle(lv, k, u, fu, y, fy, tile = 0) {
  const P = LEVELS[lv], q = FACES[k].q2[lv], n = P.sb / P.quant, su = n * q;
  const salt = (Math.imul(lv, 0x5bd1e995) ^ tile) >>> 0;
  const row = fdiv(y - (fy < 0 ? 1 : 0), P.sby);
  // (One level finer, tiled afresh in each city rectangle: no shift, so that the tiles align with its edges.)
  const shift = lv ? 0 : q * (hashCell([row, k, lv], (ROW_SALT ^ salt) >>> 0) % n);
  const col = fdiv(u - (fu < 0 ? 1 : 0) - shift, su);
  let u0 = col * su + shift, u1 = u0 + su, y0 = row * P.sby, y1 = y0 + P.sby;
  let h = hashCell([col, row, k], (POCKET_SALT ^ salt) >>> 0);
  for (let i = 0; i < P.splits; i++) {
    // Across the longer side more likely than the shorter (in proportion),
    // and never leaving a part under min quanta: no thin slices.
    const nu = (u1 - u0) / q, ny = (y1 - y0) / P.quant, m = P.min;
    const cu = nu >= 2 * m, cy = ny >= 2 * m;
    if (cu || cy) {
      const alongU = cu && (!cy || (h & 0xff) * (nu + ny) < 256 * nu);
      const s = m + ((h >>> 8) % ((alongU ? nu : ny) - 2 * m + 1));
      if (alongU) {
        if (beyond(u, fu, u0 + s * q)) u0 += s * q;
        else u1 = u0 + s * q;
      } else if (beyond(y, fy, y0 + s * P.quant)) y0 += s * P.quant;
      else y1 = y0 + s * P.quant;
    }
    h = hashCell([u0, y0, Math.imul(u1, 4099) + y1], (POCKET_SALT ^ salt ^ k) >>> 0);
  }
  const t = h01(hashCell([u0, y0, k], (DEPTH_SALT ^ salt) >>> 0));
  let j = 0;
  for (let i = 0; i < ND - 1; i++) if (t >= (P.cumulative[i] ?? 2)) j = i + 1;
  return { u0, u1, y0, y1, depth: j };
}

// The rows of ridge r's notches at level lv (y in its units, from origin):
// super-rows of sb, split at whole quanta; each with its depth and its arms'
// reach (at least the depth, at most the level's deepest).
function notchRow(lv, r, y, fy, origin, salt) {
  const N = NOTCH[lv], P = LEVELS[lv], yr = y - origin;
  const row = fdiv(yr - (fy < 0 ? 1 : 0), N.sb);
  let y0 = row * N.sb, y1 = y0 + N.sb;
  let h = hashCell([row, r, lv], (NOTCH_SALT ^ salt) >>> 0);
  for (let i = 0; i < N.splits; i++) {
    // (No row under min quanta, as for the pockets.)
    const ny = (y1 - y0) / N.quant;
    if (ny >= 2 * N.min) {
      const k = N.min + ((h >>> 8) % (ny - 2 * N.min + 1));
      if (beyond(yr, fy, y0 + k * N.quant)) y0 += k * N.quant;
      else y1 = y0 + k * N.quant;
    }
    h = hashCell([y0, y1, r], (NOTCH_SALT ^ salt ^ lv) >>> 0);
  }
  const t = h01(hashCell([y0, r, lv], (DEPTH_SALT ^ NOTCH_SALT ^ salt) >>> 0));
  let j = 0;
  for (let i = 0; i < ND - 1; i++) if (t >= (N.cum[i] ?? 2)) j = i + 1;
  const d = P.depths[j] ?? 0, top = P.depths.at(-1);
  const steps = Math.floor((top - d) / N.arm + 1e-6), hh = h >>> 8;
  const k = hh < N.armLong ? steps : Math.floor(((hh - N.armLong) * (steps + 1)) / (16777216 - N.armLong));
  const A = d + Math.min(steps, k) * N.arm;
  return { y0: y0 + origin, y1: y1 + origin, d, A };
}

// Whether face F's pocket over [u0, u1] x [y0, y1] (level lv's measure and
// units) keeps Z clear of the mass's other faces all the way down (at its
// mouth is enough: along the draft they only recede): if not, it is narrowed
// along u (in whole quanta q from u0) until it does, or dropped (null) if
// that would leave it under the level's least. Their depths along the face
// are affine (see F.aff).
function allowed(F, lv, u0, u1, y0, y1, q) {
  const sc = lv ? R : 1;
  let lo = u0, hi = u1;
  for (const a of F.aff)
    for (const y of [y0, y1]) {
      // (At the pocket's mouth: along the draft the other faces only recede.)
      const rest = a.c0 + (a.cy * y) / sc;
      if (a.cu > 1e-9) lo = Math.max(lo, ((F.Z - rest) * sc) / a.cu);
      else if (a.cu < -1e-9) hi = Math.min(hi, ((F.Z - rest) * sc) / a.cu);
      else if (rest < F.Z) return null;
    }
  lo = u0 + Math.ceil((lo - u0) / q - 1e-6) * q;
  hi = u0 + Math.floor((hi - u0) / q + 1e-6) * q;
  return hi - lo >= LEVELS[lv].min * q ? [lo, hi] : null;
}

// Where the point is on face F at level lv (base its cell's corner from the
// building's origin, in this level's units): along (u, fu), up by its
// projection's height (y, fy, whole units and the rest, at least 0; and
// Y, the same times p, as a whole number and the rest), and how deep (n . X,
// as a whole number and the rest).
function faceAt(F, lv, base) {
  const S = lv ? R : 1;
  const u = F.t.sign * dLs[F.t.k] + F.tv[0] * base[0] + F.tv[2] * base[2], fu = F.t.sign * dFs[F.t.k];
  const ms = SLANTS[F.ms.k], mn = SLANTS[F.plane.k];
  const Yi = F.gm * (F.ms.sign * dLs[F.ms.k] + F.ms.sign * (ms[0] * base[0] + ms[1] * base[1] + ms[2] * base[2])) + F.yk * F.K * S;
  const Yf = F.gm * F.ms.sign * dFs[F.ms.k];
  const y = fdiv(Yi + Math.floor(Yf), F.p), fy = (Yi - y * F.p + Yf) / F.p;
  const ni = F.plane.sign * (dLs[F.plane.k] + mn[0] * base[0] + mn[1] * base[1] + mn[2] * base[2]), nf = F.plane.sign * dFs[F.plane.k];
  return { u, fu, y, fy, Yi, Yf, ni, nf, S };
}

// The air of a pocket of face F (p from faceAt) over [u0, u1] x [y0, y1],
// D cells deep, to a unit past the face, within true heights lo to hi
// (level units) and, one level finer, within the cell or a cell past each
// side in cellOpen (see runOn).
function pocketAir(F, lv, p, L, f, u0, u1, y0, y1, ci, fi, lo, hi) {
  const Dn = F.dn[lv][ci * NDQ + fi], Y = p.Yi + p.Yf, ys = F.gm * F.mlen;
  return eachPiece(lv, () => {
    piece();
    plane((u0 - p.u - p.fu) / F.len);
    plane((p.u - u1 + p.fu) / F.len);
    plane((y0 * F.p - Y) / ys);
    plane((Y - y1 * F.p) / ys);
    plane((F.K * p.S - Dn - p.ni - p.nf) / F.nl);
    plane((p.ni + p.nf - F.K * p.S - Math.ceil(F.nl)) / F.nl);
    span(L[1], f[1], lv === 1 ? Math.max(lo, openLo(1)) : lo, lv === 1 ? Math.min(hi, openHi(1)) : hi);
    if (lv === 1) span(L[0], f[0], openLo(0), openHi(0)), span(L[2], f[2], openLo(2), openHi(2));
    return gD;
  });
}

// Face k's pockets where the point is, at level lv, united with d; and
// where it is in none, how far off its rectangle's edges are at least.
function facePocket(lv, k, L, f, base, d) {
  const F = FACES[k], p = faceAt(F, lv, base), S = p.S;
  // The city's rectangle (from one level finer: the point's place in the city's measure).
  const uc = lv ? fdiv(p.u + (p.fu < 0 ? -1 : 0), R) : p.u, fuc = lv ? (p.u - R * uc + p.fu) / R : p.fu;
  const yc = lv ? fdiv(p.y, R) : p.y, fyc = lv ? (p.y - R * yc + p.fy) / R : p.fy;
  const c = rectangle(0, k, uc, fuc, yc, fyc);
  let Dc = LEVELS[0].depths[c.depth] ?? 0;
  // (Heights at each level's own scale: the city's rectangle is in cells.)
  const inCut = (y0, y1, s) => y0 >= F.cutLo * s - 1e-9 && y1 <= F.cutHi * s + 1e-9;
  // (The city's pocket, narrowed or dropped: [a0, a1] in the city's measure.)
  let span0 = null;
  if (Dc > 0 && inCut(c.y0, c.y1, 1) && !rectBare(F, c.u0, c.u1, c.y0, c.y1)) span0 = allowed(F, 0, c.u0, c.u1, c.y0, c.y1, F.q2[0]);
  const lo = (F.lo4 * S) / 4 - base[1], hi = (F.hi4 * S) / 4 - base[1];
  let cap;
  if (!lv) {
    cap = Math.min(Math.min(p.u - c.u0 + p.fu, c.u1 - p.u - p.fu) / F.len, (p.Yi + p.Yf - c.y0 * F.p) / (F.gm * F.mlen), (c.y1 * F.p - p.Yi - p.Yf) / (F.gm * F.mlen));
    if (span0) d = Math.min(d, pocketAir(F, 0, p, L, f, span0[0], span0[1], c.y0, c.y1, quarters(Dc), 0, lo, hi));
    return Math.min(d, Math.max(cap, 0));
  }
  // One level finer: tiled afresh from the city rectangle's corner.
  const inC = span0 && uc >= span0[0] && uc < span0[1];
  if (!inC) Dc = 0;
  const ou = R * c.u0, oy = R * c.y0, salt = hashCell([c.u0, c.y0, k], TILE_SALT) >>> 0;
  const r = rectangle(1, k, p.u - ou, p.fu, p.y - oy, p.fy, salt);
  const u0 = r.u0 + ou, u1 = r.u1 + ou, y0 = r.y0 + oy, y1 = r.y1 + oy;
  const ys = F.gm * F.mlen, Y = p.Yi + p.Yf;
  cap = Math.min(Math.min(p.u - u0 + p.fu, u1 - p.u - p.fu) / F.len, (Y - y0 * F.p) / ys, (y1 * F.p - Y) / ys);
  const Df = LEVELS[1].depths[r.depth] ?? 0;
  if (Df > 0) {
    // (Within the city's pocket or out of it: the tiles align with its edges.)
    let a0 = u0, a1 = u1;
    if (span0) {
      if (inC) (a0 = Math.max(a0, R * span0[0])), (a1 = Math.min(a1, R * span0[1]));
      else if (p.u + p.fu < R * span0[0]) a1 = Math.min(a1, R * span0[0]);
      else a0 = Math.max(a0, R * span0[1]);
    }
    // (No bare test one level finer: its pockets are only in skin cells, which nothing bare touches, and run on only where the cells agree.)
    const ok = a0 < a1 && inCut(y0, y1, S) ? allowed(F, 1, a0, a1, y0, y1, F.q2[1]) : null;
    if (ok) d = Math.min(d, pocketAir(F, 1, p, L, f, ok[0], ok[1], y0, y1, quarters(Dc), twelfths(Df / R), lo, hi));
  }
  return Math.min(d, Math.max(cap, 0));
}

// Ridge i's notches where the point is, at level lv, united with d (and
// where it is in none, how far off its row's ends are).
function notch(lv, i, L, f, base, d) {
  const rg = RIDGES[i], { F, G } = rg, S = lv ? R : 1;
  const y = base[1] + L[1], fy = f[1];
  const yc = lv ? fdiv(y + (fy < 0 ? -1 : 0), R) : y, fyc = lv ? (y - R * yc + fy) / R : fy;
  const c = notchRow(0, i, yc, fyc, 0, 0);
  // (Heights at each level's own scale: the city's rows are in cells.)
  const inCut = (y0, y1, s) => y0 >= F.cutLo * s - 1e-9 && y1 <= F.cutHi * s + 1e-9;
  const cityOk = c.d > 0 && inCut(c.y0, c.y1, 1) && !rowBare(rg, c.y0, c.y1);
  let r = c, dd = cityOk ? [quarters(c.d), 0] : [0, 0], A = cityOk ? [quarters(c.A), 0] : [0, 0];
  if (lv) {
    r = notchRow(1, i, y, fy, R * c.y0, hashCell([c.y0, i, 1], TILE_SALT) >>> 0);
    if (r.d > 0 && inCut(r.y0, r.y1, S)) (dd[1] = r.d / 2), (A[1] = r.A / 2);
  }
  const cap = Math.min(y - r.y0 + fy, r.y1 - y - fy);
  if (dd[0] + dd[1] > 0) {
    const lo = Math.max(r.y0, (F.lo4 * S) / 4) - base[1], hi = Math.min(r.y1, (F.hi4 * S) / 4) - base[1];
    const pF = faceAt(F, lv, base), pG = faceAt(G, lv, base);
    const side = (P, p, x) => (P.K * S - P.dn[lv][x[0] * NDQ + x[1]] - p.ni - p.nf) / P.nl;
    const out = (P, p) => (p.ni + p.nf - P.K * S - Math.ceil(P.nl)) / P.nl;
    for (const [P, p, Q, q] of [[F, pF, G, pG], [G, pG, F, pF]])
      d = Math.min(d, eachPiece(lv, () => {
        piece();
        plane(side(P, p, dd));
        plane(side(Q, q, A));
        plane(out(P, p));
        plane(out(Q, q));
        span(L[1], f[1], lv ? Math.max(lo, openLo(1)) : lo, lv ? Math.min(hi, openHi(1)) : hi);
        if (lv) span(L[0], f[0], openLo(0), openHi(0)), span(L[2], f[2], openLo(2), openHi(2));
        return gD;
      }));
  }
  return Math.min(d, Math.max(cap, 0));
}

function pockets(L, f, faces, d) {
  const base = cellB.map((x) => x * R);
  FACES.forEach((F, k) => {
    if (faces & (1 << k)) d = facePocket(1, k, L, f, base, d);
  });
  RIDGES.forEach((r, i) => {
    if (faces & (1 << r.a) && faces & (1 << r.b)) d = notch(1, i, L, f, base, d);
  });
  return d;
}

// The city's own pockets and notches near the point (o its cell's corner
// from the middle cell's): of each face it is near, from a cell past it to
// DMAX in; elsewhere, at least that far off.
function cityPockets(L, f, o) {
  const base = o.map((x, a) => x - ORIGIN[a]);
  let d = NONE, near = 0;
  const q = [0, 1, 2].map((a) => base[a] + L[a] + f[a]);
  FACES.forEach((F, k) => {
    const away = Math.max(...[0, 1, 2].map((a) => Math.max(F.solid.lo[a] - ORIGIN[a] - 2 - q[a], q[a] - (F.solid.hi[a] - ORIGIN[a]) - 2)));
    if (away > 0) return void (d = Math.min(d, away));
    const m = SLANTS[F.plane.k], sg = F.plane.sign;
    const s = (sg * dLs[F.plane.k] + sg * (m[0] * base[0] + m[1] * base[1] + m[2] * base[2]) - F.K + sg * dFs[F.plane.k]) / F.nl;
    if (s < -BAND_IN) d = Math.min(d, -s - BAND_IN);
    else if (s > BAND_OUT) d = Math.min(d, s - BAND_OUT);
    else (near |= 1 << k), (d = facePocket(0, k, L, f, base, d));
  });
  RIDGES.forEach((r, i) => {
    if (near & (1 << r.a) && near & (1 << r.b)) d = notch(0, i, L, f, base, d);
  });
  return d;
}

// See windowAir in the shader.
function windowAir(j, L, f, d) {
  const W = WINDOWS[j], base = cellB.map((x) => x * R);
  const u = W.t.sign * dLs[W.t.k] + W.tv[0] * base[0] + W.tv[2] * base[2], fu = W.t.sign * dFs[W.t.k];
  const w = W.h.sign * dLs[W.h.k] + W.hv[0] * base[0] + W.hv[2] * base[2], fw = W.h.sign * dFs[W.h.k];
  const y = base[1] + L[1] - GROUND * R;
  const pu = Math.round(PITCH[0] * W.len), wu = Math.round(WIN[0] * W.len), dw = Math.round(DEEP_WIN * W.len);
  const cu = fdiv(u - (fu < 0 ? 1 : 0), pu), cy = fdiv(y - (f[1] < 0 ? 1 : 0), PITCH[1]);
  const u0 = cu * pu + Math.trunc((pu - wu) / 2), u1 = u0 + wu, y0 = cy * PITCH[1] + Math.trunc((PITCH[1] - WIN[1]) / 2), y1 = y0 + WIN[1];
  const cap = Math.min(Math.min(u - cu * pu + fu, (cu + 1) * pu - u - fu) / W.len, y - cy * PITCH[1] + f[1], (cy + 1) * PITCH[1] - y - f[1]);
  const K = W.K * R, back = fdiv(K, W.alpha) - dw, outer = cdiv(K, W.alpha) + Math.ceil(W.len);
  piece();
  plane((u0 - u - fu) / W.len);
  plane((u - u1 + fu) / W.len);
  plane((back - w - fw) / W.len);
  plane((w - outer + fw) / W.len);
  span(L[1], f[1], Math.max(y0 + GROUND * R - base[1], 0), Math.min(y1 + GROUND * R - base[1], R));
  span(L[0], f[0], 0, R);
  span(L[2], f[2], 0, R);
  return Math.min(d, gD, Math.max(cap, 0));
}

function reliefCell(L, f, id, seed, [m], d) {
  const kind = m & 3;
  if (kind === DEEP) {
    const open = (m >>> OPEN_AT) & 63;
    if (open === 63) return d;
    piece();
    if (!(open & 1)) plane(L[0] - R + f[0]);
    if (!(open & 2)) plane(-L[0] - f[0]);
    if (!(open & 4)) plane(L[1] - R + f[1]);
    if (!(open & 8)) plane(-L[1] - f[1]);
    if (!(open & 16)) plane(L[2] - R + f[2]);
    if (!(open & 32)) plane(-L[2] - f[2]);
    d = Math.max(d, gD);
    return d > 0 ? Math.min(d, Math.max(-gD, 0)) : d;
  }
  const e = Math.min(R - L[0] - f[0], L[0] + f[0], R - L[1] - f[1], L[1] + f[1], R - L[2] - f[2], L[2] + f[2]);
  if (kind === PLAIN) {
    const j = ((m >>> WIN_AT) & 31) - 1;
    return j < 0 ? Math.max(e, 0) : Math.min(windowAir(j, L, f, NONE), Math.max(e, 0));
  }
  cellOpen = (m >>> OPEN_AT) & 63;
  cellCross = !!((m >>> CROSS_AT) & 1);
  return Math.min(pockets(L, f, (m >>> FACE_AT) & 63, NONE), Math.max(e, 0));
}

function cellAir(L, f, id, seed, dg, level, up) {
  if (level < CITY) return NONE;
  if (level === CITY + 1) {
    const m = relief(id, up);
    if (m[0] || m[1]) {
      const d = hallsAir(L, f, id, seed, dg);
      setPoint(L, f, dg);
      return reliefCell(L, f, id, seed, m, d);
    }
  }
  if (level === CITY && id[1] >= ROW_ID + ROWS && id[1] <= ROW_ID + ABOVE) return L[1] + R * (id[1] - ROW_ID - ROWS) + f[1];
  if (level !== CITY || id[1] < ROW_ID || id[1] >= ROW_ID + ROWS) return hallsAir(L, f, id, seed, dg);
  setPoint(L, f, dg);
  return Math.min(plaza(L, f, id), id[1] === ROW_ID ? well(L, f, id, seed) : NONE, cityPockets(L, f, fromMiddle(id)));
}

// Where a first visit starts, in the middle city cell (lattice units): on
// the plaza, near the building, wherever nothing stands.
const START = (() => {
  const free = (x, z) => SOLIDS.every((s) => [G, G + 1, G + 2].every((y) => cellOut(s, [x, y, z])));
  for (let r = 0; r < R; r++)
    for (let x = C - r; x <= C + r; x++)
      for (const z of [C - r, C + r]) {
        if (x < 0 || z < 0 || x >= R || z >= R) continue;
        if (free(x, z) && free(x - 1, z) && free(x + 1, z) && free(x, z - 1) && free(x, z + 1)) return [x, z];
      }
  return [C, C];
})();

const arcology = {
  ...halls,
  name: 'arcology',
  glsl: hallsGlsl + glsl,
  cellAir,
  volume: VOLUME,
  // The building's planes' normals, carried exactly across levels (see
  // Position.levels): the city's level asks after them for its solids, the
  // next for its pockets.
  slants: SLANTS,
  // A plaza's air reaches up out of its cell, and its longest way runs
  // corner to corner across the cells either side.
  maxInterior: 0.65,
  longestWay: 6,

  // On the plaza, in the city's row; coarser than that, all is solid, so
  // anywhere does.
  ancestorDigit(level) {
    if (level > 0) return halls.ancestorDigit(level);
    if (level === 0) return [C, 4, C];
    if (level === CITY + 1) return [START[0], G, START[1]];
    if (level === CITY) return [C, ROW, C];
    return [C, C, C];
  },
  // The sky starts at the top of the city's rows: ROWS * R cells of level
  // CITY + 1 above the bottom of the first's cell, which at the defaults is
  // G under it.
  skyPlane(j) {
    return j === CITY + 1 ? ROWS * R : j > CITY + 1 ? 0 : arcology.ancestorDigit(j)[1];
  },
  // Finer than the city, it is halls, whose ways the tour can plan (and
  // from the plaza, the ways in are ENTRANCES).
  planned: (level) => level > CITY,
  entrances: { level: CITY + 1, list: ENTRANCES },
  // Nothing stands higher than the building (in level-0 cells).
  skyClear: (ROWS * R - TOP) * Math.pow(R, -1 - CITY),
  // Sunlight comes down into it as far as the plaza (in level-0 cells).
  sunReach: (ROWS * R - G) * Math.pow(R, -1 - CITY),
};
export default arcology;
