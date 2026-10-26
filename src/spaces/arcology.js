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
// sb long in rows sby high (rows by true height), each row shifted along by
// its own whole number of quanta (so that no line runs on up the face), each
// split `splits` times at whole quanta (along it, quanta of its own measure).
// Each rectangle is cut into the face to its own depth (depths, as often as
// weights), level and square to the face. The same rule at two levels: the city's own (lengths in its lattice units,
// cells), whose boxes make the masses and the ragged silhouettes; and the
// next (in its units), smaller boxes cut into those. What keeps anything
// from being cut loose is in the setup after BARE_PL.
const LEVELS = [
  { sb: 4, sby: 2, quant: 1, splits: 3, min: 1, depths: [0, 0.25, 0.5], weights: [0.25, 0.4, 0.35] },
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
  // (The cell table compares heights with ylo and yhi themselves: see reached and deaf.)
  if (s.relief && !(Number.isInteger(s.ylo * 4) && Number.isInteger(s.yhi * 4))) throw new Error('arcology: relief heights off the quarters');
});
function dot2(v) {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}
// (A cell's table entry has a bit for each, six in all.)
if (FACES.length > 6) throw new Error(`arcology: ${FACES.length} faces with relief, at most 6`);
// How far behind a face anything is cut (cells): DMAX, along its normal (see below).
const REACH = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R + 0.05;
// Each solid's planes, n . X < K (unit n, X in cells from the building's
// origin).
const SOLID_PL = SOLIDS.map((s) => s.planes.map(({ n, K }) => [...n.map((x) => x / Math.hypot(...n)), K / Math.hypot(...n)]));
// The solids that are neither masses nor their rims (pillars, towers): the
// city's cuts stop at them (see bareIn), and the notches one level finer
// keep clear of the cells they touch (see F.bare).
const BARE = SOLIDS.filter((s) => !s.relief && !s.rim);
const BARE_PL = BARE.map((s) => SOLID_PL[SOLIDS.indexOf(s)]);
// (And their bounds, cells from the building's origin: a first, cheap test.)
const BARE_BOX = BARE.map((s) => [s.lo.map((x, a) => x - ORIGIN[a]), s.hi.map((x, a) => x - ORIGIN[a])]);
if (BARE_PL.some((p) => p.length !== 6)) throw new Error('arcology: a solid without relief not of six planes');
// (Beyond this from all of them (cells: more than the diagonal of a city
// pocket's box, 5.7), a ray through the city's pockets cannot strike one:
// see cell() in the shader.)
const BARE_NEAR = 6;
if (BARE_NEAR < Math.hypot(LEVELS[0].sb, LEVELS[0].sby, 1 + REACH)) throw new Error('arcology: BARE_NEAR under a city pocket');
// How deep anything is cut at most (cells): both levels' deepest.
const DMAX = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R;
// How far in from a face, and out past it, anything of the city's is cut (cells).
const BAND_IN = LEVELS[0].depths.at(-1) + 0.01, BAND_OUT = 1.01;
const TILE_SALT = 0x6c8e9cf5;
// How much nearer its own face than any other a cut of a face keeps (cells).
const MARGIN = 0.1;
const solve3 = (M, b) => {
  const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det(M);
  return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((x, j) => (j === c ? b[i] : x)))) / D);
};
for (const F of FACES) {
  F.nn = dot2(F.n);
  F.nl = Math.sqrt(F.nn);
  F.q2 = [F.q[0], (F.q[0] * LEVELS[1].quant) / LEVELS[0].quant];
}
FACES.forEach((F, k) => (F.index = k));
// Relief (.claude/design/relief-v4.md, relief-v5.md): pockets are cut level
// into a face, in rows by true height, so their floors and ceilings are
// level and their side walls upright; their back walls follow the face.
// Each face is tiled at each level, all the way to its ridges and apex, and
// so is each ridge, by height. Everything is decided slice by slice: a cut t
// deep keeps W(t) (about 2t) from each ridge, so that it is in its face's
// half of the slice, nearer its own plane than any other face's by MARGIN;
// or it comes nearer a ridge, and is then no deeper than the ridge's own
// row there, whose pair of notches (one into each face) it joins. Then
// every cut of a slice meets its edge in one connected stretch, so what is
// left of the slice is in one piece and holds its middle, and the middles
// of all the slices are a straight line (the axis): nothing is cut loose.
for (const F of FACES) {
  const mass = FACES.filter((G) => G.solid === F.solid);
  F.near = mass.filter((G) => G !== F);
  // (Rows by true height: a point's height on the face is its own.)
  F.mv = [0, 1, 0];
  F.gm = 1;
  F.ms = slantOf(F.mv);
  F.mlen = 1;
  F.p = 1;
  F.yk = 0;
  // In, level and square to the face, DELTA cells deeper.
  const hh = F.n[0] * F.n[0] + F.n[2] * F.n[2], v = [(-F.n[0] * F.nl) / hh, 0, (-F.n[2] * F.nl) / hh];
  // The point on the face at (u, y) (city measure, cells), and DELTA cells in.
  const M = [F.n, F.tv, [0, 1, 0]];
  F.at = (u, y, delta) => solve3(M, [F.K, u, y]).map((x, a) => x + delta * v[a]);
  // Its ridges with the mass's other faces, each as where it crosses height
  // y in F's measure, u = (al y + be) / dl, in whole numbers (at a level S
  // times finer: (al y + S be) / dl), and how far from it a cut t deep keeps
  // (W(t), below).
  F.edges = F.near.map((G) => {
    const n = F.n, g = G.n, t = F.tv;
    const dl = n[0] * g[2] - n[2] * g[0];
    const al = t[0] * (n[2] * g[1] - n[1] * g[2]) + t[2] * (g[0] * n[1] - n[0] * g[1]);
    const be = t[0] * (F.K * g[2] - n[2] * G.K) + t[2] * (n[0] * G.K - g[0] * F.K);
    // (Going in, G comes nearer by fall per unit; along the face, it is
    // per u nearer per unit of F's measure.)
    const dG = (X) => (G.K - dot(G.n, X)) / G.nl, fall = dot(G.n, v) / G.nl;
    const per = Math.abs(dG(F.at(1, 20, 0)) - dG(F.at(0, 20, 0)));
    // (W(t) at each level, in its u-units, t twelfths: going t in at a
    // pocket's near edge leaves it MARGIN nearer F than G.)
    const Wt = [1, R].map((S) => Array.from({ length: 17 }, (_, t) => Math.ceil((((t / 12) * (1 + fall) + MARGIN) * S) / per) + 1));
    // (The plane of a notch's edge, W in from the ridge and along it: its
    // gradient in u-units per lattice unit, gl, and its unit normal into
    // the face, gn (both with sg, below).)
    const gv = [t[0], -al / dl, t[2]];
    return { G, dl, al, be, Wt, W: Wt[0][16], sg: 0, gl: Math.hypot(...gv), gv };
  });
  // (Which way from each ridge the face lies.)
  const ym = (F.solid.ylo + F.solid.yhi) / 2, uAt = (E) => (E.al * ym + E.be) / E.dl;
  F.edges[0].sg = Math.sign(uAt(F.edges[1]) - uAt(F.edges[0]));
  F.edges[1].sg = -F.edges[0].sg;
  for (const E of F.edges) E.gn = E.gv.map((x) => (E.sg * x) / E.gl);
  // The inradius of the mass's level slice at height y (cells): how deep its
  // middle is behind each face (relief-v4.md: never cut).
  const [G, H] = F.near, un = (X) => X.n.map((x) => x / X.nl);
  const inr = (y) => {
    const X = solve3([un(F).map((x, a) => x - un(G)[a]), un(F).map((x, a) => x - un(H)[a]), [0, 1, 0]], [F.K / F.nl - G.K / G.nl, F.K / F.nl - H.K / H.nl, y]);
    return (F.K - dot(F.n, X)) / F.nl;
  };
  F.inr = (y) => Math.max(0, inr(y));
  // (The zone tests' whole numbers, one level finer, stay well within 32
  // bits wherever they are asked: within two cells of the mass's box, and a
  // super-block further along.)
  const lo = F.solid.lo.map((x, a) => x - ORIGIN[a] - 2), hi = F.solid.hi.map((x, a) => x - ORIGIN[a] + 2);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, 1, 2].map((a) => ((i >> a) & 1 ? hi[a] : lo[a])));
  const um = Math.max(...corners.map((X) => Math.abs(dot(F.tv, X)))) + (LEVELS[0].sb / LEVELS[0].quant) * F.q2[0];
  const yb = Math.max(...corners.map((X) => Math.abs(X[1])));
  for (const E of F.edges)
    if (R * (Math.abs(E.al) * yb + Math.abs(E.be) + (E.W + um) * Math.abs(E.dl)) >= 2 ** 30) throw new Error('arcology: zone tests overflow');
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
  r.at = (y) => solve3([r.F.n, r.G.n, [0, 1, 0]], [r.F.K, r.G.K, y]);
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
// The notches one level finer keep clear of the cells that the solids
// without relief (pillars, towers) touch (they are cut in skin cells only,
// which such solids never touch): for each face, the rectangles of it (u in
// its city measure, y in cells, rounded out) over which a notch could meet
// one (see r.barep). (The city's cuts stop at such solids instead: see
// bareIn.)
for (const F of FACES) {
  F.bare = [];
  // (Only the part of each cell that a notch could reach: from a cell out
  // to DMAX in, at the heights cuts are made; sampled every quarter cell,
  // and rounded out by more than that.)
  const Q = 0.25;
  for (const sol of BARE) {
    // (Row by row of height, so that a solid crossing the face at a slant
    // blanks its own footprint and not the rectangle round it.)
    const rows = new Map();
    for (let cx = sol.lo[0]; cx < sol.hi[0]; cx++)
      for (let cy = Math.max(sol.lo[1], Math.floor(F.solid.ylo + ORIGIN[1]) - 1); cy < Math.min(sol.hi[1], Math.ceil(F.solid.yhi + ORIGIN[1]) + 1); cy++)
        for (let cz = sol.lo[2]; cz < sol.hi[2]; cz++) {
          const c = [cx, cy, cz];
          if (cellOut(sol, c)) continue;
          const m = (F.K - dot(F.n, c.map((x, a) => x + 0.5 - ORIGIN[a]))) / F.nl;
          if (m < -2 || m > DMAX + 2) continue;
          for (let x = 0; x <= 1 + 1e-9; x += Q) for (let y = 0; y <= 1 + 1e-9; y += Q) for (let z = 0; z <= 1 + 1e-9; z += Q) {
          const X = [c[0] + x - ORIGIN[0], c[1] + y - ORIGIN[1], c[2] + z - ORIGIN[2]], depth = (F.K - dot(F.n, X)) / F.nl;
          if (depth < -1 - Q || depth > DMAX + Q) continue;
          const u = dot(F.tv, X), yp = (F.gm * dot(F.mv, X) + F.yk * F.K) / F.p;
          for (let r = Math.floor(yp - Q); r <= Math.floor(yp + Q); r++) {
            const o = rows.get(r) ?? [Infinity, -Infinity];
            rows.set(r, [Math.min(o[0], u), Math.max(o[1], u)]);
          }
          }
        }
    for (const [r, [u0, u1]] of [...rows].sort((p, q) => p[0] - q[0])) {
      if (r + 1 <= F.solid.ylo || r >= F.solid.yhi) continue;
      const lo = Math.floor(u0 - Q * F.len), hi = Math.ceil(u1 + Q * F.len), last = F.bare.at(-1);
      if (last && last[3] === r && last[0] === lo && last[1] === hi) last[3] = r + 1;
      else F.bare.push([lo, hi, r, r + 1]);
    }
  }
}
const zone = (E, u, y, S) => E.sg * Math.sign(E.dl) * (u * E.dl - E.al * y - S * E.be); // (distance past the ridge, times |dl|)
const rectBare = (F, u0, u1, y0, y1) => F.bare.some(([a, b, c, d]) => u0 < b && u1 > a && y0 < d && y1 > c);
const fdiv = (a, b) => Math.floor(a / b);
const cdiv = (a, b) => Math.ceil(a / b);
const h01 = (h) => (h >>> 8) / 16777216;
// The ridges are tiled too, by height only (relief-v5.md, v6): rows of the
// city's (its rows of two cells, some halved) and, one level finer, rows
// within each cell (split as the faces' rectangles are, at whole quanta and
// never under the least). Each row draws a depth as a face's rectangle does,
// the same for both faces (it is the ridge's), one level finer on top of the
// city's row it is in; and is shallower, or not cut, until a pair of
// notches that deep fits: one into each face, from past the ridge to W(t)
// in from it (an edge that follows the ridge), leaving W(t) to each face's
// other ridge, no deeper than the slice allows (CAP), and, one level finer,
// clear of the solids without relief (BAREP). A face's rectangle near a
// ridge is cut no deeper than the ridge's rows beside it (see rectDepth).
const RIDGE_SALT = 0x2b7e1516;
// (Segments' hash: see OPENINGS.)
const SEGMENT_SALT = 0x3c6ef372;
// (How deep a ridge's rows may be drawn at each level, as an index into its
// depths; and in how many quarters of the city's rows they are halved.)
const RIDGE_JMAX = [1, 2], RIDGE_HALVES = 4;
RIDGES.forEach((r, i) => (r.index = i));
for (const F of FACES) F.er = F.edges.map((E) => RIDGES.find((r) => (r.F === F && r.G === E.G) || (r.G === F && r.F === E.G)).index);
// (A depth drawn as the rectangles' are, by a hash: its index in P.depths.)
const drawJ = (lv, h) => {
  const t = h01(h), P = LEVELS[lv];
  let j = 0;
  for (let i = 0; i < ND - 1; i++) if (t >= (P.cumulative[i] ?? 2)) j = i + 1;
  return j;
};
// The deepest cut (twelfths, 0 to 16) the slice of a face's mass allows at
// each height, by twelfths of a cell from F.c0 (its middle is never cut: at
// most half its inradius, and MARGIN short of it): F.cap; and, for a
// ridge's notch at each level, also as much as leaves the face W(t) from
// both its ridges: F.ncap[lv]. Each condition is concave or affine in the
// height, so a row's are its two ends'.
for (const F of FACES) {
  // (Over the heights of its mass, with a row each side where nothing is cut.)
  F.c0 = Math.floor(12 * F.solid.ylo) - 1;
  const n = Math.ceil(12 * F.solid.yhi) + 2 - F.c0;
  const room = (y) => (y < F.solid.ylo - 1e-9 || y > F.solid.yhi + 1e-9 ? 0 : Math.min(F.inr(y) / 2, F.inr(y) - MARGIN));
  const width = (y, S) => Math.abs((F.edges[0].al * y * S + S * F.edges[0].be) / F.edges[0].dl - (F.edges[1].al * y * S + S * F.edges[1].be) / F.edges[1].dl);
  const most = (ok) => { let t = 16; while (t > 0 && !ok(t)) t--; return t; };
  F.cap = Array.from({ length: n }, (_, i) => most((t) => t / 12 <= room((i + F.c0) / 12) + 1e-12));
  F.ncap = [1, R].map((S, lv) => Array.from({ length: n }, (_, i) => most((t) => t <= F.cap[i] && width((i + F.c0) / 12, S) >= F.edges[0].Wt[lv][t] + F.edges[1].Wt[lv][t])));
}
const capIndex = (F, i) => Math.min(Math.max(i - F.c0, 0), F.cap.length - 1);
const capAt = (F, i0, i1) => Math.min(F.cap[capIndex(F, i0)], F.cap[capIndex(F, i1)]);
// (Whether F's notch at its e-th ridge, from the ridge to W(16) in, over
// cells Y0 to Y1, could meet a solid without relief: the whole box, also
// where it runs on past the ridge, to where F's out-plane or its floor
// meets G's.)
function notchBare(F, e, Y0, Y1) {
  const E = F.edges[e], G = E.G, t = 16;
  const at = [Y0, Y1].map((y) => (E.al * y + E.be) / E.dl + E.sg * E.Wt[0][t]);
  const past = [Y0, Y1].flatMap((y) => [Math.ceil(F.nl), (-t / 12) * F.nl].map((a) => dot(F.tv, solve3([F.n, G.n, [0, 1, 0]], [F.K + a, G.K + Math.ceil(G.nl), y]))));
  const all = [...at, ...past];
  return rectBare(F, Math.floor(Math.min(...all)), Math.ceil(Math.max(...all)), Math.floor(Y0), Math.ceil(Y1));
}
// For each ridge, how many of the twelfths of a cell below each height (from
// its faces' c0) its finer notches could meet a solid without relief in.
for (const r of RIDGES) {
  r.barep = [0];
  for (let i = 0; i < r.F.cap.length; i++) {
    const y = (i + r.F.c0) / 12, bare = [r.F, r.G].some((X) => notchBare(X, X.er.indexOf(r.index), y, y + 1 / 12));
    r.barep.push(r.barep[i] + (bare ? 1 : 0));
  }
}
const bareAt = (r, i) => r.barep[Math.min(Math.max(i - r.F.c0, 0), r.barep.length - 1)];
const bareRows = (r, i0, i1) => bareAt(r, i1) - bareAt(r, i0);
// Whether a pair t deep fits at ridge r over heights i0 to i1 (twelfths of a cell), at level lv.
const pairFits = (r, lv, i0, i1, t) => [r.F, r.G].every((X) => t <= Math.min(X.ncap[lv][capIndex(X, i0)], X.ncap[lv][capIndex(X, i1)])) && (lv === 0 || bareRows(r, i0, i1) === 0);
// The row of ridge r at level lv that height y (whole level units, at least
// the point's) is in: { y0, y1 } in level units, t its depth (twelfths, the
// city's row's included one level finer) and tc the city's row's.
function ridgeRow(r, lv, y) {
  if (lv === 0) {
    const sby = LEVELS[0].sby, sr = fdiv(y, sby), half = hashCell([sr, r.index, 0], RIDGE_SALT >>> 0) % 4 < RIDGE_HALVES;
    const a = half && y >= sr * sby + sby / 2 ? sr * sby + sby / 2 : sr * sby, b = half ? a + sby / 2 : a + sby;
    let t = 0;
    for (let j = Math.min(RIDGE_JMAX[0], drawJ(0, hashCell([a, r.index, 1], RIDGE_SALT >>> 0))); j > 0; j--) {
      const tt = 3 * quarters(LEVELS[0].depths[j]);
      if (pairFits(r, 0, 12 * a, 12 * b, tt)) { t = tt; break; }
    }
    return { y0: a, y1: b, t, tc: t, cy0: a, cy1: b };
  }
  const P = LEVELS[1], cy = fdiv(y, R), cw = ridgeRow(r, 0, cy), tc = cw.t;
  let y0 = cy * R, y1 = y0 + R, h = hashCell([cy, r.index, 2], RIDGE_SALT >>> 0);
  for (let i = 0; i < P.splits; i++) {
    const ny = (y1 - y0) / P.quant, m = P.min;
    if (ny >= 2 * m) {
      const c = y0 + P.quant * (m + ((h >>> 8) % (ny - 2 * m + 1)));
      if (y >= c) y0 = c;
      else y1 = c;
    }
    h = hashCell([y0, y1, r.index], (RIDGE_SALT ^ 1) >>> 0);
  }
  let t = tc;
  for (let j = Math.min(RIDGE_JMAX[1], drawJ(1, hashCell([y0, r.index, 3], RIDGE_SALT >>> 0))); j > 0; j--) {
    const tt = tc + twelfths(P.depths[j] / R);
    if (pairFits(r, 1, y0 / 2, y1 / 2, tt)) { t = tt; break; }
  }
  return { y0, y1, t, tc, cy0: R * cw.y0, cy1: R * cw.y1 };
}
// Whether a cut t deep over [u0, u1] x [y0, y1] (level lv's measure and
// units) comes within W(t) of F's e-th ridge at either height.
function nearRidge(F, e, lv, u0, u1, y0, y1, t) {
  const E = F.edges[e], S = lv ? R : 1, u = E.sg > 0 ? u0 : u1;
  return [y0, y1].some((y) => zone(E, u, y, S) < E.Wt[lv][t] * Math.abs(E.dl));
}
// Depth profiles (relief-v5.md, terraces.md). A cut's depth behind its face
// varies with height: a terrace's ramps up from nothing at the edge of its
// band to all of it at its wall's foot, and is nothing elsewhere in its
// rows; one level finer, a cut adds to the city's terrace under it. Near a
// ridge a cut must be, at every height, no deeper than the ridge's own cut
// there (then the two are one cut from past the ridge, inside the ridge's
// pair: the pair argument holds slice by slice). Heights here are in
// twelfths of a cell (h12), on which all rows and terraces' heights lie;
// depths in twelfths; so every test is exact.
const h12 = (lv, y) => (lv ? y / 2 : 12 * y);
// (A terrace's height for t twelfths, in twelfths: rounded down, see terrace.)
function terraceH(F, t) {
  return Math.floor((t * F.nl) / Math.abs(F.n[1]) + 1e-3);
}
// A city terrace of face F, t twelfths deep over rows a to b (h12): its band
// [lo, hi] and the height its wall stands at (anchor); null if not cut. On a
// face all terraces' ramps have one slope, so one is no deeper than another
// over a height range where both are in their bands iff its anchor is
// nearer the band's end it ramps from (the upper's: its top; the lower's:
// its bottom).
function band(F, a, b, t) {
  if (!(t > 0)) return null;
  const H = terraceH(F, t), up = F.n[1] > 0;
  return { up, lo: up ? b - H : a, hi: up ? b : a + H, at: up ? b : a };
}
const under = (c, R) => R && R.lo <= c.lo && c.hi <= R.hi && (c.up ? R.at >= c.at : R.at <= c.at);
// Whether a cut of face F at level lv over heights s to e (h12) is, at its
// e-th ridge, no deeper than the ridge's: city, its city terrace's band (or
// null); fine (one level finer), its own part, b twelfths over heights lo to hi.
function underRidge(F, e, lv, s, e2, city, fine) {
  const r = RIDGES[F.er[e]];
  for (let y = s; y < e2; ) {
    const w = ridgeRow(r, lv, lv ? 2 * y : Math.floor(y / 12)), a = Math.max(s, h12(lv, w.y0)), b = Math.min(e2, h12(lv, w.y1));
    const RB = band(F, h12(lv, w.cy0), h12(lv, w.cy1), w.tc);
    if (city) {
      const c = { ...city, lo: Math.max(a, city.lo), hi: Math.min(b, city.hi) };
      if (c.lo < c.hi && !under(c, RB)) return false;
    }
    if (fine) {
      const lo = Math.max(a, fine.lo), hi = Math.min(b, fine.hi);
      if (lo < hi) {
        // (The ridge's own part one level finer: behind its terrace's wall
        // in its band, else behind the face; as cutOf.)
        const ra = h12(lv, w.y0), rb = h12(lv, w.y1), inb = RB && (RB.up ? rb >= RB.lo : ra <= RB.hi);
        const alo = inb && RB.up ? Math.max(ra, RB.lo) : ra, ahi = inb && !RB.up ? Math.min(rb, RB.hi) : rb;
        if (!(fine.b <= w.t - w.tc && alo <= lo && hi <= ahi)) return false;
      }
    }
    y = h12(lv, w.y1);
  }
  return true;
}
// A face's rectangle at level lv (drawn depth index j; one level finer on
// the city's rectangle, rows cy0 to cy1 in cells, fl twelfths deep): the
// deepest of its level's depths, from its own down, no deeper than the
// slice allows and, at each ridge it comes within W(t) of, than the ridge's
// cut at every height (see underRidge). In twelfths: fl if none.
function rectDepth(F, lv, u0, u1, y0, y1, j, fl, cy0, cy1) {
  const P = LEVELS[lv], s = h12(lv, y0), e2 = h12(lv, y1);
  const cityB = lv ? band(F, 12 * cy0, 12 * cy1, fl) : null;
  for (let jj = j; jj > 0; jj--) {
    const t = fl + (lv ? twelfths(P.depths[jj] / R) : 3 * quarters(P.depths[jj]));
    if (t > capAt(F, s, e2)) continue;
    let city, fine = null;
    if (!lv) city = band(F, s, e2, t);
    else {
      city = cityB;
      // (Its own part: in the city terrace's band, from its floor or to its ceiling; else all its rows.)
      const inb = cityB && (cityB.up ? e2 >= cityB.lo : s <= cityB.hi);
      fine = { b: t - fl, lo: inb && cityB.up ? Math.max(s, cityB.lo) : s, hi: inb && !cityB.up ? Math.min(e2, cityB.hi) : e2 };
    }
    if ([0, 1].every((e) => !nearRidge(F, e, lv, u0, u1, y0, y1, t) || underRidge(F, e, lv, s, e2, city, fine))) return t;
  }
  return fl;
}
// (The shader takes a depth plane of 0 for no cut; the tables of W(t)
// and the caps hold t up to 16; a pair's two floors, each rounded in to its
// face's measure, differ by less than MARGIN: see relief-v4.md.)
if (3 * quarters(LEVELS[0].depths.at(-1)) + twelfths(LEVELS[1].depths.at(-1) / R) > 16) throw new Error('arcology: cuts deeper than the tables');
if (!(MARGIN > Math.max(...FACES.map((F) => 1 / F.nl)))) throw new Error('arcology: MARGIN under a face measure');
if (FACES.some((F) => [1, 2, 3].some((t) => !(F.dn[1][Math.floor(t / 3) * NDQ + (t % 3)] > 0)))) throw new Error('arcology: a cut too shallow for its face');
// (A notch's edge's normal is its value's gradient: checked numerically.)
for (const F of FACES)
  for (const E of F.edges) {
    const at = (X) => zone(E, dot(F.tv, X), X[1], 1) / (Math.abs(E.dl) * E.gl), X = [1.3, 20.7, -2.1], h = 1e-3;
    const g = [0, 1, 2].map((a) => (at(X.map((x, b) => x + (a === b ? h : 0))) - at(X)) / h);
    if (g.some((x, a) => Math.abs(x - E.gn[a]) > 1e-6)) throw new Error('arcology: a notch edge normal is not its gradient');
  }
// Openings (S6): the upright faces of the solids that have them carry
// grids of openings one level finer, in the face's own frame: each opening
// `along` wide in a pitch `pitch` (the finer units), `up` high in a pitch
// `upPitch`, `deep` into the face; and over each opening's width, all the
// way up, a channel `channel` deep (0: none). By kind, from the solid, the
// face (its plane P) and the heights the grid is for (y: a solid's windows
// is a kind, for all its height, or a list of { kind, y }, y in cells over
// the lower's apex). Each opening is in the middle of its pitch both ways,
// the grid from the building's axis and the ground; unless `centre` (a point
// the grid is centred on along the face), `from` (the height its rows start
// at, finer units over the ground) or `fade` (the size of its openings'
// features, for fading them sooner than their level: see scale); or it may
// `vary`, as segments (below).
// (Openings that open through a solid's face run 2 units past it, so that
// no other solid's openings meeting them there leave a sheet.)
// The tower: a grid of small windows (a placeholder).
// The pillars (pillars.md, after the drawing): smooth shafts at their
// corners, and on each face between them a channel (the middle half of the
// face) of shelves, their fronts at its floor, a third of a cell apart: one
// opening per face along, each the gap between two shelves, deeper.
// The plate and the roof band (fringe.md): a cornice, stepped back below in
// runs (see EDGES in hexahedron.js).
const OPENINGS = {
  windows: () => ({ pitch: 12, along: 6, upPitch: 16, up: 10, deep: 3 }),
  bays: (s, P) => {
    const { width, mid } = across(s, P);
    return { pitch: R * width, along: (R * width) / 2, upPitch: 8, up: 6, deep: 9, channel: 3, centre: mid };
  },
  // Rows of segments (the bands' edges: see EDGES in hexahedron.js): rows
  // from `from` units over the band's bottom, a pitch apart, each so high;
  // along, blocks split at up to three cuts; each segment set in by `inset`
  // at each end, at a depth between `deep`'s, or (a chance in 100) none;
  // narrower than 2 units, left out. They run on past the face's ends: round
  // a band's (convex) corners, each face's into the other's (Basil: no
  // corner posts; the profile steps).
  segments: (s, P, [y0], { rows: [from, upPitch, up], block, cut, inset, deep, none = 0 }) =>
    ({ pitch: block, along: block, upPitch, up, deep: deep[1], from: R * (y0 - GROUND) + from, vary: { kind: 'segments', cut, inset, deep, none }, fade: Math.min(up, deep[0], 4) }),
};
// (A box's width across its face P, and its middle.)
function across(s, P) {
  const up = s.planes.filter(({ n }) => n[1] === 0);
  const opp = (P) => up.find((Q) => Q.n.every((x, a) => x === -P.n[a]));
  const width = (P) => (P.K + opp(P).K) / Math.hypot(...P.n);
  const [P1, P2] = [up[0], up.find((Q) => Q.n[0] * up[0].n[0] + Q.n[2] * up[0].n[2] === 0)];
  const c1 = (P1.K - opp(P1).K) / 2, c2 = (P2.K - opp(P2).K) / 2, det = P1.n[0] * P2.n[2] - P1.n[2] * P2.n[0];
  return { width: width(up.find((Q) => Q.n[0] * P.n[0] + Q.n[2] * P.n[2] === 0)), mid: [(c1 * P2.n[2] - c2 * P1.n[2]) / det, 0, (P1.n[0] * c2 - P2.n[0] * c1) / det] };
}
// (A solid's bottom and top, from its level planes.)
function heightsOf(s) {
  const level = (sg) => s.planes.filter(({ n }) => !n[0] && !n[2] && Math.sign(n[1]) === sg).map(({ n, K }) => K / n[1]);
  return [Math.max(...level(-1)), Math.min(...level(1))];
}
const WINDOWS = [], GRIDS = [], FAR = 1 << 28;
SOLIDS.forEach((s) => {
  if (!s.windows) return;
  s.wfirst = WINDOWS.length;
  const kinds = typeof s.windows === 'string' ? [{ kind: s.windows }] : s.windows;
  s.planes.forEach((P) => {
    const { n, K } = P;
    if (n[1] !== 0) return;
    const alpha = gcd(n[0], n[2]), h = [n[0] / alpha, 0, n[2] / alpha], t = [-h[2], 0, h[0]], len = Math.hypot(...h);
    const W = { n, K, alpha, h: slantOf(h), t: slantOf(t), hv: h, tv: t, len, solid: s, g0: GRIDS.length };
    for (const { kind, y, ...spec } of kinds) {
      const o = OPENINGS[kind](s, P, y ?? heightsOf(s), spec);
      // (The grid's phase: where an opening starts along the face, and where
      // a row of them starts up it; and where it may have openings, along
      // and up.)
      const pu = Math.round(o.pitch * len), wu = Math.round(o.along * len), py = o.upPitch, hy = o.up;
      const ph = (o.centre ? Math.round(R * (t[0] * o.centre[0] + t[2] * o.centre[2]) - pu / 2) : 0) + Math.trunc((pu - wu) / 2);
      const yb = o.from ?? Math.trunc((py - hy) / 2);
      const ext = [-FAR, FAR, ...(y ? y.map((v) => Math.round(R * (v - GROUND))) : [-FAR, FAR])];
      if (![pu, wu, ph, py, hy, yb, ...ext].every(Number.isInteger)) throw new Error('arcology: an opening off the finer grid');
      // (Segments: GVAR (1; their block, cut and inset) and GVB (their
      // depths, least and most; the chance in 100 of none); else 0.)
      const vk = o.vary?.kind, vd = o.vary?.deep ?? [0, 0];
      const v = vk === 'segments' ? [1, o.pitch, o.vary.cut, o.vary.inset] : [0, 0, 0, 0];
      const vb = [...vd, o.vary?.none ?? 0, 0];
      if (vk && (vd[1] > o.deep || o.pitch % o.vary.cut || o.pitch / o.vary.cut < 2 || o.vary.inset < 1 || py - hy < 2)) throw new Error('arcology: segments out of their bounds');
      // (And when it fades, if sooner than its level: openings of size
      // `fade` units fade as the level does where its cells are 4 fade wide,
      // the level's own relief being about a quarter of a cell; as a fraction
      // of a cell, 1 for as the level.)
      const scale = Math.min(1, (4 * (o.fade ?? R)) / R);
      GRIDS.push({ pu, wu, ph, py, hy, yb, ext, vary: v, varyB: vb, scale, dw: Math.round(o.deep * len), ch: Math.round((o.channel ?? 0) * len) });
    }
    W.ng = GRIDS.length - W.g0;
    W.deep = Math.max(...GRIDS.slice(W.g0).map((g) => Math.max(g.dw, g.ch)));
    WINDOWS.push(W);
  });
  if (WINDOWS.length - s.wfirst > 4) throw new Error('arcology: a solid with more than four faces with openings');
});
// Whether the slab of face W's openings, from their back (the deeper of
// gap and channel) to their outer plane as windowAir has them, meets the
// cell whose corner is c, and its solid touches it. (Outside their solid
// they make no air that isn't air already, or are stopped: see CLIP.)
const slabMeets = (W, c) => {
  if (cellOut(W.solid, c)) return false;
  const K = W.K * R, ws = corners(c).map((q) => (R * W.n.reduce((a, x, i) => a + x * (q[i] - ORIGIN[i]), 0)) / W.alpha);
  return Math.min(...ws) < cdiv(K, W.alpha) + Math.ceil(W.len) && Math.max(...ws) > fdiv(K, W.alpha) - W.deep;
};

// The table, one cell of level CITY + 1 to an entry (see volume in
// halls.js): in its first number, the cell's kind (KIND bits: 1 deep, its
// rooms the halls'; 2 skin, pockets and no rooms; 3 plain, solid), the faces
// whose pockets reach into it (FACE_AT, a bit each), and for a deep cell,
// for each of its six sides (+x, -x, +y, -y, +z, -z), whether its rooms'
// openings may run on across it (OPEN_AT: the next cell is deep too, or
// clear of every solid); for a skin cell, whether its pockets one level
// finer may, and whether they run on as one box or three (CROSS_AT, in the
// second number: see runOn below). In the second number too, the solids
// touching it or the cells its openings run on into, that they stop at
// (CLIP: one more than each's index in SOLIDS, in SOLID_BITS each). In the
// third, the openings it cuts (a skin or plain cell), of up to three solids
// (WIN_AT, in WIN_BITS each: one more than the solid's index in SOLIDS, 0
// for none; and a bit for each of its faces with openings, from its first,
// wfirst). In the fourth, how its openings run on (OPEN_AT and CROSS_AT, as
// for its pockets in the first and second).
const WORDS = 4, DEEP = 1, SKIN = 2, PLAIN = 3, FACE_AT = 2, OPEN_AT = 8, SOLID_BITS = 5, WIN_AT = [0, 9, 18], WIN_BITS = 9;
const CLIP_MOST = 6, CROSS_AT = SOLID_BITS * CLIP_MOST;
if (SOLIDS.length >= 1 << SOLID_BITS) throw new Error(`arcology: ${SOLIDS.length} solids, at most ${(1 << SOLID_BITS) - 1}`);
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// (For the checks in .claude/verify.)
export const _V2 = { FACES, RIDGES, DMAX, WINDOWS, ORIGIN, SOLID_PL, BITS: { WORDS, OPEN_AT, WIN_AT, WIN_BITS, SOLID_BITS, CROSS_AT } };
export const VOLUME = (() => {
  const lo = [0, 1, 2].map((a) => Math.min(...SOLIDS.map((s) => s.lo[a])) - 2);
  const hi = [0, 1, 2].map((a) => Math.max(...SOLIDS.map((s) => s.hi[a])) + 2);
  lo[1] = Math.max(lo[1], G);
  const size = hi.map((h, a) => h - lo[a]);
  const n = size[0] * size[1] * size[2];
  const at = ([x, y, z]) => x + size[0] * (y + size[1] * z);
  const within = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
  const kind = new Uint8Array(n), open = new Uint8Array(n), faces = new Uint8Array(n), win = WIN_AT.map(() => new Uint16Array(n));
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
    // Skin where pockets reach and only masses, their rims and solids out of
    // the pockets' heights touch it (a post's top that is the plate's: see
    // heights); deep where it is wholly inside some solid (whatever else
    // crosses it) and no pocket reaches; plain otherwise.
    // (ylo and yhi are on the quarters the pockets are cut to: see LEVELS' lo4.)
    const reached = (s) => FACES.some((F, i) => f & (1 << i) && heightsOf(s)[0] < F.solid.yhi && heightsOf(s)[1] > F.solid.ylo);
    if (f && touched.every((s) => s.relief || s.rim || !reached(s))) (kind[v] = SKIN), (faces[v] = f);
    else kind[v] = !f && touched.some((s) => cellIn(s, c)) ? DEEP : PLAIN;
    // A skin or plain cell has the openings of each face of each solid with
    // them that touches it whose slab (from behind the face as deep as they
    // go to past it as far as they reach: see windowAir) meets the cell,
    // stopped at the other solids (see CLIP below).
    if (kind[v] === SKIN || kind[v] === PLAIN) {
      const ws = touched.filter((s) => s.windows);
      if (ws.length > WIN_AT.length) throw new Error(`arcology: ${ws.length} solids with openings touch the cell ${c}`);
      ws.forEach((s, k) => {
        let mask = 0;
        WINDOWS.forEach((W, j) => W.solid === s && slabMeets(W, c) && (mask |= 1 << (j - s.wfirst)));
        if (mask) win[k][v] = (SOLIDS.indexOf(s) + 1) | (mask << SOLID_BITS);
      });
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
      if (c[1] - ORIGIN[1] >= F.solid.yhi || c[1] + 1 - ORIGIN[1] <= F.solid.ylo) return; // (pockets are cut at those heights only)
      const ds = corners(c).map((q) => (F.K - (F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]))) / F.nl);
      if (Math.min(...ds) < REACH && Math.max(...ds) > -lip) deaf[v] |= 1 << i;
    });
  }
  // (The steps along each axis to the cells in the box of the open sides.)
  const boxOf = (open) => [0, 1, 2].map((a) => [0, ...(open & (1 << (2 * a)) ? [1] : []), ...(open & (2 << (2 * a)) ? [-1] : [])]);
  // (The sides open where the cell u next to [x, y, z] across them is
  // ok(u), and whether as one box or three.)
  const runOn = (x, y, z, ok) => {
    const okAt = (dx, dy, dz) => ok([x + dx, y + dy, z + dz]);
    let open = 0;
    SIDES.forEach((e, k) => okAt(...e) && (open |= 1 << k));
    const ax = boxOf(open);
    const box = ax[0].every((dx) => ax[1].every((dy) => ax[2].every((dz) => okAt(dx, dy, dz))));
    return [open, !box];
  };
  const skinOk = (f) => (u) => !within(u) || !(deaf[at(u)] & f);
  // A cell's openings run on likewise, unless the next cell is one their
  // slab meets and that does not cut them (off the solid's other faces, say,
  // or under the table's floor, the plaza's ground: there the openings stop
  // at the cell's side). In a skin cell, where both its pockets and its
  // openings may.
  const winsOf = (v) => win.flatMap((w) => [0, 1, 2, 3].filter((k) => (w[v] >> SOLID_BITS) & (1 << k)).map((k) => SOLIDS[(w[v] & ((1 << SOLID_BITS) - 1)) - 1].wfirst + k));
  const plainOk = (ws) => (u) => {
    if (within(u) && open[at(u)]) return true;
    const cuts = within(u) ? winsOf(at(u)) : [], c = u.map((q, a) => q + lo[a]);
    return ws.every((j) => cuts.includes(j) || !slabMeets(WINDOWS[j], c));
  };
  // CLIP: the solids that touch the cell or any cell its openings run on
  // into (the box of its open sides). Each solid's openings stop at the
  // others: at the masses outside it (inside it they cut through: a pillar's
  // channels run on where the lower's slope passes through it), at the rest
  // everywhere (so the roof band runs across a pillar whole). Within any
  // cell their stopping is the same whichever cell asks (a solid that does
  // not touch a cell has nothing in it).
  const clipOf = (x, y, z, open) => {
    const out = [], ax = boxOf(open);
    for (const dx of ax[0]) for (const dy of ax[1]) for (const dz of ax[2]) {
      const c = [x + dx + lo[0], y + dy + lo[1], z + dz + lo[2]];
      SOLIDS.forEach((s, i) => !out.includes(i + 1) && !cellOut(s, c) && out.push(i + 1));
    }
    if (out.length > CLIP_MOST) throw new Error(`arcology: ${out.length} solids to stop openings at, at ${[x, y, z]}`);
    return out.reduce((w, i, k) => w | (i << (SOLID_BITS * k)), 0);
  };
  const data = new Uint32Array(WORDS * n);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = at([x, y, z]);
    if (!kind[v]) continue;
    let word = kind[v] | (faces[v] << FACE_AT);
    if (kind[v] === DEEP)
      SIDES.forEach((e, k) => {
        const u = [x + e[0], y + e[1], z + e[2]];
        if (!within(u) || open[at(u)] || kind[at(u)] === DEEP) word |= 1 << (OPEN_AT + k);
      });
    if (kind[v] === SKIN) {
      const [open, cross] = runOn(x, y, z, skinOk(faces[v]));
      word |= open << OPEN_AT;
      data[WORDS * v + 1] = cross ? 1 << CROSS_AT : 0;
    }
    const ws = winsOf(v);
    if (ws.length) {
      const [open, cross] = runOn(x, y, z, plainOk(ws));
      data[WORDS * v + 1] |= clipOf(x, y, z, open);
      data[WORDS * v + 3] = (open << OPEN_AT) | (cross ? 1 << CROSS_AT : 0);
    }
    data[WORDS * v] = word;
    data[WORDS * v + 2] = win.reduce((w, x, k) => w | (x[v] << WIN_AT[k]), 0);
  }
  return { lo, size, data, words: WORDS, kind, open, at, within };
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
const int NF = ${FACES.length};
// Each face (see FACES and the setup after BARE_PL): n's slant (index, sign),
// K, alpha; its rows' K term (F.yk); nn; its unit normal; its h and t as
// slants (index, sign); its quanta along (q2, a level each) and lo, hi (4 y);
// t; its length; its rows' m's slant (index, sign), gm and p (see faceAt);
// |n| and gm |m|; and the heights it may be cut between (cells).
const ivec4 FPLANE[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.plane.k}, ${F.plane.sign}, ${F.K}, ${F.alpha})`).join(', ')});
const int FNY[NF] = int[NF](${FACES.map((F) => F.yk).join(', ')});
const int FNN[NF] = int[NF](${FACES.map((F) => F.nn).join(', ')});
const vec3 FN[NF] = vec3[NF](${FACES.map((F) => `vec3(${F.n.map((x) => glf(x / F.nl)).join(', ')})`).join(', ')});
const ivec4 FHT[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.h.k}, ${F.h.sign}, ${F.t.k}, ${F.t.sign})`).join(', ')});
const ivec4 FQY[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.q2[0]}, ${F.q2[1]}, ${F.lo4}, ${F.hi4})`).join(', ')});
const ivec3 FT[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.tv))});
const float FLEN[NF] = float[NF](${FACES.map((F) => glf(F.len)).join(', ')});
const ivec4 FSL[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.ms.k}, ${F.ms.sign}, ${F.gm}, ${F.p})`).join(', ')});
// Each face's normal's upright part and the length of its level part (raw: see terrace in the JS).
const vec2 FNH[NF] = vec2[NF](${FACES.map((F) => `vec2(${glf(F.n[1])}, ${glf(Math.hypot(F.n[0], F.n[2]))})`).join(', ')});
const vec2 FNS[NF] = vec2[NF](${FACES.map((F) => `vec2(${glf(F.nl)}, ${glf(F.gm * F.mlen)})`).join(', ')});
// Each face's two ridges (see F.edges): dl, al, be, and sg (as sg W(DMAX)); and the other face's index.
const ivec4 FEDGE[NF * 2] = ivec4[NF * 2](${FACES.flatMap((F) => F.edges.map((E) => `ivec4(${E.dl}, ${E.al}, ${E.be}, ${E.sg * E.W})`)).join(', ')});
const int FEG[NF * 2] = int[NF * 2](${FACES.flatMap((F) => F.edges.map((E) => FACES.indexOf(E.G))).join(', ')});
// W(t) at each ridge of each face (see F.edges), at each level, t twelfths, 0 to 16.
const int FWT[NF * 68] = int[NF * 68](${FACES.flatMap((F) => F.edges.flatMap((E) => E.Wt.flat())).join(', ')});
// Each face's ridges: which (see RIDGES), and the plane of a notch's edge
// there (see F.edges: gl, and gn, its unit normal into the face).
const int NRID = ${RIDGES.length};
const int FER[NF * 2] = int[NF * 2](${FACES.flatMap((F) => F.er).join(', ')});
const float EGL[NF * 2] = float[NF * 2](${FACES.flatMap((F) => F.edges.map((E) => glf(E.gl))).join(', ')});
const vec3 EGN[NF * 2] = vec3[NF * 2](${FACES.flatMap((F) => F.edges.map((E) => `vec3(${E.gn.map(glf).join(', ')})`)).join(', ')});
// Each ridge's two faces. Each face's caps (see F.cap, F.ncap: cap, and
// each level's ncap, five bits each), from F.c0, and where they are (offset,
// c0, how many); and each ridge's bare rows (see r.barep), likewise.
const ivec2 RFACE[NRID] = ivec2[NRID](${RIDGES.map((r) => `ivec2(${r.F.index}, ${r.G.index})`).join(', ')});
${(() => {
  const caps = [], fr = [], bare = [], br = [];
  for (const F of FACES) {
    fr.push(`ivec3(${caps.length}, ${F.c0}, ${F.cap.length})`);
    F.cap.forEach((c, i) => caps.push(c | (F.ncap[0][i] << 5) | (F.ncap[1][i] << 10)));
  }
  for (const r of RIDGES) {
    br.push(`ivec3(${bare.length}, ${r.F.c0}, ${r.barep.length})`);
    bare.push(...r.barep);
  }
  return `const int FCAPS[${caps.length}] = int[${caps.length}](${caps.join(', ')});
const ivec3 FCR[NF] = ivec3[NF](${fr.join(', ')});
const int BAREP[${bare.length}] = int[${bare.length}](${bare.join(', ')});
const ivec3 RBR[NRID] = ivec3[NRID](${br.join(', ')});`;
})()}
const uint RIDGE_SALT = ${RIDGE_SALT}u;
const int RIDGE_JMAX[2] = int[2](${RIDGE_JMAX.join(', ')}), RIDGE_HALVES = ${RIDGE_HALVES};
const int FOUR = ${FOUR.k};
// Each level's depths (its own units).
const float DEPTHS[2 * ND] = float[2 * ND](${LEVELS.flatMap((l) => [...l.depths, ...Array(ND - l.depths.length).fill(0)]).map(glf).join(', ')});
const uint TILE_SALT = ${TILE_SALT}u;
const float DMAX = ${glf(DMAX)}, BAND_IN = ${glf(BAND_IN)}, BAND_OUT = ${glf(BAND_OUT)};
// The faces with openings (see WINDOWS): h and t as slants (index, sign); K,
// alpha (w = h . Y < K R / alpha inside); len; and their grids (WGR: the
// first, how many).
const int NW = ${Math.max(WINDOWS.length, 1)};
const ivec4 WHT[NW] = ivec4[NW](${(WINDOWS.length ? WINDOWS : [{ h: { k: 0, sign: 1 }, t: { k: 0, sign: 1 } }]).map((W) => `ivec4(${W.h.k}, ${W.h.sign}, ${W.t.k}, ${W.t.sign})`).join(', ')});
const ivec2 WKA[NW] = ivec2[NW](${(WINDOWS.length ? WINDOWS : [{ K: 0, alpha: 1 }]).map((W) => `ivec2(${W.K}, ${W.alpha})`).join(', ')});
const ivec3 WH[NW] = ivec3[NW](${ivecs((WINDOWS.length ? WINDOWS : [{ hv: [1, 0, 0] }]).map((W) => W.hv))});
const ivec3 WT[NW] = ivec3[NW](${ivecs((WINDOWS.length ? WINDOWS : [{ tv: [0, 0, 1] }]).map((W) => W.tv))});
const float WLEN[NW] = float[NW](${(WINDOWS.length ? WINDOWS : [{ len: 1 }]).map((W) => glf(W.len)).join(', ')});
const ivec2 WGR[NW] = ivec2[NW](${(WINDOWS.length ? WINDOWS : [{ g0: 0, ng: 0 }]).map((W) => `ivec2(${W.g0}, ${W.ng})`).join(', ')});
// Each grid (see GRIDS): pitch and width along (in u), the openings' depth
// and the channel's (in w); where an opening starts along, the pitch up, its
// height and where a row starts (GUP); and where openings may be, along and
// up (GEXT).
const int NG = ${Math.max(GRIDS.length, 1)};
const ivec4 GGRID[NG] = ivec4[NG](${(GRIDS.length ? GRIDS : [{ pu: 1, wu: 1, dw: 1, ch: 0 }]).map((g) => `ivec4(${g.pu}, ${g.wu}, ${g.dw}, ${g.ch})`).join(', ')});
const ivec4 GUP[NG] = ivec4[NG](${(GRIDS.length ? GRIDS : [{ ph: 0, py: 1, hy: 1, yb: 0 }]).map((g) => `ivec4(${g.ph}, ${g.py}, ${g.hy}, ${g.yb})`).join(', ')});
const ivec4 GEXT[NG] = ivec4[NG](${(GRIDS.length ? GRIDS : [{ ext: [0, 0, 0, 0] }]).map((g) => `ivec4(${g.ext.join(', ')})`).join(', ')});
// (And how it varies, and the sizes it fades at: see GRIDS.)
const ivec4 GVAR[NG] = ivec4[NG](${(GRIDS.length ? GRIDS : [{ vary: [0, 0, 0, 0] }]).map((g) => `ivec4(${g.vary.join(', ')})`).join(', ')});
const ivec4 GVB[NG] = ivec4[NG](${(GRIDS.length ? GRIDS : [{ varyB: [0, 0, 0, 0] }]).map((g) => `ivec4(${g.varyB.join(', ')})`).join(', ')});
const float GSCALE[NG] = float[NG](${(GRIDS.length ? GRIDS : [{ scale: 1 }]).map((g) => glf(g.scale)).join(', ')});
const uint SEGMENT_SALT = ${SEGMENT_SALT}u;
const int WIN_BITS = ${WIN_BITS};
// Each face's mass's bounds, from the building's origin, in cells.
const ivec3 FLO[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.solid.lo.map((x, a) => x - ORIGIN[a])))});
const ivec3 FHI[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.solid.hi.map((x, a) => x - ORIGIN[a])))});
const int NBARE = ${BARE_PL.length};
const ivec3 BARE_LO[NBARE] = ivec3[NBARE](${ivecs(BARE_BOX.map((b) => b[0]))});
const ivec3 BARE_HI[NBARE] = ivec3[NBARE](${ivecs(BARE_BOX.map((b) => b[1]))});
const vec4 BARE_PL[NBARE * 6] = vec4[NBARE * 6](${BARE_PL.flat().map((p) => `vec4(${p.map(glf).join(', ')})`).join(', ')});
// Every solid's planes (SOLID_PL in the JS), and where each one's are (first, how many).
const vec4 SOLID_PL[${SOLID_PL.flat().length}] = vec4[${SOLID_PL.flat().length}](${SOLID_PL.flat().map((p) => `vec4(${p.map(glf).join(', ')})`).join(', ')});
const ivec2 SOLID_AT[${SOLIDS.length}] = ivec2[${SOLIDS.length}](${SOLID_PL.map((pl, i) => `ivec2(${SOLID_PL.slice(0, i).flat().length}, ${pl.length})`).join(', ')});
const int SOLID_BITS = ${SOLID_BITS};
// Whether openings cut through each solid inside their own (the masses), or
// stop at it everywhere (the rest).
const bool SOLID_MASS[${SOLIDS.length}] = bool[${SOLIDS.length}](${SOLIDS.map((s) => !!s.relief).join(', ')});
// Each solid's first face with openings (its index in WINDOWS).
const int WFIRST[${SOLIDS.length}] = int[${SOLIDS.length}](${SOLIDS.map((s) => s.wfirst ?? 0).join(', ')});
// How far outside solid i the point q is (cells from the building's origin;
// inside, less than 0): the most of its planes'.
float solidOut(int i, vec3 q) {
  float s = -1e9;
  for (int k = SOLID_AT[i].x; k < SOLID_AT[i].x + SOLID_AT[i].y; k++) s = max(s, dot(SOLID_PL[k].xyz, q) - SOLID_PL[k].w);
  return s;
}

// Where the middle city cell is from this one, in lattice units.
ivec3 fromMiddle(ivec3 id) {
  return (id - ivec3(${MID}, ${ROW_ID}, ${MID})) * R;
}

// What the table says of the level-(CITY + 1) cell id, in a city cell
// (whose id is up): nothing, if it is not in the table. gCellB is set to the
// cell's corner from the building's origin, in cells.
ivec3 gCellB;
uvec4 relief(ivec3 id, ivec3 up) {
  if (up.y < ${ROW_ID} || up.y >= ${ROW_ID + ROWS}) return uvec4(0u);
  ivec3 own = id - R * ivec3(floor((vec3(id) + 0.5) / float(R)));
  ivec3 v = fromMiddle(up) + own - VOL_LO;
  if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) return uvec4(0u);
  gCellB = v + VOL_LO - ORIGIN;
  return texelFetch(uVolume, v, 0);
}

int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); } // floor, b > 0
int cdiv(int a, int b) { return -fdiv(-a, b); } // ceiling, b > 0

// The rectangle of face k at level lv that the point is in (u along the
// face, in its own measure, y its true height, each a whole
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

// How far inside the solids without relief (pillars, towers) the point q
// is (cells from the building's origin; outside, less than 0): the city's
// pockets stop at their faces.
// (Only within r of one's bounds: elsewhere, less than -r at least.)
bool bareNear(vec3 q, float r) {
  for (int i = 0; i < NBARE; i++) {
    vec3 o = max(vec3(BARE_LO[i]) - q, q - vec3(BARE_HI[i]));
    if (max(max(o.x, o.y), o.z) < r) return true;
  }
  return false;
}
float bareIn(vec3 q) {
  float d = -1e9;
  for (int i = 0; i < NBARE; i++) {
    float s = -1e9;
    for (int j = 0; j < 6; j++) s = max(s, dot(BARE_PL[i * 6 + j].xyz, q) - BARE_PL[i * 6 + j].w);
    d = max(d, -s);
  }
  return d;
}
// See capAt, pairFits, ridgeRow and nearRidge in the JS.
// (Face k's caps at height i, twelfths of a cell: cap, then each level's ncap, 5 bits each.)
int capsAt(int k, int i) { ivec3 c = FCR[k]; return FCAPS[c.x + clamp(i - c.y, 0, c.z - 1)]; }
int capAt(int k, int i0, int i1) { return min(capsAt(k, i0) & 31, capsAt(k, i1) & 31); }
int ncapAt(int k, int lv, int i) { return (capsAt(k, i) >> (5 + 5 * lv)) & 31; }
int barePrefix(int r, int i) { ivec3 c = RBR[r]; return BAREP[c.x + clamp(i - c.y, 0, c.z - 1)]; }
bool pairFits(int r, int lv, int i0, int i1, int t) {
  ivec2 fc = RFACE[r];
  return t <= min(min(ncapAt(fc.x, lv, i0), ncapAt(fc.x, lv, i1)), min(ncapAt(fc.y, lv, i0), ncapAt(fc.y, lv, i1)))
      && (lv == 0 || barePrefix(r, i1) - barePrefix(r, i0) == 0);
}
int drawJ(int lv, uint h) {
  float t = h01(h);
  int j = 0;
  for (int i = 0; i < ND - 1; i++) if (t >= CUM[lv * ND + i]) j = i + 1;
  return j;
}
int depthOf(int lv, int j) { return lv == 0 ? 3 * int(round(DEPTHS[j] * 4.0)) : int(round(DEPTHS[ND + j] / 2.0)); }
// The city's row of ridge r at height y (cells): gRY0, gRY1, gRT (= gRTC, its city part).
int gRY0, gRY1, gRT, gRTC, gRCY0, gRCY1;
void ridgeCity(int r, int y) {
  int sby = LV[0].y, sr = fdiv(y, sby);
  bool halves = int(hashCell(ivec3(sr, r, 0), RIDGE_SALT) % 4u) < RIDGE_HALVES;
  int a = halves && y >= sr * sby + sby / 2 ? sr * sby + sby / 2 : sr * sby, b = halves ? a + sby / 2 : a + sby;
  int t = 0, j = min(RIDGE_JMAX[0], drawJ(0, hashCell(ivec3(a, r, 1), RIDGE_SALT)));
  for (int jj = ND - 1; jj > 0; jj--) {
    if (jj > j) continue;
    int tt = depthOf(0, jj);
    if (pairFits(r, 0, 12 * a, 12 * b, tt)) { t = tt; break; }
  }
  gRY0 = a; gRY1 = b; gRT = t; gRTC = t;
}
void ridgeRow(int r, int lv, int y) {
  int cy = lv == 0 ? y : fdiv(y, R);
  ridgeCity(r, cy);
  gRCY0 = gRY0; gRCY1 = gRY1;
  if (lv == 0) return;
  gRCY0 = R * gRY0; gRCY1 = R * gRY1;
  int tc = gRT, y0 = cy * R, y1 = y0 + R, m = LV_MIN[1], qy = LV[1].z;
  uint h = hashCell(ivec3(cy, r, 2), RIDGE_SALT);
  for (int i = 0; i < LV[1].w; i++) {
    int ny = (y1 - y0) / qy;
    if (ny >= 2 * m) {
      int c = y0 + qy * (m + int((h >> 8) % uint(ny - 2 * m + 1)));
      if (y >= c) y0 = c; else y1 = c;
    }
    h = hashCell(ivec3(y0, y1, r), RIDGE_SALT ^ 1u);
  }
  int t = tc, j = min(RIDGE_JMAX[1], drawJ(1, hashCell(ivec3(y0, r, 3), RIDGE_SALT)));
  for (int jj = ND - 1; jj > 0; jj--) {
    if (jj > j) continue;
    int tt = tc + depthOf(1, jj);
    if (pairFits(r, 1, y0 / 2, y1 / 2, tt)) { t = tt; break; }
  }
  gRY0 = y0; gRY1 = y1; gRT = t; gRTC = tc;
}
bool nearRidge(int k, int e, int lv, int u0, int u1, int y0, int y1, int t) {
  ivec4 E = FEDGE[k * 2 + e];
  int S = lv == 0 ? 1 : R, sg = E.w > 0 ? 1 : -1, sd = E.x > 0 ? 1 : -1, u = sg > 0 ? u0 : u1;
  int W = FWT[((k * 2 + e) * 2 + lv) * 17 + t] * abs(E.x);
  return sg * sd * (u * E.x - E.y * y0 - S * E.z) < W || sg * sd * (u * E.x - E.y * y1 - S * E.z) < W;
}
// Depth profiles: see h12, terraceH, band, underRidge and rectDepth in the JS.
int h12(int lv, int y) { return lv == 0 ? 12 * y : y / 2; }
int terraceH(int k, int t) { return int(floor(float(t) * FNS[k].x / abs(FNH[k].x) + 1e-3)); }
// (A city terrace's band and anchor: lo, hi, at; false if not cut.)
bool bandOf(int k, int a, int b, int t, out ivec3 B) {
  B = ivec3(0);
  if (t <= 0) return false;
  int H = terraceH(k, t);
  B = FNH[k].x > 0.0 ? ivec3(b - H, b, b) : ivec3(a, a + H, a);
  return true;
}
bool underRidge(int k, int e, int lv, int s, int e2, bool hasCity, ivec3 city, bool hasFine, int fb, int flo, int fhi) {
  int r = FER[k * 2 + e], y = s;
  bool up = FNH[k].x > 0.0;
  for (int i = 0; i < 6; i++) {
    if (y >= e2) break;
    ridgeRow(r, lv, lv == 0 ? fdiv(y, 12) : 2 * y);
    int ra = h12(lv, gRY0), rb = h12(lv, gRY1), a = max(s, ra), b = min(e2, rb);
    ivec3 RB;
    bool rok = bandOf(k, h12(lv, gRCY0), h12(lv, gRCY1), gRTC, RB);
    if (hasCity) {
      int lo = max(a, city.x), hi = min(b, city.y);
      if (lo < hi && !(rok && RB.x <= lo && hi <= RB.y && (up ? RB.z >= city.z : RB.z <= city.z))) return false;
    }
    if (hasFine) {
      int lo = max(a, flo), hi = min(b, fhi);
      if (lo < hi) {
        bool inb = rok && (up ? rb >= RB.x : ra <= RB.y);
        int alo = inb && up ? max(ra, RB.x) : ra, ahi = inb && !up ? min(rb, RB.y) : rb;
        if (!(fb <= gRT - gRTC && alo <= lo && hi <= ahi)) return false;
      }
    }
    y = rb;
  }
  return true;
}
int rectDepth(int k, int lv, int u0, int u1, int y0, int y1, int j, int fl, int cy0, int cy1) {
  int s = h12(lv, y0), e2 = h12(lv, y1);
  ivec3 cityB;
  bool hasCB = lv == 1 && bandOf(k, 12 * cy0, 12 * cy1, fl, cityB);
  bool up = FNH[k].x > 0.0;
  for (int jj = ND - 1; jj > 0; jj--) {
    if (jj > j) continue;
    int t = fl + depthOf(lv, jj);
    if (t > capAt(k, s, e2)) continue;
    ivec3 city = cityB;
    bool hasCity = hasCB, hasFine = lv == 1;
    if (lv == 0) hasCity = bandOf(k, s, e2, t, city);
    bool inb = hasCB && (up ? e2 >= cityB.x : s <= cityB.y);
    int flo = inb && up ? max(s, cityB.x) : s, fhi = inb && !up ? min(e2, cityB.y) : e2;
    bool ok = true;
    for (int e = 0; e < 2; e++)
      if (ok && nearRidge(k, e, lv, u0, u1, y0, y1, t) && !underRidge(k, e, lv, s, e2, hasCity, city, hasFine, t - fl, flo, fhi)) ok = false;
    if (ok) return t;
  }
  return fl;
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

// A face's depth plane x deep (quarters, twelfths) at level scale S, in whole
// numbers of n . X (see F.dn).
int depthN(int k, int S, ivec2 x) {
  // (floor(p |n| / 12) for p twelfths, exactly: see depthN in the JS.)
  int p = (3 * x.x + x.y) * S, q = p * p * FNN[k];
  int dn = int(floor(sqrt(float(q)) / 12.0));
  if (144 * (dn + 1) * (dn + 1) <= q) dn++;
  if (dn > 0 && 144 * dn * dn > q) dn--;
  return dn;
}
// Its out-plane: about a unit past the face (ceil |n| in n . X).
void depthOut(int k, int S, int ni, float nf) {
  float nl = FNS[k].x;
  airPlane((float(ni - FPLANE[k].z * S - int(ceil(nl))) + nf) / nl, FN[k]);
}

// The true heights lo..hi (in 4 y at the city's level; in units one level
// finer, and within the cell, or a cell past each side in gCarveOpen; as
// three pieces (gCarveCross), the piece gAxis runs on along that axis only:
// see runOn in the JS. (Set with gCarve, below, and for a plain cell's
// openings: see windowAir.)
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

int lowBit(uint m) { return int(round(log2(float(m & (~m + 1u))))); } // (findLSB, for small m)
// A box facePocket asks after, with the others in one loop (one copy of
// their planes): from u A on sa's side to B on sb's (F's measure), or (e >= 0,
// a notch) from past the ridge to its edge, whose plane is sv away (see
// notchBox); between heights y0 and y1, with its depth plane dn (see F.dn),
// bounded a unit past face g (for notches, the other face at the ridge;
// for the pocket, its own); fz: how deep it fades from (see below). Kept in
// separate variables, not arrays: indexed arrays make the compile crawl.
struct Box { bool on; int A, sa, B, sb, y0, y1, dn, g; float fz; int e; float sv; bool ter; int yin; float yb, back; };
// The back of a cut (see cutOf in the JS): a terrace (gCter: its wall's
// inner height gCyin, its floor or ceiling gCyb, behind its wall by gCback)
// or behind the face (gCdn); and how deep it fades from (gCfz).
bool gCter;
int gCyin, gCdn;
float gCyb, gCback, gCfz;
void terraceOf(int k, int S, int y0, int y1, int t) {
  float H = float(terraceH(k, t)) * float(S) / 12.0;
  bool up = FNH[k].x > 0.0;
  gCter = true; gCyin = up ? y1 : y0; gCyb = up ? float(y1) - H : float(y0) + H; gCback = 0.0; gCfz = 0.0;
}
void cutOf(int k, int lv, int S, int y0, int y1, int t, int fl, int cy0, int cy1) {
  if (lv == 0) { terraceOf(k, S, y0, y1, t); return; }
  if (fl > 0) {
    terraceOf(k, S, cy0, cy1, fl);
    if (FNH[k].x > 0.0 ? float(y1) >= gCyb : float(y0) <= gCyb) { gCback = float(t - fl) / 12.0 * float(S) * FNS[k].x / FNH[k].y; gCfz = gCback; return; }
  }
  int x = t - fl;
  gCter = false;
  gCdn = depthN(k, S, ivec2(x / 3, x - 3 * (x / 3)));
  gCfz = float(gCdn) / FNS[k].x;
}
// Face k's notch at its e-th ridge, at level lv, for the point (see faceAt):
// the box, if the point is on the ridge's side of its edge (gS); and how far
// off its row's ends, or past its edge, the point is (gCap: so the distance
// runs on unbroken across the edge, as across a rectangle's). See notchAir
// in the JS.
float gCap;
Box gS;
void notchBox(int k, int e, int lv, int py, int pu, float pfu, int pYi, float pYf) {
  int S = lv == 0 ? 1 : R;
  gS.on = false;
  ivec4 E = FEDGE[k * 2 + e];
  int sg = E.w > 0 ? 1 : -1, sd = E.x > 0 ? 1 : -1, wi = ((k * 2 + e) * 2 + lv) * 17;
  int Z = sg * sd * (pu * E.x - E.y * pYi - S * E.z);
  float fz0 = float(sg * sd) * (float(E.x) * pfu - float(E.y) * pYf), nz = float(abs(E.x)) * EGL[k * 2 + e];
  // (Past the widest a notch can be, only how far past it; see notchAir in the JS.)
  float widest = (float(Z - FWT[wi + 16] * abs(E.x)) + fz0) / nz;
  if (widest > 0.0) { gCap = widest; return; }
  ridgeRow(FER[k * 2 + e], lv, py);
  gCap = min(min(float(pYi - gRY0) + pYf, float(gRY1 - pYi) - pYf), -widest);
  if (gRT == 0 || (lv == 1 && gRT == gRTC)) return;
  float edge = (float(Z - FWT[wi + gRT] * abs(E.x)) + fz0) / nz;
  if (edge > 0.0) { gCap = min(gCap, edge); return; }
  gCap = min(gCap, -edge);
  cutOf(k, lv, S, gRY0, gRY1, gRT, lv == 1 ? gRTC : 0, gRCY0, gRCY1);
  gS = Box(true, 0, 0, 0, 0, gRY0, gRY1, gCdn, FEG[k * 2 + e], lv == 1 ? gCfz : 0.0, e, edge, gCter, gCyin, gCyb, gCback);
}

// Face k's cuts where the point is, at level lv (see facePocket in the JS),
// united with d; and where it is in none, how far off their edges are at
// least. For a ray, how far it can go in them (reach, and the surface there).
float facePocket(int lv, int k, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {
  int S = lv == 0 ? 1 : R;
  faceAt(k, S, base);
  int pu = gPu, pYi = gPYi, pni = gPni, py = gPy;
  float pfu = gPfu, pYf = gPYf, pnf = gPnf, pfy = gPfy;
  // The city's rectangle (from one level finer: the point's place in the city's measure), and its depth.
  int ru = pu, ry = py;
  float rfu = pfu, rfy = pfy;
  if (lv == 1) {
    ru = fdiv(pu + (pfu < 0.0 ? -1 : 0), R);
    rfu = (float(pu - R * ru) + pfu) / float(R);
    ry = fdiv(py, R);
    rfy = (float(py - R * ry) + pfy) / float(R);
  }
  // (Each level in turn, in one loop, so that the compiler makes one copy:
  // one level finer, tiled afresh from the city rectangle's corner, on its floor.)
  int u0 = 0, u1 = 0, y0 = 0, y1 = 0, o0 = 0, o1 = 0, tc = 0, t = 0, fl = 0, cy0 = 0, cy1 = 0;
  uint tile = 0u;
  for (int l = 0; l <= lv; l++) {
    rectangle(l, k, ru, rfu, ry, rfy, tile);
    u0 = gU0 + o0; u1 = gU1 + o0; y0 = gY0 + o1; y1 = gY1 + o1;
    fl = t;
    t = rectDepth(k, l, u0, u1, y0, y1, gDepth, fl, cy0, cy1);
    if (l == 0) {
      tc = t; cy0 = y0; cy1 = y1;
      o0 = R * u0; o1 = R * y0;
      ru = pu - o0; rfu = pfu; ry = py - o1; rfy = pfy;
      tile = hashCell(ivec3(u0, y0, k), TILE_SALT);
    }
  }
  float inv = 1.0 / FLEN[k];
  float cap = min(min(float(pu - u0) + pfu, float(u1 - pu) - pfu) * inv, min(float(pYi - y0) + pYf, float(y1 - pYi) - pYf));
  // (fz: how deep the box fades from, see below: one level finer, only the
  // finer part, from the city's floor (as it is cut, in the city's
  // measure), in the level's units.)
  cutOf(k, lv, S, y0, y1, t, fl, R * cy0, R * cy1);
  Box bp = Box(t > fl, u0, -1, u1, 1, y0, y1, gCdn, k, lv == 0 ? 0.0 : gCfz, -1, 0.0, gCter, gCyin, gCyb, gCback), bs1, bs2;
  bs1.on = false; bs2.on = false;
  int n1 = 0, n2 = 0;
  float f1 = 0.0, f2 = 0.0;
  for (uint m = 3u; m != 0u; m &= m - 1u) {
    int e = lowBit(m);
    notchBox(k, e, lv, py, pu, pfu, pYi, pYf);
    cap = min(cap, gCap);
    if (gS.on) faceAt(FEG[k * 2 + e], S, base);
    if (e == 0) { bs1 = gS; n1 = gPni; f1 = gPnf; }
    else { bs2 = gS; n2 = gPni; f2 = gPnf; }
  }
  vec3 tn = vec3(FT[k]) * inv;
  int pieces = lv == 1 && gCarveCross ? 3 : 1;
  // (Over the boxes there are, by their bits, so that the compiler cannot
  // copy the loop out once per box.)
  uint boxes = (bp.on ? 1u : 0u) | (bs1.on ? 2u : 0u) | (bs2.on ? 4u : 0u);
  // With distance (see the march), the relief one level finer fades by
  // getting shallower: each box's floor rises by fr of its fading depth,
  // growing by fg of it for each unit the ray goes; its walls stay. (Not by
  // the uniform shrinking of the rest of the level's air, which would fill in
  // shallow relief long before deep, and leave slivers where boxes meet:
  // cell() takes that out again for map.)
  // (The city's own cuts keep the uniform shrinking: their face is the
  // plaza's air's, which shrinks so; and by the time the city fades they
  // are under a pixel.)
  float fo = gO, fa = gA, fr = lv == 1 ? gO / (CLOSE * float(R)) : 0.0, fg = lv == 1 ? gA / (CLOSE * float(R)) : 0.0;
  if (lv == 1) { gO = 0.0; gA = 0.0; }
  for (uint m = boxes; m != 0u; m &= m - 1u) {
    int b = lowBit(m);
    Box x = bs2;
    if (b == 0) x = bp; else if (b == 1) x = bs1;
    int gn = b == 0 ? pni : b == 1 ? n1 : n2;
    float gf = b == 0 ? pnf : b == 1 ? f1 : f2;
    for (int a = 0; a < pieces; a++) {
      gAxis = pieces == 1 ? -1 : a;
      gRay = false;
      float gd = 1e9;
      for (int pass = 0; pass < 2; pass++) {
        airPiece();
        if (x.e >= 0) airPlane(x.sv, EGN[k * 2 + x.e]);
        else {
          airPlane(float(x.sa) * (float(pu - x.A) + pfu) * inv, float(x.sa) * tn);
          airPlane(float(x.sb) * (float(pu - x.B) + pfu) * inv, float(x.sb) * tn);
        }
        airPlane(float(x.y0 - pYi) - pYf, -EY);
        airPlane(float(pYi - x.y1) + pYf, EY);
        gA = fg * x.fz;
        if (x.ter) {
          vec2 nh = FNH[k];
          bool up = nh.x > 0.0;
          airPlane(up ? x.yb - float(pYi) - pYf : float(pYi) + pYf - x.yb, up ? -EY : EY);
          airPlane((float(FPLANE[k].z * S - pni) + nh.x * (float(pYi - x.yin) + pYf) - x.back * nh.y - pnf) / nh.y + fr * x.fz, -normalize(vec3(FN[k].x, 0.0, FN[k].z)));
        } else airPlane((float(FPLANE[k].z * S - x.dn - pni) - pnf) / FNS[k].x + fr * x.fz, -FN[k]);
        gA = 0.0;
        depthOut(k, S, pni, pnf);
        if (x.g != k) depthOut(x.g, S, gn, gf);
        heights(lv, L, f, base, FQY[k].z, FQY[k].w);
        if (pass == 0) {
          gd = gD;
          if (!ray || gd + gO > 0.0) break;
          gRay = true;
        } else {
          gRay = false;
          if (gX > reach) { reach = gX; nrm = gN; }
        }
      }
      d = min(d, gd);
    }
  }
  gO = fo; gA = fa;
  return min(d, max(cap, 0.0));
}

// The pockets and notches at level lv of the faces with a bit in faces
// (base: the point's cell's corner from the building's origin, in the
// level's units). Asked after from one place (see cell): what asks for them
// leaves the level (or -1), the faces, base and the cell's own bound here.
int gCarve;
uint gCarveFaces;
ivec3 gCarveBase;
float gCarveE;
float carve(int lv, ivec3 L, vec3 f, ivec3 base, uint faces, float d, bool ray, inout float reach, inout vec3 nrm) {
  // (Over the bits set, so that the compiler makes one copy, not one for
  // every face.)
  for (uint m = faces; m != 0u; m &= m - 1u) d = facePocket(lv, lowBit(m), L, f, base, d, ray, reach, nrm);
  return d;
}

// Which faces the city's pockets may reach the point from (o
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

// Face j's openings where the point is: in each of its grids, the opening
// of its square of the grid (GGRID along, GUP up), from GGRID's deep behind
// the face to a unit past it, and its channel (GGRID's channel deep, all the
// way up); or, varying (GVAR), the opening of its pitch and its trim; within
// the grid's extent (GEXT) and the cell or a cell past each side in
// gCarveOpen (as one piece or three: see runsOn); and where the point is in
// none, how far off its square's edges are (the other openings are beyond
// them; its channel is one piece up the cell).
float windowAir(int j, ivec3 L, vec3 f, float d, bool ray, inout float reach, inout vec3 nrm) {
  ivec3 base = gCellB * R;
  ivec4 ht = WHT[j];
  int u, w;
  float fu = float(ht.w) * slantAt(ht.z, u), fw = float(ht.y) * slantAt(ht.x, w);
  u = ht.w * u + WT[j].x * base.x + WT[j].z * base.z;
  w = ht.y * w + WH[j].x * base.x + WH[j].z * base.z;
  int y = base.y + L.y - ${GROUND * R};
  float len = WLEN[j], inv = 1.0 / len;
  int K = WKA[j].x * R, a = WKA[j].y;
  int outer = -fdiv(-K, a) + int(ceil(len));
  gRay = false;
  float gw = 1e9, cap = 1e9;
  // (With distance an opening fades by getting shallower, as the relief
  // does (see facePocket): as its level does, or sooner, at its own size.)
  float fo = gO, fa = gA;
  gO = 0.0; gA = 0.0;
  int pieces = gCarveCross ? 3 : 1;
  for (int k = WGR[j].x; k < WGR[j].x + WGR[j].y; k++) {
    ivec4 g = GGRID[k], gu = GUP[k], ge = GEXT[k], gv = GVAR[k], gb = GVB[k];
    int cy = fdiv(y - gu.w - (f.y < 0.0 ? 1 : 0), gu.y), y0 = gu.w + cy * gu.y;
    // (Segments' rows are shifted along, each by its own whole number of cuts.)
    int sh = gv.x == 1 ? fdiv(gv.z * int(hashCell(ivec3(cy, k, 0), SEGMENT_SALT ^ 1u) % uint(gv.y / gv.z)) * g.x, gv.y) : 0;
    int cu = fdiv(u - gu.x - sh - (fu < 0.0 ? 1 : 0), g.x), u0 = gu.x + sh + cu * g.x;
    cap = min(cap, min(min(float(u - u0) + fu, float(u0 + g.x - u) - fu) * inv, min(float(y - y0) + f.y, float(y0 + gu.y - y) - f.y)));
    // (A segment's opening: where along, how wide and deep, in its units
    // (gv.y to the block).)
    int vo = 0, vw = 0, vd = 0;
    if (gv.x == 1) {
      // (The segment of its block the point is in, between the block's
      // cuts, sorted; its opening inset from both ends, or none.)
      uint h = hashCell(ivec3(cu, cy, k), SEGMENT_SALT);
      int n = gv.y / gv.z - 1;
      int c1 = gv.z * (1 + int(h % uint(n))), c2 = gv.z * (1 + int((h >> 10u) % uint(n))), c3 = gv.z * (1 + int((h >> 20u) % uint(n)));
      int t = min(c1, c2); c2 = max(c1, c2); c1 = t;
      t = min(c2, c3); c3 = max(c2, c3); c2 = t;
      t = min(c1, c2); c2 = max(c1, c2); c1 = t;
      float p = float(u - u0) + fu;
      int A = 0, B = c1, i = 0;
      if (p >= float(fdiv(c1 * g.x, gv.y))) { A = c1; B = c2; i = 1; }
      if (p >= float(fdiv(c2 * g.x, gv.y))) { A = c2; B = c3; i = 2; }
      if (p >= float(fdiv(c3 * g.x, gv.y))) { A = c3; B = gv.y; i = 3; }
      cap = min(cap, min(p - float(fdiv(A * g.x, gv.y)), float(fdiv(B * g.x, gv.y)) - p) * inv);
      uint hs = hashCell(ivec3(cu, 4 * cy + i, k), SEGMENT_SALT ^ 2u);
      vo = A + gv.w;
      vw = B - A - 2 * gv.w;
      vd = int(hs % 100u) < gb.z ? 0 : gb.x + int((hs >> 8u) % uint(gb.y - gb.x + 1));
    }
    // (The opening, then its channel, if any; a segment's, if any.)
    for (int c = 0; c < (gv.x == 1 ? (vd > 0 ? 1 : 0) : g.w > 0 ? 2 : 1); c++) {
      int ua, ub, ya, yb, back;
      if (gv.x == 1) {
        ua = u0 + fdiv(vo * g.x, gv.y);
        ub = u0 + fdiv((vo + vw) * g.x, gv.y);
        back = fdiv(K, a) - fdiv(vd * g.x, gv.y);
        ya = y0;
        yb = y0 + gu.z;
      } else {
        ua = u0;
        ub = u0 + g.y;
        back = fdiv(K, a) - (c == 0 ? g.z : g.w);
        ya = c == 0 ? y0 : ge.z;
        yb = c == 0 ? y0 + gu.z : ge.w;
      }
      ua = max(ua, ge.x); ub = min(ub, ge.y); ya = max(ya, ge.z); yb = min(yb, ge.w);
      if (gv.x == 1 && ub - ua < fdiv(2 * g.x, gv.y)) continue;
      float fz = (float(K) / float(a) - float(back)) * inv;
      // (Its fade: as its level's, or at its own size, sooner (GSCALE: 1 for
      // as the level); for a ray, going no slower than it may in the step.)
      float own = (gScale / GSCALE[k] - 1.0 / LOD_HI) * LOD_K;
      float fp = clamp(own, 0.0, 1.0), fq = own < 1.0 ? LOD_K * gScaleRate / GSCALE[k] : 0.0;
      for (int p = 0; p < pieces; p++) {
        gAxis = pieces == 1 ? -1 : p;
        for (int pass = 0; pass < 2; pass++) {
          airPiece();
          airPlane((float(ua - u) - fu) * inv, -vec3(WT[j]) * inv);
          airPlane((float(u - ub) + fu) * inv, vec3(WT[j]) * inv);
          gA = fq * fz;
          airPlane((float(back - w) - fw) * inv + fp * fz, -vec3(WH[j]) * inv);
          gA = 0.0;
          airPlane((float(w - outer) + fw) * inv, vec3(WH[j]) * inv);
          airSpan(L.y, f.y, max(ya + ${GROUND * R} - base.y, openLo(1)), min(yb + ${GROUND * R} - base.y, openHi(1)), EY);
          airSpan(L.x, f.x, openLo(0), openHi(0), EX);
          airSpan(L.z, f.z, openLo(2), openHi(2), EZ);
          if (pass == 0) {
            float gd = gD;
            gw = min(gw, gd);
            if (!ray || gd + gO > 0.0) break;
            gRay = true;
          } else {
            gRay = false;
            if (gX > reach) { reach = gX; nrm = gN; }
          }
        }
      }
    }
  }
  gAxis = -1;
  gO = fo; gA = fa;
  return min(min(d, gw), max(cap, 0.0));
}

// The openings in a plain or skin cell (see VOLUME in the JS): of each
// solid in its entry (WIN_AT, in m.z), those of each face in its mask,
// stopped at the other solids in CLIP outside it (at another with openings
// here, only where that is not open itself: so that two solids' openings
// meeting overlap, and leave no sheet between them); for a ray, the furthest
// it runs in them (reach, nrm). A ray in a solid's openings stops at the
// first of another's way that is outside it: where it goes in, or else where
// it leaves the solid (sooner than it might, in another's openings: they
// carry it on from there). (They run on as gCarveOpen and gCarveCross say:
// set from m.w for them.)
float openings(ivec3 L, vec3 f, uvec4 m, bool ray, inout float reach, inout vec3 nrm) {
  vec3 q = vec3(gCellB) + (vec3(L) + f) / float(R);
  float a = 1e9, fo = gO, fa = gA;
  // (Each solid's openings as they are, first.)
  int ms[${WIN_AT.length}];
  float bs[${WIN_AT.length}], rs[${WIN_AT.length}];
  vec3 ns[${WIN_AT.length}];
  for (int s = 0; s < ${WIN_AT.length}; s++) {
    uint w = (m.z >> uint(s * WIN_BITS)) & ${(1 << WIN_BITS) - 1}u;
    ms[s] = int(w & ${(1 << SOLID_BITS) - 1}u) - 1;
    bs[s] = 1e9; rs[s] = -1.0; ns[s] = vec3(0.0);
    if (ms[s] >= 0)
      for (uint k = w >> uint(SOLID_BITS); k != 0u; k &= k - 1u) bs[s] = windowAir(WFIRST[ms[s]] + lowBit(k), L, f, bs[s], ray, rs[s], ns[s]);
  }
  for (int s = 0; s < ${WIN_AT.length}; s++) {
    int me = ms[s];
    if (me < 0) continue;
    float b = bs[s], r = rs[s];
    vec3 rn = ns[s];
    float own = solidOut(me, q);
    bool rays = ray && r >= 0.0;
    // (Where the ray leaves the solid, and that plane's normal.)
    float oIn = -1e30, oOut = 1e30;
    vec3 oN = vec3(0.0);
    if (rays) {
      gO = 0.0; gA = 0.0;
      for (int k = SOLID_AT[me].x; k < SOLID_AT[me].x + SOLID_AT[me].y; k++) {
        float rd = dot(SOLID_PL[k].xyz, gDir), g = (dot(SOLID_PL[k].xyz, q) - SOLID_PL[k].w) * float(R);
        if (rd > 0.0 && -g / rd < oOut) { oOut = -g / rd; oN = SOLID_PL[k].xyz; }
        else if (rd < 0.0) oIn = max(oIn, g / -rd);
        else if (rd == 0.0 && g > 0.0) oOut = -1e30;
      }
    }
    for (uint c = m.y & ${(1 << CROSS_AT) - 1}u; c != 0u; c >>= uint(SOLID_BITS)) {
      int i = int(c & ${(1 << SOLID_BITS) - 1}u) - 1;
      if (i == me) continue;
      bool through = SOLID_MASS[i];
      float inside = -solidOut(i, q) * float(R);
      for (int t = 0; t < ${WIN_AT.length}; t++) if (ms[t] == i) inside = min(inside, bs[t]);
      b = max(b, through ? min(inside, own * float(R)) : inside);
      if (rays) {
        solidBegin();
        for (int k = SOLID_AT[i].x; k < SOLID_AT[i].x + SOLID_AT[i].y; k++) solidFace((dot(SOLID_PL[k].xyz, q) - SOLID_PL[k].w) * float(R), SOLID_PL[k].xyz);
        float x = max(gIn, 0.0);
        vec3 n = gInN;
        if (through && x >= oIn && x < oOut) { x = oOut; n = -oN; }
        // (Inside it here, outside the solid: no air, as the distance says.)
        if (x < gOut && x < r) { r = x > 0.0 ? x : -1.0; rn = n; }
      }
    }
    gO = fo; gA = fa;
    a = min(a, b);
    if (r > reach) { reach = r; nrm = rn; }
  }
  return a;
}

// A level-(CITY + 1) cell the table says something of: deep in the
// building, the halls (d, reach and nrm being what they say of it), cut off
// at its sides across which they may not run on; in its skin, pockets and no
// rooms (they are the city's surface, coloured as the city: gSkin), and any
// openings it has (see openings); plain, solid but for its openings. Its air is
// never further off than its sides (the next cell's may be just across
// them).
float reliefCell(ivec3 L, vec3 f, ivec3 id, uint seed, uvec4 m, float d, inout float reach, inout vec3 nrm) {
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
  gCarveOpen = (m.w >> uint(OPEN_AT)) & 63u;
  gCarveCross = ((m.w >> uint(CROSS_AT)) & 1u) != 0u;
  float a = m.z != 0u ? openings(L, f, m, ray, reach, nrm) : 1e9;
  gRay = ray;
  gCarveOpen = (m.x >> uint(OPEN_AT)) & 63u;
  gCarveCross = ((m.y >> uint(CROSS_AT)) & 1u) != 0u;
  if (kind == ${PLAIN}u) {
    gSkin = ray ? reach >= 0.0 : a < 0.0;
    // (Less gO, which map takes off the whole level again: see cell.)
    return min(a - gO, max(e, 0.0));
  }
  // (Its pockets, with its openings: see cell.)
  gCarve = 1;
  gCarveFaces = (m.x >> uint(FACE_AT)) & 63u;
  gCarveBase = gCellB * R;
  gCarveE = e;
  return a - gO;
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
  // (Its pockets: see cell.)
  gCarve = 0;
  gCarveFaces = cityFaces(L, f, fromMiddle(id));
  gCarveBase = fromMiddle(id) - ORIGIN;
  return min(p, w);
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
    uvec4 m = level == ${CITY + 1} ? relief(id, gUp) : uvec4(0u);
    uint kind = m.x & 3u;
    reach = -1.0;
    nrm = vec3(0.0);
    if (m.x == 0u || kind == ${DEEP}u) d = hallsCell(L, f, id, seed, reach, nrm);
    if (m.x != 0u) d = reliefCell(L, f, id, seed, m, d, reach, nrm);
  }
  // (The buildings' relief, asked after in one place only, as the halls are.)
  if (gCarve >= 0) {
    bool ray = gRay;
    float r0 = reach;
    vec3 n0 = nrm;
    float a = carve(gCarve, L, f, gCarveBase, gCarveFaces, 1e9, ray, reach, nrm);
    gRay = ray;
    if (gCarve == 0) {
      // (The city's pockets, and how far off the rest are (gFar), stop at
      // the solids without relief: inside one (as the air there is drawn,
      // shrunk with distance) they are no air; near one, a ray they take on
      // strikes it. Asked only where it could matter.)
      float c = min(gFar, a), bi = -1e9;
      vec3 q = vec3(gCarveBase + L) + f;
      // (It changes d only where c < d and the point is within -c of a
      // solid (inside one, if c >= 0); a ray, only within BARE_NEAR.)
      if ((c < d && bareNear(q, max(-c, 0.0))) || (reach > r0 && bareNear(q, ${glf(BARE_NEAR)}))) bi = bareIn(q);
      d = min(d, max(c, bi));
      if (bi + gO >= 0.0) { reach = r0; nrm = n0; }
      else if (reach > r0 && bi > -${glf(BARE_NEAR)}) {
        gX = reach; gN = nrm;
        for (int i = 0; i < NBARE; i++) {
          solidBegin();
          for (int j = 0; j < 6; j++) solidFace(dot(BARE_PL[i * 6 + j].xyz, q) - BARE_PL[i * 6 + j].w, BARE_PL[i * 6 + j].xyz);
          solidEnd();
        }
        reach = gX; nrm = gN;
      }
    }
    else {
      // (With the cell's openings, in d: see reliefCell.)
      d = min(d, min(a - gO, max(gCarveE, 0.0)));
      gSkin = ray ? reach >= 0.0 : d < 0.0;
    }
  }
  return d;
}
`;

// The same, in JavaScript, piece for piece (as in halls.js: a plane is only
// its distance).
let dLp, dFp, dLm, dFm, dLs, dFs;
const diag = (p, sa, sb, ca, cb, k) =>
  sa === sb ? sa * (dLp[p] - ca - cb) - k + sa * dFp[p] : sa * (dLm[p] - ca + cb) - k + sa * dFm[p];
let gD;
const piece = () => (gD = -Infinity);
const plane = (s) => (gD = Math.max(gD, s));
const span = (x, f, x0, x1) => (plane(x0 - x - f), plane(x - x1 + f));
const NONE = 1e9;
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
// The sides a skin cell's pockets (or a cell's openings) run on
// across, whether as three pieces, and which of them is being asked about
// (see runOn).
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
  if (!up || up[1] < ROW_ID || up[1] >= ROW_ID + ROWS) return [0, 0, 0, 0];
  const o = fromMiddle(up), v = [0, 1, 2].map((a) => o[a] + (((id[a] % R) + R) % R) - VOLUME.lo[a]);
  if (v.some((x, a) => x < 0 || x >= VOLUME.size[a])) return [0, 0, 0, 0];
  cellB = v.map((x, a) => x + VOLUME.lo[a] - ORIGIN[a]);
  const i = WORDS * (v[0] + VOLUME.size[0] * (v[1] + VOLUME.size[1] * v[2]));
  return [VOLUME.data[i], VOLUME.data[i + 1], VOLUME.data[i + 2], VOLUME.data[i + 3]];
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


// Where the point is on face F at level lv (base its cell's corner from the
// building's origin, in this level's units): along (u, fu), its true height
// (y, fy, whole units and the rest, at least 0; and
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

// A city cut t twelfths deep over rows y0 to y1 (level units, scale S) is
// a terrace (.claude/design/terraces.md): the solid between the slope and a
// vertical wall H tall, the wall standing where the slope is at the
// storey's inner height: the upper's faces lean back, so it is at the top
// of the rows (a floor at yb, open above); the lower's lean out, so it is at
// the bottom (a ceiling at yb). One level finer, a pocket in a terrace is
// cut behind its wall (back units, horizontally) between its floor and top.
// (H on the grid of the finer rows, rounded down: so that no finer
// pocket's row ends just short of, or on, its floor; see inBand.)
function terrace(F, S, y0, y1, t) {
  const H = (terraceH(F, t) * S) / 12, up = F.n[1] > 0;
  return { up, yin: up ? y1 : y0, yb: up ? y1 - H : y0 + H, back: 0 };
}
// (Whether rows y0 to y1 reach into terrace w's band, or to its floor:
// then a finer pocket is cut only above the floor, behind the wall, and one
// that only reaches the floor is not cut at all; else, cut into the slope
// below the floor, its air would meet the terrace's in a plane, with
// nothing between them but that plane: a sheet.)
const inBand = (w, y0, y1) => (w.up ? y1 >= w.yb : y0 <= w.yb);
// The planes of a cut's back: behind the face (dn, in n . X), or a terrace's
// wall and its floor or ceiling.
function cutBack(F, p, Y, cut) {
  if (cut.dn !== undefined) return plane((F.K * p.S - cut.dn - p.ni - p.nf) / F.nl);
  const nh = Math.hypot(F.n[0], F.n[2]), ny = F.n[1];
  plane(cut.up ? cut.yb - Y : Y - cut.yb);
  plane((F.K * p.S - ny * cut.yin - cut.back * nh - (p.ni + p.nf - ny * Y)) / nh);
}

// The air of a pocket of face F (p from faceAt) over [u0, u1] x [y0, y1],
// cut as cut says (see cutBack), to a unit past the face, within true
// heights lo to hi (level units) and, one level finer, within the cell or
// a cell past each side in cellOpen (see runOn).
function pocketAir(F, lv, p, L, f, u0, u1, y0, y1, cut, lo, hi) {
  const Y = p.Yi + p.Yf, ys = F.gm * F.mlen;
  return eachPiece(lv, () => {
    piece();
    plane((u0 - p.u - p.fu) / F.len);
    plane((p.u - u1 + p.fu) / F.len);
    plane((y0 * F.p - Y) / ys);
    plane((Y - y1 * F.p) / ys);
    cutBack(F, p, Y, cut);
    plane((p.ni + p.nf - F.K * p.S - Math.ceil(F.nl)) / F.nl);
    span(L[1], f[1], lv === 1 ? Math.max(lo, openLo(1)) : lo, lv === 1 ? Math.min(hi, openHi(1)) : hi);
    if (lv === 1) span(L[0], f[0], openLo(0), openHi(0)), span(L[2], f[2], openLo(2), openHi(2));
    return gD;
  });
}
// The back of a cut of level lv t twelfths deep over rows y0 to y1, on a
// city cut fl deep whose rows are cy0 to cy1 (level units): a terrace at the
// city's level; one level finer, behind the city terrace's wall where it
// reaches into its band, else behind the face.
function cutOf(F, lv, S, y0, y1, t, fl, cy0, cy1) {
  const dnOf = (x) => F.dn[lv][Math.min(NDQ - 1, Math.floor(x / 3)) * NDQ + x - 3 * Math.min(NDQ - 1, Math.floor(x / 3))];
  if (lv === 0) return terrace(F, S, y0, y1, t);
  if (fl > 0) {
    const w = terrace(F, S, cy0, cy1, fl);
    // (Behind the wall by as much as makes it t - fl twelfths deeper, along the face's normal.)
    if (inBand(w, y0, y1)) return { ...w, back: (((t - fl) / 12) * S * F.nl) / Math.hypot(F.n[0], F.n[2]) };
  }
  return { dn: dnOf(t - fl) };
}

// The notch at F's e-th ridge where the point is (p from faceAt at level
// lv; lo, hi its true heights), united with d; and where the point is not in
// it, how far off its row's ends and its edge are at least (see ridgeRow).
function notchAir(F, e, lv, p, L, f, base, lo, hi, d) {
  const E = F.edges[e], G = E.G, S = p.S, Y = p.Yi + p.Yf;
  const edgeAt = (t) => (zone(E, p.u + p.fu, Y, S) - E.Wt[lv][t] * Math.abs(E.dl)) / (Math.abs(E.dl) * E.gl);
  // (Past the widest a notch can be, only how far past it the point is; and
  // within it no more than how far back from it, so that the distance runs
  // on unbroken across it.)
  const widest = edgeAt(16);
  if (widest > 0) return Math.min(d, widest);
  const r = RIDGES[F.er[e]], w = ridgeRow(r, lv, p.y);
  let cap = Math.min(Y - w.y0, w.y1 - Y, -widest);
  // (One level finer, only its own part: the city's row is the city's.)
  if (!w.t || (lv && w.t === w.tc)) return Math.min(d, Math.max(cap, 0));
  // (Its edge: W in from the ridge, along it. Past it, only how far past it
  // the point is; on the ridge's side, the box and how far back from its
  // edge: so the distance runs on unbroken across it, as across a
  // rectangle's.)
  const edge = edgeAt(w.t);
  if (edge > 0) return Math.min(d, Math.max(Math.min(cap, edge), 0));
  cap = Math.min(cap, -edge);
  const pG = faceAt(G, lv, base), cut = cutOf(F, lv, S, w.y0, w.y1, w.t, w.tc === w.t ? 0 : w.tc, w.cy0, w.cy1);
  // (From past the ridge (a unit past G's face) to its edge, within the row.)
  d = Math.min(d, eachPiece(lv, () => {
    piece();
    plane(edge);
    plane(w.y0 - Y);
    plane(Y - w.y1);
    cutBack(F, p, Y, cut);
    plane((p.ni + p.nf - F.K * S - Math.ceil(F.nl)) / F.nl);
    plane((pG.ni + pG.nf - G.K * S - Math.ceil(G.nl)) / G.nl);
    span(L[1], f[1], lv === 1 ? Math.max(lo, openLo(1)) : lo, lv === 1 ? Math.min(hi, openHi(1)) : hi);
    if (lv === 1) span(L[0], f[0], openLo(0), openHi(0)), span(L[2], f[2], openLo(2), openHi(2));
    return gD;
  }));
  return Math.min(d, Math.max(cap, 0));
}

// Face k's cuts where the point is, at level lv, united with d: its
// rectangle's pocket and its ridges' notches; and where it is in none, how
// far off their edges are at least.
function facePocket(lv, k, L, f, base, d) {
  const F = FACES[k], p = faceAt(F, lv, base), S = p.S;
  // The city's rectangle (from one level finer: the point's place in the city's measure), and its depth.
  const uc = lv ? fdiv(p.u + (p.fu < 0 ? -1 : 0), R) : p.u, fuc = lv ? (p.u - R * uc + p.fu) / R : p.fu;
  const yc = lv ? fdiv(p.y, R) : p.y, fyc = lv ? (p.y - R * yc + p.fy) / R : p.fy;
  const c = rectangle(0, k, uc, fuc, yc, fyc), tc = rectDepth(F, 0, c.u0, c.u1, c.y0, c.y1, c.depth, 0, 0, 0);
  let r = c, t = tc, fl = 0;
  if (lv) {
    // One level finer: tiled afresh from the city rectangle's corner, on its floor.
    const ou = R * c.u0, oy = R * c.y0, salt = hashCell([c.u0, c.y0, k], TILE_SALT) >>> 0;
    const q = rectangle(1, k, p.u - ou, p.fu, p.y - oy, p.fy, salt);
    r = { u0: q.u0 + ou, u1: q.u1 + ou, y0: q.y0 + oy, y1: q.y1 + oy };
    t = rectDepth(F, 1, r.u0, r.u1, r.y0, r.y1, q.depth, tc, c.y0, c.y1);
    fl = tc;
  }
  const lo = (F.lo4 * S) / 4 - base[1], hi = (F.hi4 * S) / 4 - base[1], Y = p.Yi + p.Yf;
  const cap = Math.min(Math.min(p.u - r.u0 + p.fu, r.u1 - p.u - p.fu) / F.len, Y - r.y0, r.y1 - Y);
  // (No bare test one level finer: its pockets are only in skin cells, which nothing bare touches, and run on only where the cells agree.)
  if (t > fl) d = Math.min(d, pocketAir(F, lv, p, L, f, r.u0, r.u1, r.y0, r.y1, cutOf(F, lv, S, r.y0, r.y1, t, fl, R * c.y0, R * c.y1), lo, hi));
  for (const e of [0, 1]) d = notchAir(F, e, lv, p, L, f, base, lo, hi, d);
  return Math.min(d, Math.max(cap, 0));
}

function pockets(L, f, faces, d) {
  const base = cellB.map((x) => x * R);
  FACES.forEach((F, k) => {
    if (faces & (1 << k)) d = facePocket(1, k, L, f, base, d);
  });
  return d;
}

// The city's own pockets near the point (o its cell's corner
// from the middle cell's): of each face it is near, from a cell past it to
// DMAX in; elsewhere, at least that far off.
function cityPockets(L, f, o) {
  const base = o.map((x, a) => x - ORIGIN[a]);
  let d = NONE, dp = NONE;
  const q = [0, 1, 2].map((a) => base[a] + L[a] + f[a]);
  FACES.forEach((F, k) => {
    const away = Math.max(...[0, 1, 2].map((a) => Math.max(F.solid.lo[a] - ORIGIN[a] - 2 - q[a], q[a] - (F.solid.hi[a] - ORIGIN[a]) - 2)));
    if (away > 0) return void (d = Math.min(d, away));
    const m = SLANTS[F.plane.k], sg = F.plane.sign;
    const s = (sg * dLs[F.plane.k] + sg * (m[0] * base[0] + m[1] * base[1] + m[2] * base[2]) - F.K + sg * dFs[F.plane.k]) / F.nl;
    if (s < -BAND_IN) d = Math.min(d, -s - BAND_IN);
    else if (s > BAND_OUT) d = Math.min(d, s - BAND_OUT);
    else dp = facePocket(0, k, L, f, base, dp);
  });
  // (The pockets, and how far off the rest are, stop at the solids without
  // relief.)
  return Math.max(Math.min(d, dp), bareIn(q));
}
// See bareIn in the shader.
function bareIn(q) {
  let d = -1e9;
  for (const pl of BARE_PL) d = Math.max(d, -Math.max(...pl.map((p) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2] - p[3])));
  return d;
}

// See windowAir in the shader.
function windowAir(j, L, f, d) {
  const W = WINDOWS[j], base = cellB.map((x) => x * R);
  const u = W.t.sign * dLs[W.t.k] + W.tv[0] * base[0] + W.tv[2] * base[2], fu = W.t.sign * dFs[W.t.k];
  const w = W.h.sign * dLs[W.h.k] + W.hv[0] * base[0] + W.hv[2] * base[2], fw = W.h.sign * dFs[W.h.k];
  const y = base[1] + L[1] - GROUND * R;
  const K = W.K * R, outer = cdiv(K, W.alpha) + Math.ceil(W.len);
  let a = NONE, cap = NONE;
  for (let k = W.g0; k < W.g0 + W.ng; k++) {
    const { pu, wu, dw, ch, ph, py, hy, yb: rows, ext, vary: [vk, vp, va, vi], varyB: [d0, d1, none] } = GRIDS[k];
    const cy = fdiv(y - rows - (f[1] < 0 ? 1 : 0), py), y0 = rows + cy * py;
    // (Segments' rows are shifted along, each by its own whole number of cuts.)
    const sh = vk === 1 ? fdiv(va * (hashCell([cy, k, 0], (SEGMENT_SALT ^ 1) >>> 0) % (vp / va)) * pu, vp) : 0;
    const cu = fdiv(u - ph - sh - (fu < 0 ? 1 : 0), pu), u0 = ph + sh + cu * pu;
    cap = Math.min(cap, (u - u0 + fu) / W.len, (u0 + pu - u - fu) / W.len, y - y0 + f[1], y0 + py - y - f[1]);
    // (A segment's opening: where along, how wide and deep, in its units.)
    let vo = 0, vw = 0, vd = 0;
    if (vk === 1) {
      // (The segment of its block the point is in: see the shader.)
      const h = hashCell([cu, cy, k], SEGMENT_SALT), n = vp / va - 1;
      const cuts = [h % n, (h >>> 10) % n, (h >>> 20) % n].map((x) => va * (1 + x)).sort((a, b) => a - b);
      const p = u - u0 + fu, U = (x) => fdiv(x * pu, vp);
      let A = 0, B = cuts[0], i = 0;
      for (let m = 0; m < 3; m++) if (p >= U(cuts[m])) [A, B, i] = [cuts[m], m < 2 ? cuts[m + 1] : vp, m + 1];
      cap = Math.min(cap, (p - U(A)) / W.len, (U(B) - p) / W.len);
      const hs = hashCell([cu, 4 * cy + i, k], (SEGMENT_SALT ^ 2) >>> 0);
      vo = A + vi;
      vw = B - A - 2 * vi;
      vd = hs % 100 < none ? 0 : d0 + ((hs >>> 8) % (d1 - d0 + 1));
    }
    // (The opening, then its channel, if any; a segment's, if any.)
    for (const c of vk === 1 ? (vd > 0 ? [0] : []) : ch > 0 ? [0, 1] : [0]) {
      let ua, ub, ya, yt, back;
      if (vk) [ua, ub, back, ya, yt] = [u0 + fdiv(vo * pu, vp), u0 + fdiv((vo + vw) * pu, vp), fdiv(K, W.alpha) - fdiv(vd * pu, vp), y0, y0 + hy];
      else [ua, ub, back, ya, yt] = [u0, u0 + wu, fdiv(K, W.alpha) - (c === 0 ? dw : ch), c === 0 ? y0 : ext[2], c === 0 ? y0 + hy : ext[3]];
      [ua, ub, ya, yt] = [Math.max(ua, ext[0]), Math.min(ub, ext[1]), Math.max(ya, ext[2]), Math.min(yt, ext[3])];
      if (vk === 1 && ub - ua < fdiv(2 * pu, vp)) continue;
      a = Math.min(a, eachPiece(1, () => {
        piece();
        plane((ua - u - fu) / W.len);
        plane((u - ub + fu) / W.len);
        plane((back - w - fw) / W.len);
        plane((w - outer + fw) / W.len);
        span(L[1], f[1], Math.max(ya + GROUND * R - base[1], openLo(1)), Math.min(yt + GROUND * R - base[1], openHi(1)));
        span(L[0], f[0], openLo(0), openHi(0));
        span(L[2], f[2], openLo(2), openHi(2));
        return gD;
      }));
    }
  }
  return Math.min(d, a, Math.max(cap, 0));
}

function reliefCell(L, f, id, seed, [m, clip, wins, wrun], d) {
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
  cellOpen = (wrun >>> OPEN_AT) & 63;
  cellCross = !!((wrun >>> CROSS_AT) & 1);
  const a = openings(L, f, wins, clip);
  cellOpen = (m >>> OPEN_AT) & 63;
  cellCross = !!((clip >>> CROSS_AT) & 1);
  return Math.min(a, kind === SKIN ? pockets(L, f, (m >>> FACE_AT) & 63, NONE) : NONE, Math.max(e, 0));
}

// See openings in the shader.
function openings(L, f, wins, clip) {
  const q = cellB.map((x, i) => x + (L[i] + f[i]) / R), out = (i) => Math.max(...SOLID_PL[i].map((p) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2] - p[3]));
  // (Each solid's openings as they are, first; then each stopped at the others.)
  const raw = WIN_AT.map((at) => {
    const w = (wins >>> at) & ((1 << WIN_BITS) - 1), me = (w & ((1 << SOLID_BITS) - 1)) - 1;
    let b = NONE;
    if (me >= 0) for (let k = 0; k < 4; k++) if ((w >>> SOLID_BITS) & (1 << k)) b = windowAir(SOLIDS[me].wfirst + k, L, f, b);
    return { me, b };
  });
  let a = NONE;
  for (const { me, b: b0 } of raw) {
    if (me < 0) continue;
    let b = b0;
    const own = out(me);
    for (let c = clip & ((1 << CROSS_AT) - 1); c; c >>>= SOLID_BITS) {
      const i = (c & ((1 << SOLID_BITS) - 1)) - 1;
      if (i === me) continue;
      const inside = Math.min(-R * out(i), ...raw.filter((x) => x.me === i).map((x) => x.b));
      b = Math.max(b, SOLIDS[i].relief ? Math.min(inside, R * own) : inside);
    }
    a = Math.min(a, b);
  }
  return a;
}

function cellAir(L, f, id, seed, dg, level, up) {
  if (level < CITY) return NONE;
  if (level === CITY + 1) {
    const m = relief(id, up);
    if (m[0]) {
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
