// "Arcology": the halls, built up into a few great buildings above the
// ground.
//
// Every level is halls (see halls.js) but one, the city's: there, one row of
// cells, running on in every direction to the horizon, is a plaza open to
// the sky, and in the middle of it stands a handful of buildings. They are
// solid at the city's level, so the halls one level finer are their rooms
// (each of which is a great hall of the halls one level finer still), and
// their faces are the facades of those rooms. Under the plaza are more
// halls, whose light wells open up through its floor. Above the city's row
// there is only sky, and the levels coarser than the city's are solid
// throughout (as air, they would swallow parts of it).
//
// The buildings are after Soleri's Hexahedron: a terraced pyramid standing
// on an inverted one, the two meeting at a broad waist (its park and
// promenade, overhanging), the whole held up on shafts that stand on the
// plaza, some of which rise on through the terraces as towers; a crown on
// top. One great one in the middle of the plaza, and two smaller ones off
// from it, each a little different. Each is a list of blocks, the same for
// every city cell, which asks all of them (they reach across many cells).

import halls, { hallsGlsl, hallsAir, hallsRoom, hallsOpenings, built, R, M } from './halls.js';
import { hashCell, levelSeed, wrapId as wrapIdR } from '../util.js';

const wrapId = (id) => wrapIdR(id, R);
const C = R / 2;
export const CITY = -2; // the city's level
const ROW = 12; // which row of its parent the city's cells are in
const G = M; // the plaza's floor, up from the bottom of a city cell
export const ROWS = 2; // how many rows of cells high the city is, from its floor to the sky
const TOP = ROWS * R - 2; // how high anything is built
// Ids are a cell's index in its parent plus R times its parent's in the
// grandparent: the city's row, and the cell in the middle of it, as ids.
export const ROW_ID = ROW + R * C;
const MID = C + R * C;
const ABOVE = 200; // how many rows over the city's are known to be over it

// The buildings, as blocks in city lattice units (level CITY + 1 cells),
// across from the corner of the middle cell: [x0, y0, z0, x1, y1, z1, kind],
// kind 0 a plain block, 1 a gable rising across x (its ridge along z), 2 one
// rising across z, 3 a pyramid, 4 a block cut at its corners, 5 a pyramid
// upside down (narrowing downward from its top face). Worked out the same
// every time.
const BLOCKS = [];
{
  let s = 0x2545f491;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const block = (x0, y0, z0, x1, y1, z1, kind = 0) => BLOCKS.push([x0, y0, z0, x1, y1, z1, kind]);

  // A hexahedron about (cx, cz), w across at its waist either way from the
  // middle, standing on shafts legs high.
  const hexahedron = (cx, cz, w, legs) => {
    const keel = int(2, 3);
    const lo = w - keel; // how far the lower pyramid hangs
    const waist = G + legs + lo;
    const hi = Math.min(w, TOP - waist - 2); // how far the upper rises
    // The lower: an upside-down pyramid, closed off flat by a keel.
    block(cx - w, waist - lo, cz - w, cx + w, waist, cz + w, 5);
    block(cx - keel, waist - lo - 1, cz - keel, cx + keel, waist - lo + 1, cz + keel);
    // The waist: a slab overhanging all round, a little more on two sides.
    const ox = int(1, 3), oz = int(1, 3);
    block(cx - w - ox, waist - 1, cz - w - oz, cx + w + ox, waist + 1, cz + w + oz);
    // The upper: terraces, each stepping in as far as it rises (so, overall,
    // 45 degrees), in steps of one to three.
    let y = waist, r = w;
    while (r > 1 && y < waist + hi) {
      const step = Math.min(int(1, 3), waist + hi - y, r - 1);
      block(cx - r, y - 1, cz - r, cx + r, y + step, cz + r);
      y += step;
      r -= step;
    }
    // A crown: a small pyramid, or a block cut at its corners.
    if (y < TOP) block(cx - r - 1, y - 1, cz - r - 1, cx + r + 1, Math.min(TOP, y + 2), cz + r + 1, rnd() < 0.5 ? 3 : 4);
    // The shafts it stands on: in a ring under the lower pyramid, up into
    // its underside, and a few inside the ring, up to the keel; two cells
    // square. Some rise on through the terraces as towers.
    const ring = Math.floor(w / 2);
    const shafts = [];
    for (let k = -ring; k <= ring; k += int(2, 4)) shafts.push([k, -ring], [k, ring], [-ring, k], [ring, k]);
    for (let n = int(1, 3); n > 0; n--) shafts.push([int(-keel, keel - 2), int(-keel, keel - 2)]);
    for (const [a, b] of shafts) {
      if (rnd() < 0.3) continue;
      const x0 = cx + a - 1, z0 = cz + b - 1;
      const out = Math.max(Math.abs(a), Math.abs(b));
      // (Up to where it meets the underside, or on through the terraces
      // and some way above them.)
      const top = rnd() < 0.3 ? Math.min(TOP, waist + (w - out) + int(2, 6)) : waist - lo + out + 1;
      block(x0, G - 1, z0, x0 + 2, top, z0 + 2, top > waist && rnd() < 0.4 ? 4 : 0);
    }
  };
  hexahedron(C, C, 13, 9);
  hexahedron(C - 38, C + 26, 7, 7);
  hexahedron(C + 34, C - 30, 9, 8);
}

// The city cells, across from the middle one, that any building stands in:
// no light well opens in those (it would come up into a building).
const BUILT = new Set();
for (const [x0, , z0, x1, , z1] of BLOCKS)
  for (let a = Math.floor(x0 / R); a <= Math.floor((x1 - 1) / R); a++)
    for (let b = Math.floor(z0 / R); b <= Math.floor((z1 - 1) / R); b++) BUILT.add(`${a},${b}`);
const BUILT_CELLS = [...BUILT].map((k) => k.split(',').map(Number));

// For each city cell (across from the middle one) with any building near
// it, the blocks that reach into the air it answers for (its plaza piece,
// see plaza): only those are asked about. A block further off is further
// off than the piece's sides, so says nothing the piece does not.
const NEAR = new Map();
BLOCKS.forEach(([x0, y0, z0, x1, y1, z1], k) => {
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

// The buildings' faces are not left flat: at the next level (CITY + 1, whose
// cells are the units the blocks are measured in), each face of a cell
// wholly in a building that gives onto open air is coffered (three bays by
// three, each with a shallow recess or none, as its hash says), and each
// cell a 45-degree face crosses has steps cut into it. Close up these are
// carved; further off the engine draws them onto the face as texture (see
// detail in shaders.js), so that the faces read as built up of small
// masses, as in Soleri's drawings. Which cells have what is worked out here
// once and kept as a table (a volume, see halls.js), which the shader and
// cellAir both read: in its first channel,
//   FACE  (6 bits from 0: +x, -x, +y, -y, +z, -z): the faces of the cell
//         that are coffered;
//   FRONT (6 bits from 6): the faces across which the next cell's face is
//         coffered (whose recesses run on EXT into this one);
//   STAIR (6 bits from 12): the diagonals the cell is stepped along, 2p + o
//         for the pair of axes p (as diag has them: xy, zy, xz) and o 0 for
//         the diagonal, 1 the other (see stairs);
//   ON    (12 bits from 18): for each of those, whether the next cell along
//         the third axis, below and above, is stepped the same (so the steps
//         run on into it);
// and in its second, NEAR_BIT: some step comes within a cell (a cell of the
// halls then must not say its nearest air is any further than its sides).
const FACE_AT = 0, FRONT_AT = 6, STAIR_AT = 12, ON_AT = 18, NEAR_BIT = 1;
const EXT = 3; // how far a recess runs on out of its face (more than it is deep)
const STEP = 6; // the steps' size, in lattice units
const THIRD = [2, 0, 1]; // the axis a pair of axes leaves out
const PAIRS = [[0, 1], [2, 1], [0, 2]];
const COFFER_SALT = 0x3c6ef372, BAY_SALT = 0x9e3779b9;

// How far outside each plane of a block a point is (negative: inside), with
// the plane's normal, as block() has them, from the point itself.
function planes([x0, y0, z0, x1, y1, z1, kind], [x, y, z]) {
  const r = Math.SQRT1_2, base = y0 + 1, out = [];
  out.push([x0 - x, [-1, 0, 0]], [x - x1, [1, 0, 0]], [y0 - y, [0, -1, 0]], [y - y1, [0, 1, 0]], [z0 - z, [0, 0, -1]], [z - z1, [0, 0, 1]]);
  if (kind === 1 || kind === 3) out.push([(-(x - x0) + (y - base)) * r, [-r, r, 0]], [(x - x1 + (y - base)) * r, [r, r, 0]]);
  if (kind === 2 || kind === 3) out.push([(-(z - z0) + (y - base)) * r, [0, r, -r]], [(z - z1 + (y - base)) * r, [0, r, r]]);
  if (kind === 5)
    out.push([(-(x - x0) - (y - y1)) * r, [-r, -r, 0]], [(x - x1 - (y - y1)) * r, [r, -r, 0]],
             [(-(z - z0) - (y - y1)) * r, [0, -r, -r]], [(z - z1 - (y - y1)) * r, [0, -r, r]]);
  if (kind === 4) {
    const c = Math.floor(Math.min(x1 - x0, z1 - z0) / 4);
    out.push([(-(x - x0) - (z - z0) + c) * r, [-r, 0, -r]], [(x - x1 - (z - z0) + c) * r, [r, 0, -r]],
             [(-(x - x0) + (z - z1) + c) * r, [-r, 0, r]], [(x - x1 + (z - z1) + c) * r, [r, 0, r]]);
  }
  return out;
}
const inBlock = (b, q) => planes(b, q).every(([d]) => d < 0);

export const VOLUME = (() => {
  const lo = [Infinity, 0, Infinity], hi = [-Infinity, TOP + 2, -Infinity];
  for (const b of BLOCKS) for (const a of [0, 2]) (lo[a] = Math.min(lo[a], b[a] - 2)), (hi[a] = Math.max(hi[a], b[a + 3] + 2));
  const size = hi.map((h, a) => h - lo[a]);
  const n = size[0] * size[1] * size[2];
  const at = ([x, y, z]) => x + size[0] * (y + size[1] * z);
  const within = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
  // Each cell: wholly inside one block (solid at the city's level all
  // through), or wholly clear of them all (and over the plaza's floor).
  // (A plane's distance at the middle, against how far the cell reaches
  // across it.)
  const deep = new Uint8Array(n), open = new Uint8Array(n);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const q = [x + lo[0] + 0.5, y + lo[1] + 0.5, z + lo[2] + 0.5];
    let clear = true;
    for (const b of BLOCKS) {
      const ps = planes(b, q), reach = (nn) => 0.5 * (Math.abs(nn[0]) + Math.abs(nn[1]) + Math.abs(nn[2]));
      if (ps.every(([d, nn]) => d <= -reach(nn))) deep[at([x, y, z])] = 1;
      if (!ps.some(([d, nn]) => d >= reach(nn))) clear = false;
    }
    if (clear && q[1] >= G) open[at([x, y, z])] = 1;
  }
  const data = new Uint32Array(2 * n);
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Coffered faces: of a cell wholly in a building, onto one wholly clear.
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = [x, y, z];
    if (!deep[at(v)]) continue;
    sides.forEach((e, k) => {
      const u = v.map((q, a) => q + e[a]);
      if (!within(u) || !open[at(u)]) return;
      data[2 * at(v)] |= 1 << (FACE_AT + k);
      data[2 * at(u)] |= 1 << (FRONT_AT + (k ^ 1));
    });
  }
  // Stepped cells: a 45-degree face runs exactly along one of the cell's
  // diagonals (the blocks' corners are on the lattice), with one side of it
  // inside a single block and the other clear of every block (and the cell
  // over the plaza's floor). Seen at points either side of the diagonal, a
  // little off it.
  const stepped = (v, p, o) => {
    const [a, b] = PAIRS[p], c = THIRD[p], base = v.map((q, k) => q + lo[k]);
    if (base[1] < G) return false;
    const seen = [new Set(), new Set()]; // each side: the block it is in (-1 none, -2 several)
    for (const [h, s] of [[0, 1], [1, -1]]) for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      // Along the diagonal (t), off it (off), across (w).
      const t = (i + 0.5) / 5, off = 0.1 + 0.15 * j, w = ((i * 3 + j * 7) % 5) / 5 + 0.1;
      const ua = t + (s * off) / 2, ub = o === 0 ? t - (s * off) / 2 : 1 - t + (s * off) / 2;
      if (ua <= 0 || ua >= 1 || ub <= 0 || ub >= 1) continue;
      const q = base.slice();
      (q[a] += ua), (q[b] += ub), (q[c] += w);
      const ins = BLOCKS.flatMap((B, k) => (inBlock(B, q) ? [k] : []));
      seen[h].add(ins.length === 1 ? ins[0] : ins.length ? -2 : -1);
    }
    const one = (S) => S.size === 1 && [...S][0] >= 0, none = (S) => S.size === 1 && S.has(-1);
    return (one(seen[0]) && none(seen[1])) || (none(seen[0]) && one(seen[1]));
  };
  const steps = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = [x, y, z];
    if (deep[at(v)] || open[at(v)]) continue;
    for (let p = 0; p < 3; p++) for (let o = 0; o < 2; o++)
      if (stepped(v, p, o)) (data[2 * at(v)] |= 1 << (STAIR_AT + 2 * p + o)), steps.push(v);
  }
  for (const v of steps) {
    const m = data[2 * at(v)];
    for (let s = 0; s < 6; s++) {
      if (!(m & (1 << (STAIR_AT + s)))) continue;
      const c = THIRD[s >> 1];
      [-1, 1].forEach((side, h) => {
        const u = v.slice();
        u[c] += side;
        if (within(u) && data[2 * at(u)] & (1 << (STAIR_AT + s))) data[2 * at(v)] |= 1 << (ON_AT + 2 * s + h);
      });
    }
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const u = [v[0] + dx, v[1] + dy, v[2] + dz];
      if (within(u)) data[2 * at(u) + 1] = NEAR_BIT;
    }
  }
  for (let i = 0; i < n; i++) data[2 * i] >>>= 0;
  return { lo, size, data, deep, open, at, within, stepped: new Set(steps.map((v) => v.join())).size };
})();

// The ways into the buildings from the plaza, for the tour (see
// Planner.waysFromCity): each a room of the halls one level finer than the
// city's, wholly inside a building, with an opening in one of its walls
// straight out onto open air. As { id, e }: the room's cell's id at that
// level, and the way out of it through the opening.
export const ENTRANCES = (() => {
  const { lo, size, deep, open, at, within } = VOLUME;
  const seed = levelSeed(CITY + 1), out = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = [x, y, z];
    if (!deep[at(v)]) continue;
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

const glsl = /* glsl */ `
const int G = ${G};
const int NB = ${BLOCKS.length};
const ivec3 BLO[NB] = ivec3[NB](${ivecs(BLOCKS.map((b) => b.slice(0, 3)))});
const ivec3 BHI[NB] = ivec3[NB](${ivecs(BLOCKS.map((b) => b.slice(3, 6)))});
const int BKIND[NB] = int[NB](${BLOCKS.map((b) => b[6]).join(', ')});
const int NNEAR = ${NEAR_CELLS.length};
const ivec3 NEAR_CELLS[NNEAR] = ivec3[NNEAR](${ivecs(NEAR_CELLS)});
const int NEAR_START[NNEAR + 1] = int[NNEAR + 1](${NEAR_START.join(', ')});
const int NEAR_BLOCKS[${NEAR_BLOCKS.length}] = int[${NEAR_BLOCKS.length}](${NEAR_BLOCKS.join(', ')});
const int NBUILT = ${BUILT_CELLS.length};
const ivec2 BUILT_CELLS[NBUILT] = ivec2[NBUILT](${BUILT_CELLS.map(([a, b]) => `ivec2(${a}, ${b})`).join(', ')});

const ivec3 VOL_LO = ivec3(${VOLUME.lo.join(', ')});
const ivec3 VOL_SIZE = ivec3(${VOLUME.size.join(', ')});
const int FACE_AT = ${FACE_AT}, FRONT_AT = ${FRONT_AT}, STAIR_AT = ${STAIR_AT}, ON_AT = ${ON_AT}, EXT = ${EXT}, STEP = ${STEP};
const uint NEAR_BIT = ${NEAR_BIT}u, COFFER_SALT = ${COFFER_SALT}u, BAY_SALT = ${BAY_SALT}u;

// Where the middle city cell is from this one, in lattice units.
ivec3 fromMiddle(ivec3 id) {
  return (id - ivec3(${MID}, ${ROW_ID}, ${MID})) * R;
}

// What the table says of the level-(CITY + 1) cell id, in a city cell
// (whose id is up): nothing, if it is not in the table.
uvec2 relief(ivec3 id, ivec3 up) {
  if (up.y < ${ROW_ID} || up.y >= ${ROW_ID + ROWS}) return uvec2(0u);
  ivec3 own = id - R * ivec3(floor((vec3(id) + 0.5) / float(R)));
  ivec3 v = fromMiddle(up) + own - VOL_LO;
  if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) return uvec2(0u);
  return texelFetch(uVolume, v, 0).rg;
}

ivec3 put(ivec3 v, int a, int x) { return a == 0 ? ivec3(x, v.y, v.z) : a == 1 ? ivec3(v.x, x, v.z) : ivec3(v.x, v.y, x); }
int at3(ivec3 v, int a) { return a == 0 ? v.x : a == 1 ? v.y : v.z; }
float at3(vec3 v, int a) { return a == 0 ? v.x : a == 1 ? v.y : v.z; }

// A box of air, lo to hi (lattice units).
float boxAir(ivec3 L, vec3 f, ivec3 lo, ivec3 hi) {
  airPiece();
  airSpan(L.x, f.x, lo.x, hi.x, EX);
  airSpan(L.y, f.y, lo.y, hi.y, EY);
  airSpan(L.z, f.z, lo.z, hi.z, EZ);
  return gD;
}
// The same, united with what is known of the air here so far: its
// distance d, and for a ray (ray), how far on it stays in air (reach, nrm).
float unite(ivec3 L, vec3 f, ivec3 lo, ivec3 hi, float d, bool ray, inout float reach, inout vec3 nrm) {
  gRay = false;
  float g = boxAir(L, f, lo, hi);
  if (ray && g + gO <= 0.0) {
    gRay = true;
    boxAir(L, f, lo, hi);
    gRay = false;
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  return min(d, g);
}

// The recess, if any, in the bay of the coffered face k (+x, -x, +y, ...)
// of the cell sid that the point is across from, as a box in this cell's
// lattice units; the face being on this cell's side k, and the cell sid
// this one (inward -1) or the next one across it (inward 1). Its depth is
// 0 (none), 1 or 2, as the hash of its cell, face and bay says, and it runs
// EXT on out of the face. Returns how far off any of the face's recesses
// is, at least (none is nearer than the edge of the bay we are across from,
// and one more; nor than the layer they are in).
float coffer(ivec3 L, vec3 f, int k, ivec3 sid, int face, int inward, uint seed, float d, bool ray, inout float reach, inout vec3 nrm) {
  int a = k >> 1, b = a == 0 ? 1 : 0, c = a == 2 ? 1 : 2;
  int plane = (k & 1) == 0 ? R : 0, side = (k & 1) == 0 ? 1 : -1;
  float pb = float(at3(L, b)) + at3(f, b), pc = float(at3(L, c)) + at3(f, c);
  int i = clamp(int(floor((pb - 3.0) / 6.0)), 0, 2), j = clamp(int(floor((pc - 3.0) / 6.0)), 0, 2);
  float thin = 0.25 + 0.4 * h01(hashCell(sid, seed ^ (COFFER_SALT + uint(face) * 0x85ebca6bu)));
  float t = h01(hashCell(sid, seed ^ (COFFER_SALT + uint(face * 9 + i * 3 + j) * BAY_SALT)));
  // Into the cell sid: across the plane from this cell (side), or back (if
  // sid is this cell). The recesses are all in the layer from 2 into it to
  // EXT out of it; and none is nearer than the edges of our bay, and one.
  int into = inward > 0 ? side : -side;
  float x = float(at3(L, a)) + at3(f, a);
  float layer = max(float(min(plane + into * 2, plane - into * EXT)) - x, x - float(max(plane + into * 2, plane - into * EXT)));
  float eb = min(i > 0 ? pb - float(3 + 6 * i) : 1e9, i < 2 ? float(9 + 6 * i) - pb : 1e9);
  float ec = min(j > 0 ? pc - float(3 + 6 * j) : 1e9, j < 2 ? float(9 + 6 * j) - pc : 1e9);
  float cap = max(layer, min(eb, ec) + 1.0);
  if (t < thin) return min(d, cap);
  int depth = (t - thin) / (1.0 - thin) < 0.5 ? 1 : 2;
  int n0 = min(plane + into * depth, plane - into * EXT), n1 = max(plane + into * depth, plane - into * EXT);
  ivec3 bl = put(put(put(ivec3(0), a, n0), b, 4 + 6 * i), c, 4 + 6 * j);
  ivec3 bh = put(put(put(ivec3(0), a, n1), b, 8 + 6 * i), c, 8 + 6 * j);
  return min(unite(L, f, bl, bh, d, ray, reach, nrm), cap);
}

// The steps cut along diagonal s (see STAIR_AT) of this cell: squares of
// STEP down it, each a box across the cell along the third axis (and on a
// unit into the next cell where it is stepped the same, on: below, above).
float stairs(ivec3 L, vec3 f, int s, uint on, float d, bool ray, inout float reach, inout vec3 nrm) {
  int p = s >> 1, a = p == 1 ? 2 : 0, b = p == 2 ? 2 : 1, c = p == 0 ? 2 : p == 1 ? 0 : 1;
  int c0 = (on & 1u) != 0u ? -1 : 0, c1 = (on & 2u) != 0u ? R + 1 : R;
  for (int k = 0; k < R / STEP; k++) {
    int b0 = (s & 1) == 0 ? STEP * k : R - STEP * (k + 1);
    ivec3 lo = put(put(put(ivec3(0), a, STEP * k), b, b0), c, c0);
    ivec3 hi = put(put(put(ivec3(0), a, STEP * (k + 1)), b, b0 + STEP), c, c1);
    d = unite(L, f, lo, hi, d, ray, reach, nrm);
  }
  return d;
}

// A level-(CITY + 1) cell the table says something of: the halls' air in it
// (d, reach and nrm being what the halls say of it), with the recesses of
// its own coffered faces and the next cells', and its steps.
float reliefCell(ivec3 L, vec3 f, ivec3 id, uint seed, uvec2 m, float d, inout float reach, inout vec3 nrm) {
  bool ray = gRay;
  for (int k = 0; k < 6; k++) {
    ivec3 e = put(ivec3(0), k >> 1, (k & 1) == 0 ? 1 : -1);
    if ((m.x & (1u << uint(FACE_AT + k))) != 0u) d = coffer(L, f, k, id, k, -1, seed, d, ray, reach, nrm);
    if ((m.x & (1u << uint(FRONT_AT + k))) != 0u) d = coffer(L, f, k, wrapId(id + e), k ^ 1, 1, seed, d, ray, reach, nrm);
    if ((m.x & (1u << uint(STAIR_AT + k))) != 0u) d = stairs(L, f, k, (m.x >> uint(ON_AT + 2 * k)) & 3u, d, ray, reach, nrm);
  }
  gRay = ray;
  if (d <= 0.0 || (m.y & NEAR_BIT) == 0u) return d;
  float e = min(min(min(float(R - L.x) - f.x, float(L.x) + f.x), min(float(R - L.y) - f.y, float(L.y) + f.y)),
                min(float(R - L.z) - f.z, float(L.z) + f.z));
  return min(d, e);
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

// One block, its corners lo and hi in this cell's lattice units.
float block(ivec3 L, vec3 f, ivec3 lo, ivec3 hi, int kind) {
  solidPiece();
  solidSpan(L.x, f.x, lo.x, hi.x, EX);
  solidSpan(L.z, f.z, lo.z, hi.z, EZ);
  solidSpan(L.y, f.y, lo.y, hi.y, EY);
  int base = lo.y + 1;
  if (kind == 1 || kind == 3) {
    solidPlane(diag(0, -1, 1, lo.x, base, 0) * 0.70710678, vec3(-0.70710678, 0.70710678, 0.0));
    solidPlane(diag(0, 1, 1, hi.x, base, 0) * 0.70710678, vec3(0.70710678, 0.70710678, 0.0));
  }
  if (kind == 2 || kind == 3) {
    solidPlane(diag(1, -1, 1, lo.z, base, 0) * 0.70710678, vec3(0.0, 0.70710678, -0.70710678));
    solidPlane(diag(1, 1, 1, hi.z, base, 0) * 0.70710678, vec3(0.0, 0.70710678, 0.70710678));
  }
  if (kind == 5) {
    solidPlane(diag(0, -1, -1, lo.x, hi.y, 0) * 0.70710678, vec3(-0.70710678, -0.70710678, 0.0));
    solidPlane(diag(0, 1, -1, hi.x, hi.y, 0) * 0.70710678, vec3(0.70710678, -0.70710678, 0.0));
    solidPlane(diag(1, -1, -1, lo.z, hi.y, 0) * 0.70710678, vec3(0.0, -0.70710678, -0.70710678));
    solidPlane(diag(1, 1, -1, hi.z, hi.y, 0) * 0.70710678, vec3(0.0, -0.70710678, 0.70710678));
  }
  if (kind == 4) {
    int c = min(hi.x - lo.x, hi.z - lo.z) / 4;
    solidPlane(diag(2, -1, -1, lo.x, lo.z, -c) * 0.70710678, vec3(-0.70710678, 0.0, -0.70710678));
    solidPlane(diag(2, 1, -1, hi.x, lo.z, -c) * 0.70710678, vec3(0.70710678, 0.0, -0.70710678));
    solidPlane(diag(2, -1, 1, lo.x, hi.z, -c) * 0.70710678, vec3(-0.70710678, 0.0, 0.70710678));
    solidPlane(diag(2, 1, 1, hi.x, hi.z, -c) * 0.70710678, vec3(0.70710678, 0.0, 0.70710678));
  }
  return solidDone();
}

// The air over the plaza, less the buildings: the distance to the nearest
// (and, for a ray, where it strikes one, if before it leaves this piece of
// air). The piece runs a cell past this one's sides each way (so that it
// does not seem to close in at every one; narrower, rays far off crossed
// so many pieces that they ran out of steps), and the blocks asked about
// are all that reach into it (see NEAR).
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
    ivec3 lo = BLO[k] - o, hi = BHI[k] - o;
    // (A block further off than one already found, or than a ray goes in
    // this piece, is not asked about.)
    vec3 off = max(vec3(lo) - q, q - vec3(hi));
    float far = max(max(off.x, off.y), off.z);
    if (far >= d && (!gRay || far >= gX)) continue;
    d = min(d, block(L, f, lo, hi, BKIND[k]));
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
  if (level == ${CITY + 1}) {
    uvec2 m = relief(id, gUp);
    if (m != uvec2(0u)) {
      float d = hallsCell(L, f, id, seed, reach, nrm);
      return reliefCell(L, f, id, seed, m, d, reach, nrm);
    }
  }
  // Over the city there is only sky, and the city's air comes right up to
  // the cells above it: all a cell up there can say is how far down it is.
  if (level == ${CITY} && id.y >= ${ROW_ID + ROWS} && id.y <= ${ROW_ID + ABOVE}) {
    reach = -1.0;
    nrm = vec3(0.0);
    return float(L.y + R * (id.y - ${ROW_ID + ROWS})) + f.y;
  }
  return hallsCell(L, f, id, seed, reach, nrm);
}
`;

// The same, in JavaScript, piece for piece (as in halls.js: a plane is only
// its distance).
const h01 = (h) => (h >>> 8) / 16777216;
let dLp, dFp, dLm, dFm;
const diag = (p, sa, sb, ca, cb, k) =>
  sa === sb ? sa * (dLp[p] - ca - cb) - k + sa * dFp[p] : sa * (dLm[p] - ca + cb) - k + sa * dFm[p];
let gD;
const piece = () => (gD = -Infinity);
const plane = (s) => (gD = Math.max(gD, s));
const span = (x, f, x0, x1) => (plane(x0 - x - f), plane(x - x1 + f));
const NONE = 1e9;

const fromMiddle = (id) => [(id[0] - MID) * R, (id[1] - ROW_ID) * R, (id[2] - MID) * R];

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

function block(L, f, lo, hi, kind) {
  piece();
  span(L[0], f[0], lo[0], hi[0]);
  span(L[2], f[2], lo[2], hi[2]);
  span(L[1], f[1], lo[1], hi[1]);
  const base = lo[1] + 1;
  if (kind === 1 || kind === 3) {
    plane(diag(0, -1, 1, lo[0], base, 0) * Math.SQRT1_2);
    plane(diag(0, 1, 1, hi[0], base, 0) * Math.SQRT1_2);
  }
  if (kind === 2 || kind === 3) {
    plane(diag(1, -1, 1, lo[2], base, 0) * Math.SQRT1_2);
    plane(diag(1, 1, 1, hi[2], base, 0) * Math.SQRT1_2);
  }
  if (kind === 5) {
    plane(diag(0, -1, -1, lo[0], hi[1], 0) * Math.SQRT1_2);
    plane(diag(0, 1, -1, hi[0], hi[1], 0) * Math.SQRT1_2);
    plane(diag(1, -1, -1, lo[2], hi[1], 0) * Math.SQRT1_2);
    plane(diag(1, 1, -1, hi[2], hi[1], 0) * Math.SQRT1_2);
  }
  if (kind === 4) {
    const c = Math.floor(Math.min(hi[0] - lo[0], hi[2] - lo[2]) / 4);
    plane(diag(2, -1, -1, lo[0], lo[2], -c) * Math.SQRT1_2);
    plane(diag(2, 1, -1, hi[0], lo[2], -c) * Math.SQRT1_2);
    plane(diag(2, -1, 1, lo[0], hi[2], -c) * Math.SQRT1_2);
    plane(diag(2, 1, 1, hi[0], hi[2], -c) * Math.SQRT1_2);
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
  for (const k of NEAR.get(o.map((x) => x / R).join()) ?? []) {
    const b = BLOCKS[k];
    d = Math.min(d, block(L, f, b.slice(0, 3).map((x, a) => x - o[a]), b.slice(3, 6).map((x, a) => x - o[a]), b[6]));
  }
  return Math.max(box, -d);
}

function relief(id, up) {
  if (!up || up[1] < ROW_ID || up[1] >= ROW_ID + ROWS) return [0, 0];
  const o = fromMiddle(up), v = [0, 1, 2].map((a) => o[a] + (((id[a] % R) + R) % R) - VOLUME.lo[a]);
  if (v.some((x, a) => x < 0 || x >= VOLUME.size[a])) return [0, 0];
  const i = 2 * (v[0] + VOLUME.size[0] * (v[1] + VOLUME.size[1] * v[2]));
  return [VOLUME.data[i], VOLUME.data[i + 1]];
}

const boxAir = (L, f, lo, hi) => (piece(), [0, 1, 2].forEach((a) => span(L[a], f[a], lo[a], hi[a])), gD);
const put = (a, x, b, y, c, z) => {
  const v = [0, 0, 0];
  (v[a] = x), (v[b] = y), (v[c] = z);
  return v;
};

function coffer(L, f, k, sid, face, inward, seed, d) {
  const a = k >> 1, b = a === 0 ? 1 : 0, c = a === 2 ? 1 : 2;
  const plane = k & 1 ? 0 : R, side = k & 1 ? -1 : 1;
  const pb = L[b] + f[b], pc = L[c] + f[c];
  const i = Math.max(0, Math.min(2, Math.floor((pb - 3) / 6))), j = Math.max(0, Math.min(2, Math.floor((pc - 3) / 6)));
  const thin = 0.25 + 0.4 * h01(hashCell(sid, (seed ^ ((COFFER_SALT + Math.imul(face, 0x85ebca6b)) >>> 0)) >>> 0));
  const t = h01(hashCell(sid, (seed ^ ((COFFER_SALT + Math.imul(face * 9 + i * 3 + j, BAY_SALT)) >>> 0)) >>> 0));
  const into = inward > 0 ? side : -side;
  const x = L[a] + f[a];
  const layer = Math.max(Math.min(plane + into * 2, plane - into * EXT) - x, x - Math.max(plane + into * 2, plane - into * EXT));
  const eb = Math.min(i > 0 ? pb - (3 + 6 * i) : 1e9, i < 2 ? 9 + 6 * i - pb : 1e9);
  const ec = Math.min(j > 0 ? pc - (3 + 6 * j) : 1e9, j < 2 ? 9 + 6 * j - pc : 1e9);
  const cap = Math.max(layer, Math.min(eb, ec) + 1);
  if (t < thin) return Math.min(d, cap);
  const depth = (t - thin) / (1 - thin) < 0.5 ? 1 : 2;
  const n0 = Math.min(plane + into * depth, plane - into * EXT), n1 = Math.max(plane + into * depth, plane - into * EXT);
  return Math.min(d, boxAir(L, f, put(a, n0, b, 4 + 6 * i, c, 4 + 6 * j), put(a, n1, b, 8 + 6 * i, c, 8 + 6 * j)), cap);
}

function stairs(L, f, s, on, d) {
  const p = s >> 1, [a, b] = PAIRS[p], c = THIRD[p];
  const c0 = on & 1 ? -1 : 0, c1 = on & 2 ? R + 1 : R;
  for (let k = 0; k < R / STEP; k++) {
    const b0 = s & 1 ? R - STEP * (k + 1) : STEP * k;
    d = Math.min(d, boxAir(L, f, put(a, STEP * k, b, b0, c, c0), put(a, STEP * (k + 1), b, b0 + STEP, c, c1)));
  }
  return d;
}

function reliefCell(L, f, id, seed, [m, near], d) {
  for (let k = 0; k < 6; k++) {
    const e = [0, 0, 0];
    e[k >> 1] = k & 1 ? -1 : 1;
    if (m & (1 << (FACE_AT + k))) d = coffer(L, f, k, id, k, -1, seed, d);
    if (m & (1 << (FRONT_AT + k))) d = coffer(L, f, k, wrapId(id.map((x, a) => x + e[a])), k ^ 1, 1, seed, d);
    if (m & (1 << (STAIR_AT + k))) d = stairs(L, f, k, (m >>> (ON_AT + 2 * k)) & 3, d);
  }
  if (d <= 0 || !(near & NEAR_BIT)) return d;
  return Math.min(d, R - L[0] - f[0], L[0] + f[0], R - L[1] - f[1], L[1] + f[1], R - L[2] - f[2], L[2] + f[2]);
}

function cellAir(L, f, id, seed, dg, level, up) {
  if (level < CITY) return NONE;
  if (level === CITY + 1) {
    const m = relief(id, up);
    if (m[0] || m[1]) return reliefCell(L, f, id, seed, m, hallsAir(L, f, id, seed, dg));
  }
  if (level === CITY && id[1] >= ROW_ID + ROWS && id[1] <= ROW_ID + ABOVE) return L[1] + R * (id[1] - ROW_ID - ROWS) + f[1];
  if (level !== CITY || id[1] < ROW_ID || id[1] >= ROW_ID + ROWS) return hallsAir(L, f, id, seed, dg);
  if (dg) ({ Lp: dLp, fp: dFp, Lm: dLm, fm: dFm } = dg);
  else {
    const pairs = [[0, 1], [2, 1], [0, 2]];
    dLp = pairs.map(([a, b]) => L[a] + L[b]);
    dFp = pairs.map(([a, b]) => f[a] + f[b]);
    dLm = pairs.map(([a, b]) => L[a] - L[b]);
    dFm = pairs.map(([a, b]) => f[a] - f[b]);
  }
  return Math.min(plaza(L, f, id), id[1] === ROW_ID ? well(L, f, id, seed) : NONE);
}

// Where a first visit starts, in the middle city cell (lattice units): on
// the plaza, under the great hexahedron, wherever its shafts leave room.
const START = (() => {
  for (let r = 0; r < R; r++)
    for (let x = C - r; x <= C + r; x++)
      for (const z of [C - r, C + r]) {
        if (x < 0 || z < 0 || x >= R || z >= R) continue;
        if (BLOCKS.every(([x0, y0, z0, x1, , z1]) => y0 > G + 2 || x + 1 <= x0 - 1 || x >= x1 + 1 || z + 1 <= z0 - 1 || z >= z1 + 1)) return [x, z];
      }
  return [C, C];
})();

const arcology = {
  ...halls,
  name: 'arcology',
  glsl: hallsGlsl + glsl,
  cellAir,
  volume: VOLUME,
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
  // Nothing stands higher than the tallest building (in level-0 cells).
  skyClear: (ROWS * R - Math.max(...BLOCKS.map((b) => b[4]))) * Math.pow(R, -1 - CITY),
  // Sunlight comes down into it as far as the plaza (in level-0 cells).
  sunReach: (ROWS * R - G) * Math.pow(R, -1 - CITY),
};
export default arcology;
