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
// sb long in rows sby high, each row shifted along by its own whole number
// of quanta (so that no line runs on up the face), each split `splits` times
// at whole quanta (along it, quanta of its own measure). Each rectangle is
// cut into the face to its own depth (depths, as often as weights) behind
// the face's deepest point over it: a box with an upright back wall parallel
// to the face's edge, and level floor and ceiling. The same rule at two
// levels: the city's own (lengths in its lattice units, cells), whose boxes
// make the masses and the ragged silhouettes; and the next (in its units),
// smaller boxes in those. Nothing thin is cut through: at its back wall's
// corners a pocket is either at least `keep` inside each of the mass's other
// faces, or out past it (it notches the ridge between them, S2); and none is
// cut where the mass is less than THIN cells from its axis (near an apex).
const THIN = 1;
const LEVELS = [
  { sb: 4, sby: 2, quant: 1, splits: 3, depths: [0, 0.25, 0.5, 1], weights: [0.25, 0.35, 0.25, 0.15], keep: 0.25 },
  { sb: 24, sby: 12, quant: 2, splits: 3, depths: [0, 2, 4, 6, 8], weights: [0.3, 0.25, 0.2, 0.15, 0.1], keep: 2 },
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
                 back: LEVELS.map((lv) => lv.depths.map((d) => Math.round(d * len))),
                 lo4: Math.round(s.ylo * 4), hi4: Math.round(s.yhi * 4), solid: s,
                 others: s.relief.filter((j) => j !== i).map((j) => s.planes[j]) });
  }
});
function dot2(v) {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}
// For the thickness rule: each other plane n . X < K of a face's mass, as a
// whole-number bound on n . X times the face's len2 (its h . h), at each
// level, less `keep` (see LEVELS).
for (const F of FACES) {
  F.keep = LEVELS.map((lv, i) => F.others.map(({ n, K }) => (i ? R : 1) * K * F.len2 - Math.ceil(lv.keep * Math.hypot(...n) * F.len2)));
  F.on = LEVELS.map((lv, i) => F.others.map(({ K }) => (i ? R : 1) * K * F.len2));
  // (sub (K - ny y), at least, for the face to be THIN from the axis.)
  F.thin = LEVELS.map((lv, i) => Math.ceil((THIN * (i ? R : 1) * F.alpha * F.len) / F.sub) * F.sub);
}
// (A cell's table entry has a bit for each, six in all.)
if (FACES.length > 6) throw new Error(`arcology: ${FACES.length} faces with relief, at most 6`);
// How far behind a face the finer level's pockets can reach (in cells): the
// deepest, and the face's run across a rectangle's height.
const REACH = Math.max(...FACES.map((F) => (LEVELS[1].depths.at(-1) + (LEVELS[1].sby * Math.abs(F.ny)) / F.alpha / F.len) / R)) + 1;
// How far out past a face the city's pockets reach (cells): a unit past the
// face at a rectangle's outermost, and the face's run across its height.
for (const F of FACES) {
  const run = (LEVELS[0].sby * Math.abs(F.ny)) / F.alpha / Math.hypot(...F.hv.map((x) => x / F.sub));
  F.outC = 1 + Math.ceil(F.len) / F.len + run;
  F.reachC = LEVELS[0].depths.at(-1) + run + 1;
}
const OUT_C = Math.max(...FACES.map((F) => F.outC));
// How far behind a face the city's pockets can reach (cells), likewise.
const REACH_C = Math.max(...FACES.map((F) => LEVELS[0].depths.at(-1) + (LEVELS[0].sby * Math.abs(F.ny)) / F.alpha / F.len)) + 1;
// The city's pockets keep clear of the solids that are neither masses nor
// their rims (pillars, towers): those solids' bounds, from the building's origin.
const BARE = SOLIDS.filter((s) => !s.relief && !s.rim).map((s) => [s.lo.map((x, a) => x - ORIGIN[a]), s.hi.map((x, a) => x - ORIGIN[a])]);
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
// clear of every solid).
const DEEP = 1, SKIN = 2, PLAIN = 3, FACE_AT = 2, OPEN_AT = 8, WIN_AT = 14;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
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
const int FACE_AT = ${FACE_AT}, OPEN_AT = ${OPEN_AT};
const uint POCKET_SALT = ${POCKET_SALT}u, ROW_SALT = ${ROW_SALT}u, DEPTH_SALT = ${DEPTH_SALT}u;
// The two levels' pockets (see LEVELS): sb, sby, quant, splits; and their
// depths' shares, ND to a level.
const int ND = ${ND};
const ivec4 LV[2] = ivec4[2](${LEVELS.map((l) => `ivec4(${l.sb}, ${l.sby}, ${l.quant}, ${l.splits})`).join(', ')});
const float CUM[2 * ND] = float[2 * ND](${LEVELS.flatMap((l) => [...l.cumulative, ...Array(ND - l.depths.length).fill(2)]).map(glf).join(', ')});
const int NF = ${FACES.length};
// Each face: n's slant (index, sign), K, alpha, ny; its h and t as slants
// (index, sign); its measure along (q, a level each); lo, hi (4 y); and each
// level's depths, in units across it.
const ivec4 FPLANE[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.plane.k}, ${F.plane.sign}, ${F.K}, ${F.alpha})`).join(', ')});
const int FNY[NF] = int[NF](${FACES.map((F) => F.ny).join(', ')});
const int FSUB[NF] = int[NF](${FACES.map((F) => F.sub).join(', ')});
const float FNLEN[NF] = float[NF](${FACES.map((F) => glf(Math.hypot(...F.n))).join(', ')});
const ivec4 FHT[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.h.k}, ${F.h.sign}, ${F.t.k}, ${F.t.sign})`).join(', ')});
const ivec4 FQY[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.q[0]}, ${F.q[1]}, ${F.lo4}, ${F.hi4})`).join(', ')});
const ivec3 FH[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.hv))});
const ivec3 FT[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.tv))});
const float FLEN[NF] = float[NF](${FACES.map((F) => glf(F.len)).join(', ')});
const int FLEN2[NF] = int[NF](${FACES.map((F) => F.len2).join(', ')});
const int FBACK[2 * NF * ND] = int[2 * NF * ND](${LEVELS.flatMap((l, i) => FACES.flatMap((F) => [...F.back[i], ...Array(ND - l.depths.length).fill(0)])).join(', ')});
const int FOUR = ${FOUR.k};
// Each face's mass's other planes, and the thickness rule's bounds on them
// (see FACES' keep), a level after another.
const ivec3 FOTH[NF * 2] = ivec3[NF * 2](${ivecs(FACES.flatMap((F) => F.others.map((o) => o.n)))});
const int FKEEP[2 * NF * 2] = int[2 * NF * 2](${[0, 1].flatMap((i) => FACES.flatMap((F) => F.keep[i])).join(', ')});
const int FON[2 * NF * 2] = int[2 * NF * 2](${[0, 1].flatMap((i) => FACES.flatMap((F) => F.on[i])).join(', ')});
const int FTHIN[2 * NF] = int[2 * NF](${[0, 1].flatMap((i) => FACES.map((F) => F.thin[i])).join(', ')});
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
const float REACH_C = ${glf(REACH_C)}, OUT_C = ${glf(OUT_C)};
const vec2 FBAND[NF] = vec2[NF](${FACES.map((F) => `vec2(${glf(F.reachC)}, ${glf(F.outC)})`).join(', ')});
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
// face, in its own measure, y up, each a whole number and the rest), and
// its depth's index.
int gU0, gU1, gY0, gY1, gDepth;
void rectangle(int lv, int k, int u, float fu, int y, float fy) {
  ivec4 lvp = LV[lv];
  int q = lv == 0 ? FQY[k].x : FQY[k].y, n = lvp.x / lvp.z, su = n * q;
  uint salt = uint(lv * 0x5bd1e995);
  int row = fdiv(y - (fy < 0.0 ? 1 : 0), lvp.y);
  int shift = q * int(hashCell(ivec3(row, k, lv), ROW_SALT ^ salt) % uint(n));
  int col = fdiv(u - (fu < 0.0 ? 1 : 0) - shift, su);
  int u0 = col * su + shift, u1 = u0 + su, y0 = row * lvp.y, y1 = y0 + lvp.y;
  uint h = hashCell(ivec3(col, row, k), POCKET_SALT ^ salt);
  for (int i = 0; i < lvp.w; i++) {
    int nu = (u1 - u0) / q, ny = (y1 - y0) / lvp.z;
    bool alongU = (i & 1) == 0 ? (h & 4u) != 0u : (h & 4u) == 0u;
    if (alongU && nu < 2) alongU = false;
    if (!alongU && ny < 2) alongU = nu >= 2;
    int w = alongU ? nu : ny;
    if (w >= 2) {
      int s = 1 + int((h >> 8) % uint(w - 1));
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

// The pocket of face k at level lv where the point is: a box in the face's
// frame, between its rectangle's sides, from its back wall (its depth behind
// the face's deepest point over the rectangle) to a unit past the face,
// kept within the mass's heights (and, one level finer, within the cell;
// at the city's, off the pillars and towers). base: the point's cell's
// corner from the building's origin, in this level's units. United with d
// (and for a ray, reach and nrm); and where the point is in none, how far
// off its rectangle's edges are at least (the face's other pockets are
// beyond them).
float facePocket(int lv, int k, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {
  ivec4 ht = FHT[k], pl = FPLANE[k];
  int scale = lv == 0 ? 1 : R;
  // Where the point is, along the face (u) and across it (w).
  int u, w;
  float fu = float(ht.w) * slantAt(ht.z, u), fw = float(ht.y) * slantAt(ht.x, w);
  u = ht.w * u + FT[k].x * base.x + FT[k].z * base.z;
  w = ht.y * w + FH[k].x * base.x + FH[k].z * base.z;
  int y = base.y + L.y;
  rectangle(lv, k, u, fu, y, f.y);
  float len = FLEN[k], inv = 1.0 / len;
  float cap = min(min(float(u - gU0) + fu, float(gU1 - u) - fu) * inv, min(float(y - gY0) + f.y, float(gY1 - y) - f.y));
  int back = FBACK[(lv * NF + k) * ND + gDepth];
  if (back > 0) {
    // The face across it, at the rectangle's floor and ceiling: w = (K - ny y) / alpha.
    int K = pl.z * scale, a = pl.w, wl = (K - FNY[k] * gY0) * FSUB[k], wh = (K - FNY[k] * gY1) * FSUB[k];
    back = fdiv(min(wl, wh), a) - back;
    int outer = cdiv(max(wl, wh), a) + int(ceil(len));
    bool clear = true;
    if (lv == 0) {
      // (Its bounds, across, times len2: x len2 = u t.x + w h.x, and z alike.)
      int l2 = FLEN2[k];
      ivec2 xs = ivec2(gU0 * FT[k].x, gU1 * FT[k].x), ws = ivec2(back * FH[k].x, outer * FH[k].x);
      ivec2 zs = ivec2(gU0 * FT[k].z, gU1 * FT[k].z), vs = ivec2(back * FH[k].z, outer * FH[k].z);
      int x0 = min(xs.x, xs.y) + min(ws.x, ws.y), x1 = max(xs.x, xs.y) + max(ws.x, ws.y);
      int z0 = min(zs.x, zs.y) + min(vs.x, vs.y), z1 = max(zs.x, zs.y) + max(vs.x, vs.y);
      for (int j = 0; j < NBARE; j++)
        if (x0 < BARE_HI[j].x * l2 && x1 > BARE_LO[j].x * l2 && z0 < BARE_HI[j].z * l2 && z1 > BARE_LO[j].z * l2 &&
            gY0 < BARE_HI[j].y && gY1 > BARE_LO[j].y) clear = false;
    }
    // (Nothing thin cut through: see THIN.)
    if (min(wl, wh) < FTHIN[lv * NF + k]) clear = false;
    for (int c = 0; c < 4; c++) {
      int cu = (c & 1) == 0 ? gU0 : gU1, cy = (c & 2) == 0 ? gY0 : gY1;
      int xx = cu * FT[k].x + back * FH[k].x, zz = cu * FT[k].z + back * FH[k].z, yy = cy * FLEN2[k];
      for (int j = 0; j < 2; j++) {
        ivec3 on = FOTH[k * 2 + j];
        int v = on.x * xx + on.y * yy + on.z * zz, at = (lv * NF + k) * 2 + j;
        if (v > FKEEP[at] && v <= FON[at]) clear = false;
      }
    }
    int y0 = gY0, y1 = gY1;
    if (lv == 1) { y0 = max(y0 - base.y, max(FQY[k].z * R / 4 - base.y, 0)); y1 = min(y1 - base.y, min(FQY[k].w * R / 4 - base.y, R)); }
    else { y0 -= base.y; y1 -= base.y; }
    if (clear && y0 < y1) {
      int n4;
      float f4 = slantAt(FOUR, n4);
      n4 += 4 * base.y;
      gRay = false;
      float g = 1e9;
      for (int pass = 0; pass < 2; pass++) {
        airPiece();
        airPlane((float(gU0 - u) - fu) * inv, -vec3(FT[k]) * inv);
        airPlane((float(u - gU1) + fu) * inv, vec3(FT[k]) * inv);
        airPlane((float(back - w) - fw) * inv, -vec3(FH[k]) * inv);
        airPlane((float(w - outer) + fw) * inv, vec3(FH[k]) * inv);
        airSpan(L.y, f.y, y0, y1, EY);
        if (lv == 1) {
          airSpan(L.x, f.x, 0, R, EX);
          airSpan(L.z, f.z, 0, R, EZ);
        } else {
          // (The rims, at quarter cells: 4 y between lo and hi.)
          airPlane((float(FQY[k].z - n4) - f4) * 0.25, -EY);
          airPlane((float(n4 - FQY[k].w) + f4) * 0.25, EY);
        }
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

// The pockets of the faces near a skin cell (faces, a bit each).
float pockets(ivec3 L, vec3 f, uint faces, float d, bool ray, inout float reach, inout vec3 nrm) {
  for (int k = 0; k < NF; k++)
    if ((faces & (1u << uint(k))) != 0u) d = facePocket(1, k, L, f, gCellB * R, d, ray, reach, nrm);
  return d;
}

// The city's own pockets near the point (o its cell's corner from the
// middle cell's): of each face it is near, inside or just out; where it is
// further in, they are at least that far off, less how deep they go.
float cityPockets(ivec3 L, vec3 f, ivec3 o, bool ray, inout float reach, inout vec3 nrm) {
  ivec3 base = o - ORIGIN;
  float d = 1e9;
  vec3 q = vec3(base + L) + f;
  for (int k = 0; k < NF; k++) {
    // (Its pockets are within its mass's bounds and OUT_C: no
    // nearer than those, if it is outside them.)
    vec3 off = max(vec3(FLO[k]) - FBAND[k].y - q, q - vec3(FHI[k]) - FBAND[k].y);
    float away = max(max(off.x, off.y), off.z);
    if (away > 0.0) { d = min(d, away); continue; }
    ivec4 pl = FPLANE[k];
    ivec3 m = SLANT[pl.x];
    int n;
    float fr = float(pl.y) * slantAt(pl.x, n);
    float s = (float(pl.y * n + pl.y * (m.x * base.x + m.y * base.y + m.z * base.z) - pl.z) + fr) / FNLEN[k];
    if (s < -FBAND[k].x) { d = min(d, -s - FBAND[k].x); continue; }
    if (s > FBAND[k].y) { d = min(d, s - FBAND[k].y); continue; }
    d = facePocket(0, k, L, f, base, d, ray, reach, nrm);
  }
  return d;
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
  float a = pockets(L, f, (m.x >> uint(FACE_AT)) & 63u, 1e9, ray, reach, nrm);
  gRay = ray;
  gSkin = ray ? reach >= 0.0 : a < 0.0;
  return min(a, max(e, 0.0));
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
  float c = cityPockets(L, f, fromMiddle(id), ray, reach, nrm);
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
  return min(min(p, w), c);
}

float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {
  if (level < ${CITY}) {
    reach = -1.0;
    nrm = vec3(0.0);
    return 1e9;
  }
  if (level == ${CITY} && id.y >= ${ROW_ID} && id.y < ${ROW_ID + ROWS}) return city(L, f, id, seed, reach, nrm);
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
  float d = 1e9;
  reach = -1.0;
  nrm = vec3(0.0);
  if (m == uvec2(0u) || kind == ${DEEP}u) d = hallsCell(L, f, id, seed, reach, nrm);
  return m != uvec2(0u) ? reliefCell(L, f, id, seed, m, d, reach, nrm) : d;
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
function relief(id, up) {
  if (!up || up[1] < ROW_ID || up[1] >= ROW_ID + ROWS) return [0, 0];
  const o = fromMiddle(up), v = [0, 1, 2].map((a) => o[a] + (((id[a] % R) + R) % R) - VOLUME.lo[a]);
  if (v.some((x, a) => x < 0 || x >= VOLUME.size[a])) return [0, 0];
  cellB = v.map((x, a) => x + VOLUME.lo[a] - ORIGIN[a]);
  const i = 2 * (v[0] + VOLUME.size[0] * (v[1] + VOLUME.size[1] * v[2]));
  return [VOLUME.data[i], VOLUME.data[i + 1]];
}

// See rectangle in the shader.
export function rectangle(lv, k, u, fu, y, fy) {
  const P = LEVELS[lv], q = FACES[k].q[lv], n = P.sb / P.quant, su = n * q;
  const salt = Math.imul(lv, 0x5bd1e995) >>> 0;
  const row = fdiv(y - (fy < 0 ? 1 : 0), P.sby);
  const shift = q * (hashCell([row, k, lv], (ROW_SALT ^ salt) >>> 0) % n);
  const col = fdiv(u - (fu < 0 ? 1 : 0) - shift, su);
  let u0 = col * su + shift, u1 = u0 + su, y0 = row * P.sby, y1 = y0 + P.sby;
  let h = hashCell([col, row, k], (POCKET_SALT ^ salt) >>> 0);
  for (let i = 0; i < P.splits; i++) {
    const nu = (u1 - u0) / q, ny = (y1 - y0) / P.quant;
    let alongU = (i & 1) === 0 ? (h & 4) !== 0 : (h & 4) === 0;
    if (alongU && nu < 2) alongU = false;
    if (!alongU && ny < 2) alongU = nu >= 2;
    const w = alongU ? nu : ny;
    if (w >= 2) {
      const s = 1 + ((h >>> 8) % (w - 1));
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

// See facePocket in the shader.
function facePocket(lv, k, L, f, base, d) {
  const F = FACES[k], scale = lv === 0 ? 1 : R;
  const u = F.t.sign * dLs[F.t.k] + F.tv[0] * base[0] + F.tv[2] * base[2], fu = F.t.sign * dFs[F.t.k];
  const w = F.h.sign * dLs[F.h.k] + F.hv[0] * base[0] + F.hv[2] * base[2], fw = F.h.sign * dFs[F.h.k];
  const y = base[1] + L[1];
  const r = rectangle(lv, k, u, fu, y, f[1]);
  const cap = Math.min(Math.min(u - r.u0 + fu, r.u1 - u - fu) / F.len, y - r.y0 + f[1], r.y1 - y - f[1]);
  let back = F.back[lv][r.depth] ?? 0;
  if (back > 0) {
    const K = F.K * scale, wl = (K - F.ny * r.y0) * F.sub, wh = (K - F.ny * r.y1) * F.sub;
    back = fdiv(Math.min(wl, wh), F.alpha) - back;
    const outer = cdiv(Math.max(wl, wh), F.alpha) + Math.ceil(F.len);
    let clear = true;
    if (lv === 0) {
      const l2 = F.len2;
      const xs = [r.u0 * F.tv[0], r.u1 * F.tv[0]], ws = [back * F.hv[0], outer * F.hv[0]];
      const zs = [r.u0 * F.tv[2], r.u1 * F.tv[2]], vs = [back * F.hv[2], outer * F.hv[2]];
      const x0 = Math.min(...xs) + Math.min(...ws), x1 = Math.max(...xs) + Math.max(...ws);
      const z0 = Math.min(...zs) + Math.min(...vs), z1 = Math.max(...zs) + Math.max(...vs);
      for (const [lo, hi] of BARE)
        if (x0 < hi[0] * l2 && x1 > lo[0] * l2 && z0 < hi[2] * l2 && z1 > lo[2] * l2 && r.y0 < hi[1] && r.y1 > lo[1]) clear = false;
    }
    if (Math.min(wl, wh) < F.thin[lv]) clear = false;
    for (let c = 0; c < 4; c++) {
      const cu = c & 1 ? r.u1 : r.u0, cy = c & 2 ? r.y1 : r.y0;
      const xx = cu * F.tv[0] + back * F.hv[0], zz = cu * F.tv[2] + back * F.hv[2], yy = cy * F.len2;
      F.others.forEach(({ n }, j) => {
        const v = n[0] * xx + n[1] * yy + n[2] * zz;
        if (v > F.keep[lv][j] && v <= F.on[lv][j]) clear = false;
      });
    }
    let y0, y1;
    if (lv === 1) (y0 = Math.max(r.y0 - base[1], (F.lo4 * R) / 4 - base[1], 0)), (y1 = Math.min(r.y1 - base[1], (F.hi4 * R) / 4 - base[1], R));
    else (y0 = r.y0 - base[1]), (y1 = r.y1 - base[1]);
    if (clear && y0 < y1) {
      const n4 = dLs[FOUR.k] + 4 * base[1], f4 = dFs[FOUR.k];
      piece();
      plane((r.u0 - u - fu) / F.len);
      plane((u - r.u1 + fu) / F.len);
      plane((back - w - fw) / F.len);
      plane((w - outer + fw) / F.len);
      span(L[1], f[1], y0, y1);
      if (lv === 1) span(L[0], f[0], 0, R), span(L[2], f[2], 0, R);
      else plane((F.lo4 - n4 - f4) * 0.25), plane((n4 - F.hi4 + f4) * 0.25);
      d = Math.min(d, gD);
    }
  }
  return Math.min(d, Math.max(cap, 0));
}

function pockets(L, f, faces, d) {
  const base = cellB.map((x) => x * R);
  FACES.forEach((_, k) => {
    if (faces & (1 << k)) d = facePocket(1, k, L, f, base, d);
  });
  return d;
}

function cityPockets(L, f, o) {
  const base = o.map((x, a) => x - ORIGIN[a]);
  let d = NONE;
  const q = [0, 1, 2].map((a) => base[a] + L[a] + f[a]);
  FACES.forEach((F, k) => {
    const away = Math.max(...[0, 1, 2].map((a) => Math.max(F.solid.lo[a] - ORIGIN[a] - F.outC - q[a], q[a] - (F.solid.hi[a] - ORIGIN[a]) - F.outC)));
    if (away > 0) return void (d = Math.min(d, away));
    const m = SLANTS[F.plane.k], sg = F.plane.sign;
    const s = (sg * dLs[F.plane.k] + sg * (m[0] * base[0] + m[1] * base[1] + m[2] * base[2]) - F.K + sg * dFs[F.plane.k]) / Math.hypot(...F.n);
    if (s < -F.reachC) d = Math.min(d, -s - F.reachC);
    else if (s > F.outC) d = Math.min(d, s - F.outC);
    else d = facePocket(0, k, L, f, base, d);
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
