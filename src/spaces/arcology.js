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

// The buildings' faces are not left flat: galleries are cut into them, at
// the next level (CITY + 1, whose cells are the units the blocks are
// measured in), so that the sides of the terraces, the waist and the crown
// read as built up of smaller masses, as in Soleri's drawings. Each gallery
// is a box of whole cells (one to four wide, one or two high, one to three
// deep), open to the plaza on its front and solid everywhere else; no two
// come within a cell of each other. Which, is worked out here once and kept
// as a table (a volume, see halls.js), which the shader and cellAir both
// read.
//
// A gallery is one piece of air, running EXT on out of its front into the
// open air there, so that it is still open however far off it is seen (the
// engine shrinks air with distance; see halls.js). Every cell that piece
// reaches into (the gallery's own, and those in front of it) says the same
// of it, as the rules for pieces that cross from one cell to the next ask.
// Each such cell holds, in the table's first channel: the gallery's extent
// in cells from it, for each axis its lowest and highest cell (4 bits each,
// less 8: x low, x high, y low, ...); which of its faces is open (from bit
// OPEN_AT: +x, -x, +y, -y, +z, -z); whether the cell has a gallery's air
// in it (PIECE), and whether that is all there is (TAKEN: the gallery's own
// cells). The second channel says whether a gallery's air comes within a
// cell (NEAR): a cell of the halls then must not say its nearest air is
// any further than its own sides.
const OPEN_AT = 24, PIECE = 1 << 30, TAKEN = 1 << 31, NEAR_BIT = 1;
const EXT = 8; // more than the most the engine shrinks air by (close * R)

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
  let s = 0x7f4a7c15;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  // Galleries, tried at random places on the faces of the buildings. Each
  // is all in solid that is wholly the buildings'; across each of its faces
  // is either solid of that kind all along, or open air all along (it is
  // open that way, and its air runs EXT on into that); it is open on its
  // front at least; and it keeps a cell clear of every other (none touches
  // another).
  const kept = new Uint8Array(n);
  const boxes = [];
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const cellsOf = (b0, b1) => {
    const out = [];
    for (let x = b0[0]; x <= b1[0]; x++) for (let y = b0[1]; y <= b1[1]; y++) for (let z = b0[2]; z <= b1[2]; z++) out.push([x, y, z]);
    return out;
  };
  // (Every cell of open air before a face of solid, in no particular
  // order, each tried a few ways.)
  const spots = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++)
    for (const e of sides) {
      const o = [x, y, z], i = o.map((v, a) => v + e[a]);
      if (open[at(o)] && within(i) && deep[at(i)]) spots.push([o, e]);
    }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = int(0, i);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  for (const [o, e] of spots.flatMap((x) => [x, x, x])) {
    // e into the building, t across its face.
    const t = e[0] ? [0, 0, 1] : [1, 0, 0];
    const w = int(1, 4), h = int(1, 2), d = int(1, 3), u0 = -int(0, w - 1), y0 = -int(0, h - 1);
    const ends = [[u0, y0, 1], [u0 + w - 1, y0 + h - 1, d]].map(([i, j, k]) => [0, 1, 2].map((a) => o[a] + t[a] * i + (a === 1 ? j : 0) + e[a] * k));
    const b0 = [0, 1, 2].map((a) => Math.min(ends[0][a], ends[1][a])), b1 = [0, 1, 2].map((a) => Math.max(ends[0][a], ends[1][a]));
    const cells = cellsOf(b0, b1);
    if (!cells.every((c) => within(c) && deep[at(c)] && c[1] + lo[1] >= G && !kept[at(c)])) continue;
    // Each face: open all along, or solid all along.
    const front = e[0] ? (e[0] > 0 ? 1 : 0) : e[2] > 0 ? 5 : 4;
    const opens = [];
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) for (const side of [1, -1]) {
      const f0 = b0.slice(), f1 = b1.slice();
      f0[a] = f1[a] = side > 0 ? b1[a] + 1 : b0[a] - 1;
      const across = cellsOf(f0, f1);
      if (!across.every(within)) { ok = false; break; }
      // (Open only on its front, top or bottom: across its back and its
      // sides it is all solid, so that it never cuts through a shaft or
      // round a corner.)
      const way = 2 * a + (side > 0 ? 0 : 1);
      if ((a === 1 || way === front) && across.every((c) => open[at(c)])) opens.push(way);
      else if (!across.every((c) => deep[at(c)])) { ok = false; break; }
    }
    if (!ok || !opens.includes(front)) continue;
    // The cells its air reaches into, past its open faces (all must be
    // open air, none kept clear for another).
    const x0 = b0.slice(), x1 = b1.slice();
    for (const way of opens) (way & 1 ? (x0[way >> 1] -= 1) : (x1[way >> 1] += 1));
    const before = cellsOf(x0, x1).filter((c) => c.some((v, a) => v < b0[a] || v > b1[a]));
    if (!before.every((c) => within(c) && open[at(c)] && !kept[at(c)])) continue;
    for (const c of [...cells, ...before]) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const m = [c[0] + dx, c[1] + dy, c[2] + dz];
      if (within(m)) kept[at(m)] = 1;
    }
    boxes.push({ cells, front: before, lo: b0, hi: b1, opens });
  }
  const data = new Uint32Array(2 * n);
  for (const { cells, front, lo: bl, hi: bh, opens } of boxes) {
    const say = (c, taken) => {
      let v = PIECE | (taken ? TAKEN : 0);
      for (const way of opens) v |= 1 << (OPEN_AT + way);
      for (let a = 0; a < 3; a++) v |= ((bl[a] - c[a] + 8) << (8 * a)) | ((bh[a] - c[a] + 8) << (8 * a + 4));
      data[2 * at(c)] = v >>> 0;
    };
    for (const c of cells) say(c, true);
    for (const c of front) say(c, false);
    for (const c of [...cells, ...front]) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const m = [c[0] + dx, c[1] + dy, c[2] + dz];
      if (within(m)) data[2 * at(m) + 1] = NEAR_BIT;
    }
  }
  return { lo, size, data, galleries: boxes.length, deep, open, at, within };
})();

// Whether the level-(CITY + 1) cell id is one of a gallery's (as near the
// middle city cell as ids tell apart).
function galleryAt(id) {
  const { lo, data, at, within } = VOLUME, P = R * R;
  const v = id.map((x, a) => ((((x - R * (a === 1 ? ROW : C) - lo[a]) % P) + P) % P));
  return within(v) && (data[2 * at(v)] & TAKEN) !== 0;
}

// The ways into the buildings from the plaza, for the tour (see
// Planner.waysFromCity): each a room of the halls one level finer than the
// city's, wholly inside a building, with an opening in one of its walls
// straight out onto open air. As { id, e }: the room's cell's id at that
// level, and the way out of it through the opening.
export const ENTRANCES = (() => {
  const { lo, size, deep, open, data, at, within } = VOLUME;
  const seed = levelSeed(CITY + 1), out = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = [x, y, z];
    if (!deep[at(v)] || data[2 * at(v)] & TAKEN) continue;
    const id = wrapId([x + lo[0] + R * C, y + lo[1] + R * ROW, z + lo[2] + R * C]);
    if (!hallsRoom(id, seed)) continue;
    for (const o of hallsOpenings(id, seed)) {
      if (o.e[1] !== 0) continue;
      const u = v.map((q, a) => q + o.e[a]);
      if (within(u) && open[at(u)] && !(data[2 * at(u)] & PIECE)) out.push({ id, e: o.e, at: o.at });
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
const int OPEN_AT = ${OPEN_AT}, EXT = ${EXT};
const uint PIECE = ${PIECE >>> 0}u, TAKEN = ${TAKEN >>> 0}u, NEAR_BIT = ${NEAR_BIT}u;

// Where the middle city cell is from this one, in lattice units.
ivec3 fromMiddle(ivec3 id) {
  return (id - ivec3(${MID}, ${ROW_ID}, ${MID})) * R;
}

// What the table says of the level-(CITY + 1) cell id, in a city cell
// (whose id is up): nothing, if it is not in the table.
uvec2 gallery(ivec3 id, ivec3 up) {
  if (up.y < ${ROW_ID} || up.y >= ${ROW_ID + ROWS}) return uvec2(0u);
  ivec3 own = id - R * ivec3(floor((vec3(id) + 0.5) / float(R)));
  ivec3 v = fromMiddle(up) + own - VOL_LO;
  if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) return uvec2(0u);
  return texelFetch(uVolume, v, 0).rg;
}

// The gallery whose air is in this cell (m, from the table): one box.
float galleryAir(ivec3 L, vec3 f, uint m) {
  airPiece();
  for (int a = 0; a < 3; a++) {
    int lo = (int((m >> uint(8 * a)) & 15u) - 8) * R - (((m >> uint(OPEN_AT + 2 * a + 1)) & 1u) == 1u ? EXT : 0);
    int hi = (int((m >> uint(8 * a + 4)) & 15u) - 7) * R + (((m >> uint(OPEN_AT + 2 * a)) & 1u) == 1u ? EXT : 0);
    airSpan(a == 0 ? L.x : a == 1 ? L.y : L.z, a == 0 ? f.x : a == 1 ? f.y : f.z, lo, hi, a == 0 ? EX : a == 1 ? EY : EZ);
  }
  return gD;
}

// A level-(CITY + 1) cell the table says something of: a gallery's own
// (all air, the gallery's), or one of the halls with a gallery's air in it
// or near it (d, reach and nrm being what the halls say of it).
float galleryCell(ivec3 L, vec3 f, uvec2 m, float d, inout float reach, inout vec3 nrm) {
  bool ray = gRay;
  if ((m.x & PIECE) != 0u) {
    gRay = false;
    float g = galleryAir(L, f, m.x);
    if (ray && g + gO <= 0.0) {
      gRay = true;
      galleryAir(L, f, m.x);
      if (gX > reach) { reach = gX; nrm = gN; }
    }
    gRay = ray;
    d = (m.x & TAKEN) != 0u ? g : min(d, g);
  }
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
    uvec2 m = gallery(id, gUp);
    if ((m.x & TAKEN) != 0u) {
      reach = -1.0;
      nrm = vec3(0.0);
      return galleryCell(L, f, m, 1e9, reach, nrm);
    }
    if (m != uvec2(0u)) {
      float d = hallsCell(L, f, id, seed, reach, nrm);
      return galleryCell(L, f, m, d, reach, nrm);
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

function gallery(id, up) {
  if (!up || up[1] < ROW_ID || up[1] >= ROW_ID + ROWS) return [0, 0];
  const o = fromMiddle(up), v = [0, 1, 2].map((a) => o[a] + (((id[a] % R) + R) % R) - VOLUME.lo[a]);
  if (v.some((x, a) => x < 0 || x >= VOLUME.size[a])) return [0, 0];
  const i = 2 * (v[0] + VOLUME.size[0] * (v[1] + VOLUME.size[1] * v[2]));
  return [VOLUME.data[i], VOLUME.data[i + 1]];
}

function galleryCell(L, f, [m, near], d) {
  if (m & PIECE) {
    piece();
    for (let a = 0; a < 3; a++) {
      const lo = (((m >>> (8 * a)) & 15) - 8) * R - ((m >>> (OPEN_AT + 2 * a + 1)) & 1 ? EXT : 0);
      const hi = (((m >>> (8 * a + 4)) & 15) - 7) * R + ((m >>> (OPEN_AT + 2 * a)) & 1 ? EXT : 0);
      span(L[a], f[a], lo, hi);
    }
    d = m & TAKEN ? gD : Math.min(d, gD);
  }
  if (d <= 0 || !(near & NEAR_BIT)) return d;
  return Math.min(d, R - L[0] - f[0], L[0] + f[0], R - L[1] - f[1], L[1] + f[1], R - L[2] - f[2], L[2] + f[2]);
}

function cellAir(L, f, id, seed, dg, level, up) {
  if (level < CITY) return NONE;
  if (level === CITY + 1) {
    const m = gallery(id, up);
    if (m[0] & TAKEN) return galleryCell(L, f, m, NONE);
    if (m[0] || m[1]) return galleryCell(L, f, m, hallsAir(L, f, id, seed, dg));
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
  // Finer than the city, it is halls, whose ways the tour can plan; but a
  // gallery's cells are not rooms (and from the plaza, the ways in are
  // ENTRANCES).
  planned: (level) => level > CITY,
  notRoom: (level, id) => level === CITY + 1 && galleryAt(id),
  entrances: { level: CITY + 1, list: ENTRANCES },
  // Nothing stands higher than the tallest building (in level-0 cells).
  skyClear: (ROWS * R - Math.max(...BLOCKS.map((b) => b[4]))) * Math.pow(R, -1 - CITY),
  // Sunlight comes down into it as far as the plaza (in level-0 cells).
  sunReach: (ROWS * R - G) * Math.pow(R, -1 - CITY),
};
export default arcology;
