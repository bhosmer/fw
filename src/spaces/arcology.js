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
// A building grows from its footprint: a block, and on it one narrower
// block, or two side by side, or towers at its corners, and so on up, each
// ending perhaps in a roof of 45-degree slopes; some blocks are cut at the
// corners, octagons in plan. Each is a list of blocks, the same for every
// city cell, which asks all of them (they reach across many cells).

import halls, { hallsGlsl, hallsAir, built, R, M } from './halls.js';
import { hashCell, wrapId as wrapIdR } from '../util.js';

const wrapId = (id) => wrapIdR(id, R);
const C = R / 2;
export const CITY = -2; // the city's level
const ROW = 12; // which row of its parent the city's cells are in
const G = M; // the plaza's floor, up from the bottom of a city cell
const TOP = R - 2; // how high anything is built
// Ids are a cell's index in its parent plus R times its parent's in the
// grandparent: the city's row, and the cell in the middle of it, as ids.
export const ROW_ID = ROW + R * C;
const MID = C + R * C;
const ABOVE = 200; // how many rows over the city's are known to be over it

// The buildings, as blocks in city lattice units (level CITY + 1 cells),
// across from the corner of the middle cell: [x0, y0, z0, x1, y1, z1, kind],
// kind 0 a plain block, 1 a gable rising across x (its ridge along z), 2 one
// rising across z, 3 a pyramid, 4 a block cut at its corners. Worked out the
// same every time.
const BLOCKS = [];
{
  let s = 0x2545f491;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const block = (x0, y0, z0, x1, y1, z1, kind = 0) => BLOCKS.push([x0, y0, z0, x1, y1, z1, kind]);

  // A roof on x0..x1, z0..z1 at height y, or none.
  const roof = (x0, z0, x1, z1, y) => {
    const w = x1 - x0, d = z1 - z0;
    if (rnd() < 0.35 || y >= TOP) return;
    const kind = w === d || rnd() < 0.3 ? 3 : w <= d ? 1 : 2;
    const rise = Math.min(Math.floor((kind === 3 ? Math.min(w, d) : kind === 1 ? w : d) / 2), TOP + 1 - y);
    if (rise >= 1) block(x0, y - 1, z0, x1, y + rise, z1, kind);
  };

  // A mass on x0..x1, z0..z1 standing at y, and whatever stands on it.
  const mass = (x0, z0, x1, z1, y, depth) => {
    const w = x1 - x0, d = z1 - z0;
    if (y >= TOP - 1) return;
    const slender = w <= 3 && d <= 3;
    const top = Math.min(y + (slender ? int(4, 9) : depth === 0 ? int(3, 7) : int(2, 5)), TOP);
    block(x0, y - 1, z0, x1, top, z1, w === d && w >= 4 && rnd() < 0.3 ? 4 : 0);
    if (depth >= 3 || w < 3 || d < 3 || top >= TOP - 1) return roof(x0, z0, x1, z1, top);
    const t = rnd();
    if (t < 0.3) {
      // One narrower mass.
      const a = int(1, Math.max(1, Math.floor(w / 4))), b = int(1, Math.max(1, Math.floor(d / 4)));
      mass(x0 + a, z0 + b, x1 - int(1, a), z1 - int(1, b), top, depth + 1);
    } else if (t < 0.65 && Math.max(w, d) >= 6) {
      // Two, side by side along the longer way.
      const along = w >= d, n = along ? w : d, cut = int(2, n - 4), gap = int(0, 1);
      const inset = int(0, 1);
      if (along) {
        mass(x0 + inset, z0 + inset, x0 + cut, z1 - inset, top, depth + 1);
        mass(x0 + cut + gap, z0 + int(0, 1), x1 - inset, z1 - int(0, 1), top, depth + 1);
      } else {
        mass(x0 + inset, z0 + inset, x1 - inset, z0 + cut, top, depth + 1);
        mass(x0 + int(0, 1), z0 + cut + gap, x1 - int(0, 1), z1 - inset, top, depth + 1);
      }
    } else if (t < 0.88 && w >= 6 && d >= 6) {
      // Towers at its corners, and perhaps a lower mass between them.
      const k = int(2, 3);
      for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (rnd() < 0.2) continue;
        const tx = cx ? x1 - k : x0, tz = cz ? z1 - k : z0;
        mass(tx, tz, tx + k, tz + k, top, 2);
      }
      if (rnd() < 0.5 && w - 2 * k >= 2 && d - 2 * k >= 2) mass(x0 + k, z0 + k, x1 - k, z1 - k, top, depth + 2);
    } else roof(x0, z0, x1, z1, top);
  };

  // A handful of footprints round the middle of the plaza, apart.
  const feet = [];
  for (let tries = 0; feet.length < 6 && tries < 400; tries++) {
    const w = int(7, 16), d = int(7, 16);
    const x0 = int(-26, 26 + R - w), z0 = int(-26, 26 + R - d);
    if (feet.every(([a0, b0, a1, b1]) => x0 >= a1 + 4 || x0 + w + 4 <= a0 || z0 >= b1 + 4 || z0 + d + 4 <= b0)) feet.push([x0, z0, x0 + w, z0 + d]);
  }
  for (const [x0, z0, x1, z1] of feet) mass(x0, z0, x1, z1, G, 0);
}

// The city cells, across from the middle one, that any building stands in:
// no light well opens in those (it would come up into a building).
const BUILT = new Set();
for (const [x0, , z0, x1, , z1] of BLOCKS)
  for (let a = Math.floor(x0 / R); a <= Math.floor((x1 - 1) / R); a++)
    for (let b = Math.floor(z0 / R); b <= Math.floor((z1 - 1) / R); b++) BUILT.add(`${a},${b}`);
const BUILT_CELLS = [...BUILT].map((k) => k.split(',').map(Number));

const ivecs = (rows) => rows.map(([x, y, z]) => `ivec3(${x}, ${y}, ${z})`).join(', ');

const glsl = /* glsl */ `
const int G = ${G};
const int NB = ${BLOCKS.length};
const ivec3 BLO[NB] = ivec3[NB](${ivecs(BLOCKS.map((b) => b.slice(0, 3)))});
const ivec3 BHI[NB] = ivec3[NB](${ivecs(BLOCKS.map((b) => b.slice(3, 6)))});
const int BKIND[NB] = int[NB](${BLOCKS.map((b) => b[6]).join(', ')});
const int NBUILT = ${BUILT_CELLS.length};
const ivec2 BUILT_CELLS[NBUILT] = ivec2[NBUILT](${BUILT_CELLS.map(([a, b]) => `ivec2(${a}, ${b})`).join(', ')});

// Where the middle city cell is from this one, in lattice units.
ivec3 fromMiddle(ivec3 id) {
  ivec3 c = id - ivec3(${MID}, ${ROW_ID}, ${MID});
  return ivec3(c.x, 0, c.z) * R;
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
// air). The piece runs a cell past this one's sides each way: every cell
// asks after every building, so nothing stands in it unasked.
float plaza(ivec3 L, vec3 f, ivec3 id) {
  airPiece();
  airSpan(L.x, f.x, -R, 2 * R, EX);
  airSpan(L.z, f.z, -R, 2 * R, EZ);
  airSpan(L.y, f.y, G, R + M, EY);
  float box = gD, d = 1e9;
  vec3 q = vec3(L) + f;
  ivec3 o = fromMiddle(id);
  for (int k = 0; k < NB; k++) {
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
  float w = well(L, f, id, seed);
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
  if (level == ${CITY} && id.y == ${ROW_ID}) return city(L, f, id, seed, reach, nrm);
  // Over the city there is only sky, and the city's air comes right up to
  // the cells above it: all a cell up there can say is how far down it is.
  if (level == ${CITY} && id.y > ${ROW_ID} && id.y <= ${ROW_ID + ABOVE}) {
    reach = -1.0;
    nrm = vec3(0.0);
    return float(L.y + R * (id.y - ${ROW_ID + 1})) + f.y;
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

const fromMiddle = (id) => [(id[0] - MID) * R, 0, (id[2] - MID) * R];

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
  span(L[1], f[1], G, R + M);
  const box = gD;
  const o = fromMiddle(id);
  let d = NONE;
  for (const b of BLOCKS) d = Math.min(d, block(L, f, b.slice(0, 3).map((x, a) => x - o[a]), b.slice(3, 6).map((x, a) => x - o[a]), b[6]));
  return Math.max(box, -d);
}

function cellAir(L, f, id, seed, dg, level) {
  if (level < CITY) return NONE;
  if (level === CITY && id[1] > ROW_ID && id[1] <= ROW_ID + ABOVE) return L[1] + R * (id[1] - ROW_ID - 1) + f[1];
  if (level !== CITY || id[1] !== ROW_ID) return hallsAir(L, f, id, seed, dg);
  if (dg) ({ Lp: dLp, fp: dFp, Lm: dLm, fm: dFm } = dg);
  else {
    const pairs = [[0, 1], [2, 1], [0, 2]];
    dLp = pairs.map(([a, b]) => L[a] + L[b]);
    dFp = pairs.map(([a, b]) => f[a] + f[b]);
    dLm = pairs.map(([a, b]) => L[a] - L[b]);
    dFm = pairs.map(([a, b]) => f[a] - f[b]);
  }
  return Math.min(plaza(L, f, id), well(L, f, id, seed));
}

// Where a first visit starts, in the middle city cell (lattice units): on
// the plaza, at the foot of the buildings, wherever there is room.
const START = (() => {
  for (let r = 0; r < R; r++)
    for (let x = C - r; x <= C + r; x++)
      for (const z of [C - r, C + r]) {
        if (x < 0 || z < 0 || x >= R || z >= R) continue;
        if (BLOCKS.every(([x0, , z0, x1, , z1]) => x + 1 <= x0 - 1 || x >= x1 + 1 || z + 1 <= z0 - 1 || z >= z1 + 1)) return [x, z];
      }
  return [C, C];
})();

const arcology = {
  ...halls,
  name: 'arcology',
  glsl: hallsGlsl + glsl,
  cellAir,
  // A plaza's air reaches up out of its cell, and its longest way runs
  // corner to corner across the cells either side.
  maxInterior: 0.5,
  longestWay: 4.5,

  // On the plaza, in the city's row; coarser than that, all is solid, so
  // anywhere does.
  ancestorDigit(level) {
    if (level > 0) return halls.ancestorDigit(level);
    if (level === 0) return [C, 4, C];
    if (level === CITY + 1) return [START[0], G, START[1]];
    if (level === CITY) return [C, ROW, C];
    return [C, C, C];
  },
  // The sky starts at the top of the city's row: R cells of level CITY + 1
  // above the bottom of the row's cell, which at the defaults is G under it.
  skyPlane(j) {
    return j === CITY + 1 ? R : j > CITY + 1 ? 0 : arcology.ancestorDigit(j)[1];
  },
  // Sunlight comes down into it as far as the plaza (in level-0 cells).
  sunReach: (R - G) * Math.pow(R, -1 - CITY),
};
export default arcology;
