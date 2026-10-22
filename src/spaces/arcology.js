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
import { hexahedron } from './hexahedron.js';

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
// lies on a whole value of what is carried (a multiple of it would leave the
// plane between two, where the small parts cancel). Scale: 1 or -1.
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
// SB units long in rows SBY high, each row shifted along by its own whole
// number of QUANTs (so that no line runs on up the face), each split SPLITS
// times at whole QUANTs (along it, QUANTs of its own measure, q). Each
// rectangle is cut into the face to its own depth (DEPTHS, as often as
// WEIGHTS) behind the face's deepest point over it: a box with an upright
// back wall parallel to the face's edge, and level floor and ceiling.
const SB = 96, SBY = 48, QUANT = 4, SPLITS = 4;
const DEPTHS = [0, 2, 4, 8, 12, 18, 26];
const WEIGHTS = [0.3, 0.16, 0.15, 0.13, 0.11, 0.09, 0.06];
const CUMULATIVE = WEIGHTS.map((_, i) => WEIGHTS.slice(0, i + 1).reduce((x, y) => x + y));
const POCKET_SALT = 0x27d4eb2d, ROW_SALT = 0x165667b1, DEPTH_SALT = 0xd3a2646c;

// The faces that carry pockets: a mass's sloped faces. Each in its own
// frame: across it, h (the plane's normal laid flat, in whole numbers, out
// of the mass), along it, t (flat, along its edge), and up. Its plane is
// n . Y < K, Y in the finer lattice's units from the building's origin (so K
// is R times the city's), with n = alpha h + (0, ny, 0); its pockets keep
// within heights lo to hi (the same units). One rule, whatever way it faces.
const FACES = [];
SOLIDS.forEach((s) => {
  for (const i of s.relief ?? []) {
    const { n, K } = s.planes[i];
    const alpha = gcd(n[0], n[2]), h = [n[0] / alpha, 0, n[2] / alpha], t = [-h[2], 0, h[0]];
    const len = Math.hypot(...h);
    FACES.push({ n, K: K * R, K0: K, alpha, ny: n[1], h: slantOf(h), t: slantOf(t), hv: h, tv: t, len,
                 q: Math.round(QUANT * len), lo: Math.round(s.ylo * R), hi: Math.round(s.yhi * R), solid: s });
  }
});
// How far behind a face a pocket can reach (in cells): its depth, and the
// face's run across the deepest rectangle's height.
const REACH = Math.max(...FACES.map((F) => (DEPTHS.at(-1) + (SBY * Math.abs(F.ny)) / F.alpha / F.len) / R)) + 1;

// The table, one cell of level CITY + 1 to an entry (see volume in
// halls.js): in its first number, the cell's kind (KIND bits: 1 deep, its
// rooms the halls'; 2 skin, pockets and no rooms; 3 plain, solid), the faces
// whose pockets reach into it (FACE_AT, a bit each), and for a deep cell,
// for each of its six sides (+x, -x, +y, -y, +z, -z), whether its rooms'
// openings may run on across it (OPEN_AT: the next cell is deep too, or
// clear of every solid).
const DEEP = 1, SKIN = 2, PLAIN = 3, FACE_AT = 2, OPEN_AT = 8;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const VOLUME = (() => {
  const lo = [0, 1, 2].map((a) => Math.min(...SOLIDS.map((s) => s.lo[a])) - 2);
  const hi = [0, 1, 2].map((a) => Math.max(...SOLIDS.map((s) => s.hi[a])) + 2);
  lo[1] = Math.max(lo[1], G);
  const size = hi.map((h, a) => h - lo[a]);
  const n = size[0] * size[1] * size[2];
  const at = ([x, y, z]) => x + size[0] * (y + size[1] * z);
  const within = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
  const kind = new Uint8Array(n), open = new Uint8Array(n), faces = new Uint8Array(n);
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
      const ds = corners(c).map((q) => (F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]) - F.K0) / Math.hypot(...F.n));
      if (Math.max(...ds) > -REACH) f |= 1 << i;
    });
    // Skin where pockets reach and only masses and their rims touch it; deep
    // where it is wholly inside some solid (whatever else crosses it) and no
    // pocket reaches; plain otherwise.
    if (f && touched.every((s) => s.relief || s.rim)) (kind[v] = SKIN), (faces[v] = f);
    else kind[v] = !f && touched.some((s) => cellIn(s, c)) ? DEEP : PLAIN;
  }
  const data = new Uint32Array(2 * n);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = at([x, y, z]);
    if (!kind[v]) continue;
    let word = kind[v] | (faces[v] << FACE_AT);
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
const int FACE_AT = ${FACE_AT}, OPEN_AT = ${OPEN_AT}, SB = ${SB}, SBY = ${SBY}, QUANT = ${QUANT}, SPLITS = ${SPLITS};
const uint POCKET_SALT = ${POCKET_SALT}u, ROW_SALT = ${ROW_SALT}u, DEPTH_SALT = ${DEPTH_SALT}u;
const int NF = ${FACES.length};
// Each face: K, alpha, ny; its h and t as slants (index, sign); q; lo, hi.
const ivec3 FKAN[NF] = ivec3[NF](${FACES.map((F) => `ivec3(${F.K}, ${F.alpha}, ${F.ny})`).join(', ')});
const ivec4 FHT[NF] = ivec4[NF](${FACES.map((F) => `ivec4(${F.h.k}, ${F.h.sign}, ${F.t.k}, ${F.t.sign})`).join(', ')});
const ivec3 FQY[NF] = ivec3[NF](${FACES.map((F) => `ivec3(${F.q}, ${F.lo}, ${F.hi})`).join(', ')});
const ivec3 FH[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.hv))});
const ivec3 FT[NF] = ivec3[NF](${ivecs(FACES.map((F) => F.tv))});
const float FLEN[NF] = float[NF](${FACES.map((F) => glf(F.len)).join(', ')});
const float CUMULATIVE[${CUMULATIVE.length}] = float[${CUMULATIVE.length}](${CUMULATIVE.map(glf).join(', ')});
const int DEPTHS[${DEPTHS.length}] = int[${DEPTHS.length}](${DEPTHS.join(', ')});

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

// The rectangle of face k that the point is in (u along the face, in its own
// measure, y up, each a whole number and the rest), and its depth.
int gU0, gU1, gY0, gY1, gDepth;
void rectangle(int k, int u, float fu, int y, float fy) {
  int q = FQY[k].x, su = SB / QUANT * q;
  int row = fdiv(y - (fy < 0.0 ? 1 : 0), SBY);
  int shift = q * int(hashCell(ivec3(row, k, 0), ROW_SALT) % uint(SB / QUANT));
  int col = fdiv(u - (fu < 0.0 ? 1 : 0) - shift, su);
  int u0 = col * su + shift, u1 = u0 + su, y0 = row * SBY, y1 = y0 + SBY;
  uint h = hashCell(ivec3(col, row, k), POCKET_SALT);
  for (int i = 0; i < SPLITS; i++) {
    int nu = (u1 - u0) / q, ny = (y1 - y0) / QUANT;
    bool alongU = (i & 1) == 0 ? (h & 4u) != 0u : (h & 4u) == 0u;
    if (alongU && nu < 2) alongU = false;
    if (!alongU && ny < 2) alongU = nu >= 2;
    int w = alongU ? nu : ny;
    if (w >= 2) {
      int s = 1 + int((h >> 8) % uint(w - 1));
      if (alongU) { if (beyond(u, fu, u0 + s * q)) u0 += s * q; else u1 = u0 + s * q; }
      else { if (beyond(y, fy, y0 + s * QUANT)) y0 += s * QUANT; else y1 = y0 + s * QUANT; }
    }
    h = hashCell(ivec3(u0, y0, u1 * 4099 + y1), POCKET_SALT ^ uint(k));
  }
  float t = h01(hashCell(ivec3(u0, y0, k), DEPTH_SALT));
  int j = 0;
  for (int i = 0; i < ${DEPTHS.length - 1}; i++) if (t >= CUMULATIVE[i]) j = i + 1;
  gU0 = u0; gU1 = u1; gY0 = y0; gY1 = y1; gDepth = DEPTHS[j];
}

// The pockets of the faces near a skin cell (faces, a bit each): each a box
// in its face's frame, between its rectangle's sides, from its back wall
// (DEPTH behind the face's deepest point over the rectangle) to a unit past
// the face, within the cell; and, where the point is in none, how far off
// its rectangles' edges are at least (the other pockets are beyond them).
float pockets(ivec3 L, vec3 f, uint faces, float d, bool ray, inout float reach, inout vec3 nrm) {
  ivec3 base = gCellB * R;
  for (int k = 0; k < NF; k++) {
    if ((faces & (1u << uint(k))) == 0u) continue;
    ivec4 ht = FHT[k];
    ivec3 kan = FKAN[k], qy = FQY[k];
    // Where the point is, along the face (u) and across it (w).
    int u, w;
    float fu = float(ht.w) * slantAt(ht.z, u), fw = float(ht.y) * slantAt(ht.x, w);
    u = ht.w * u + FT[k].x * base.x + FT[k].z * base.z;
    w = ht.y * w + FH[k].x * base.x + FH[k].z * base.z;
    int y = base.y + L.y;
    rectangle(k, u, fu, y, f.y);
    float len = FLEN[k], inv = 1.0 / len;
    float cap = min(min(float(u - gU0) + fu, float(gU1 - u) - fu) * inv, min(float(y - gY0) + f.y, float(gY1 - y) - f.y));
    if (gDepth > 0) {
      // The face across it, at the rectangle's floor and ceiling: w = (K - ny y) / alpha.
      int a = kan.y, wl = kan.x - kan.z * gY0, wh = kan.x - kan.z * gY1;
      int back = fdiv(min(wl, wh), a) - int(float(gDepth) * len + 0.5), outer = cdiv(max(wl, wh), a) + int(ceil(len));
      int y0 = max(gY0, qy.y), y1 = min(gY1, qy.z);
      if (y0 < y1) {
        gRay = false;
        float g = 1e9;
        for (int pass = 0; pass < 2; pass++) {
          airPiece();
          airPlane((float(gU0 - u) - fu) * inv, -vec3(FT[k]) * inv);
          airPlane((float(u - gU1) + fu) * inv, vec3(FT[k]) * inv);
          airPlane((float(back - w) - fw) * inv, -vec3(FH[k]) * inv);
          airPlane((float(w - outer) + fw) * inv, vec3(FH[k]) * inv);
          airSpan(L.y, f.y, max(y0 - base.y, 0), min(y1 - base.y, R), EY);
          airSpan(L.x, f.x, 0, R, EX);
          airSpan(L.z, f.z, 0, R, EZ);
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
    d = min(d, max(cap, 0.0));
  }
  return d;
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
        d = max(d, gD);
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
    gSkin = false;
    return max(e, 0.0);
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
  if (ray && p + gO <= 0.0) {
    gRay = true;
    plaza(L, f, id);
    gRay = false;
    reach = gX;
    nrm = gN;
  }
  if (ray && w + gO <= 0.0) {
    gRay = true;
    well(L, f, id, seed);
    gRay = false;
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  gRay = ray;
  return min(p, w);
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
  // wherever they are asked after, and they are much the biggest part.)
  float d = hallsCell(L, f, id, seed, reach, nrm);
  uvec2 m = level == ${CITY + 1} ? relief(id, gUp) : uvec2(0u);
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
export function rectangle(k, u, fu, y, fy) {
  const q = FACES[k].q, su = (SB / QUANT) * q;
  const row = fdiv(y - (fy < 0 ? 1 : 0), SBY);
  const shift = q * (hashCell([row, k, 0], ROW_SALT) % (SB / QUANT));
  const col = fdiv(u - (fu < 0 ? 1 : 0) - shift, su);
  let u0 = col * su + shift, u1 = u0 + su, y0 = row * SBY, y1 = y0 + SBY;
  let h = hashCell([col, row, k], POCKET_SALT);
  for (let i = 0; i < SPLITS; i++) {
    const nu = (u1 - u0) / q, ny = (y1 - y0) / QUANT;
    let alongU = (i & 1) === 0 ? (h & 4) !== 0 : (h & 4) === 0;
    if (alongU && nu < 2) alongU = false;
    if (!alongU && ny < 2) alongU = nu >= 2;
    const w = alongU ? nu : ny;
    if (w >= 2) {
      const s = 1 + ((h >>> 8) % (w - 1));
      if (alongU) {
        if (beyond(u, fu, u0 + s * q)) u0 += s * q;
        else u1 = u0 + s * q;
      } else if (beyond(y, fy, y0 + s * QUANT)) y0 += s * QUANT;
      else y1 = y0 + s * QUANT;
    }
    h = hashCell([u0, y0, Math.imul(u1, 4099) + y1], (POCKET_SALT ^ k) >>> 0);
  }
  const t = h01(hashCell([u0, y0, k], DEPTH_SALT));
  let j = 0;
  for (let i = 0; i < DEPTHS.length - 1; i++) if (t >= CUMULATIVE[i]) j = i + 1;
  return { u0, u1, y0, y1, depth: DEPTHS[j] };
}

function pockets(L, f, faces, d) {
  const base = cellB.map((x) => x * R);
  FACES.forEach((F, k) => {
    if (!(faces & (1 << k))) return;
    const u = F.t.sign * dLs[F.t.k] + F.tv[0] * base[0] + F.tv[2] * base[2], fu = F.t.sign * dFs[F.t.k];
    const w = F.h.sign * dLs[F.h.k] + F.hv[0] * base[0] + F.hv[2] * base[2], fw = F.h.sign * dFs[F.h.k];
    const y = base[1] + L[1];
    const r = rectangle(k, u, fu, y, f[1]);
    const cap = Math.min(Math.min(u - r.u0 + fu, r.u1 - u - fu) / F.len, y - r.y0 + f[1], r.y1 - y - f[1]);
    if (r.depth > 0) {
      const wl = F.K - F.ny * r.y0, wh = F.K - F.ny * r.y1;
      const back = fdiv(Math.min(wl, wh), F.alpha) - Math.floor(r.depth * F.len + 0.5), out = cdiv(Math.max(wl, wh), F.alpha) + Math.ceil(F.len);
      const y0 = Math.max(r.y0, F.lo), y1 = Math.min(r.y1, F.hi);
      if (y0 < y1) {
        piece();
        plane((r.u0 - u - fu) / F.len);
        plane((u - r.u1 + fu) / F.len);
        plane((back - w - fw) / F.len);
        plane((w - out + fw) / F.len);
        span(L[1], f[1], Math.max(y0 - base[1], 0), Math.min(y1 - base[1], R));
        span(L[0], f[0], 0, R);
        span(L[2], f[2], 0, R);
        d = Math.min(d, gD);
      }
    }
    d = Math.min(d, Math.max(cap, 0));
  });
  return d;
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
    return Math.max(d, gD);
  }
  const e = Math.min(R - L[0] - f[0], L[0] + f[0], R - L[1] - f[1], L[1] + f[1], R - L[2] - f[2], L[2] + f[2]);
  if (kind === PLAIN) return Math.max(e, 0);
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
  return Math.min(plaza(L, f, id), id[1] === ROW_ID ? well(L, f, id, seed) : NONE);
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
