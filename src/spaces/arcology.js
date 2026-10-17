// "Arcology": the halls, built up into a city above the ground.
//
// Every level is halls (see halls.js) but one, the city's: there, one row of
// cells, running on in every direction to the horizon, is a plaza with
// buildings standing on it, open to the sky. The buildings are solid at the
// city's level, so the halls one level finer are their rooms, and their
// faces are the facades of those rooms; under the plaza are more halls,
// whose light wells open up through its floor. Above the city's row there is
// only sky, and the levels coarser than the city's are solid throughout (as
// air, they would swallow parts of it).
//
// A building is a block, perhaps with a narrower one on top, and perhaps a
// roof of 45-degree slopes on whichever is highest. Each cell's is its own,
// as in the halls: the scatter is what the city is.

import halls, { hallsGlsl, hallsAir, built, R, M } from './halls.js';
import { hashCell, wrapId as wrapIdR } from '../util.js';

const wrapId = (id) => wrapIdR(id, R);
const C = R / 2;
export const CITY = -1; // the city's level
const ROW = 12; // which row of its parent the city's cells are in
const G = M; // the plaza's floor, up from the bottom of a city cell
const T = M; // how far buildings keep from a cell's sides
const TOWER_SALT = 0x3b9ac9ff;
// Ids are a cell's index in its parent plus R times its parent's in the
// grandparent: the city's row, as an id.
export const ROW_ID = ROW + R * C;
const ABOVE = 200; // how many rows over the city's are known to be over it

const glsl = /* glsl */ `
const int G = ${G};
const int T = ${T};

// The light well, if any, that the hall below opens up through the plaza:
// halls' own opening through its ceiling, as that hall has it (the two must
// agree), carried on up to the plaza.
float well(ivec3 L, vec3 f, ivec3 id, uint seed) {
  ivec3 below = wrapId(id - ivec3(0, 1, 0));
  uint h = hashCell(below, seed ^ 0x967a889bu);
  float t = h01(h);
  if (t < 0.66 || !(built(below, seed) || built(id, seed))) return 1e9;
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

// The building on the plaza: the distance to it, negative inside.
float building(ivec3 L, vec3 f, uint h) {
  int x0 = T + 3 * int(h % 3u), x1 = R - T - 3 * int((h >> 2) % 3u);
  int z0 = T + 3 * int((h >> 4) % 3u), z1 = R - T - 3 * int((h >> 6) % 3u);
  int top = G + 4 + int((h >> 8) % 13u);
  solidPiece();
  solidSpan(L.x, f.x, x0, x1, EX);
  solidSpan(L.z, f.z, z0, z1, EZ);
  solidSpan(L.y, f.y, G - 1, top, EY);
  float d = solidDone();
  // A narrower block on top.
  if (((h >> 12) & 3u) != 0u && x1 - x0 >= 12 && z1 - z0 >= 12) {
    x0 += 3; x1 -= 3; z0 += 3; z1 -= 3;
    int up = min(top + 3 + int((h >> 14) % 6u), R - 2);
    solidPiece();
    solidSpan(L.x, f.x, x0, x1, EX);
    solidSpan(L.z, f.z, z0, z1, EZ);
    solidSpan(L.y, f.y, top - 1, up, EY);
    d = min(d, solidDone());
    top = up;
  }
  // A roof: a gable, its ridge along the longer way, or a pyramid. Where
  // there is not the height for it to come to a point, it is cut off flat.
  uint roof = (h >> 18) & 3u;
  if (roof >= 2u) {
    bool pyramid = roof == 3u, alongZ = z1 - z0 >= x1 - x0;
    int rise = min((pyramid ? min(x1 - x0, z1 - z0) : alongZ ? x1 - x0 : z1 - z0) / 2, R - 1 - top);
    solidPiece();
    solidSpan(L.x, f.x, x0, x1, EX);
    solidSpan(L.z, f.z, z0, z1, EZ);
    solidSpan(L.y, f.y, top - 1, top + rise, EY);
    if (pyramid || alongZ) {
      solidPlane(diag(0, -1, 1, x0, top, 0) * 0.70710678, vec3(-0.70710678, 0.70710678, 0.0));
      solidPlane(diag(0, 1, 1, x1, top, 0) * 0.70710678, vec3(0.70710678, 0.70710678, 0.0));
    }
    if (pyramid || !alongZ) {
      solidPlane(diag(1, -1, 1, z0, top, 0) * 0.70710678, vec3(0.0, 0.70710678, -0.70710678));
      solidPlane(diag(1, 1, 1, z1, top, 0) * 0.70710678, vec3(0.0, 0.70710678, 0.70710678));
    }
    d = min(d, solidDone());
  }
  return d;
}

// The air over the plaza, less the building. It runs T past the cell's
// sides, where no building comes, so that it does not seem to close in at
// every one.
float plaza(ivec3 L, vec3 f, bool standing, uint h) {
  airPiece();
  airSpan(L.x, f.x, -T, R + T, EX);
  airSpan(L.z, f.z, -T, R + T, EZ);
  airSpan(L.y, f.y, G, R + M, EY);
  float box = gD;
  return standing ? max(box, -building(L, f, h)) : box;
}

// A cell of the city. A building stands only where no well opens.
float city(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {
  reach = -1.0;
  nrm = vec3(0.0);
  bool ray = gRay;
  gRay = false;
  float w = well(L, f, id, seed);
  bool standing = w > 1e8;
  uint h = hashCell(id, seed ^ ${TOWER_SALT}u);
  float p = plaza(L, f, standing, h);
  if (ray && p + gO <= 0.0) {
    gRay = true;
    plaza(L, f, standing, h);
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

function well(L, f, id, seed) {
  const below = wrapId([id[0], id[1] - 1, id[2]]);
  const t = h01(hashCell(below, seed ^ 0x967a889b));
  if (t < 0.66 || !(built(below, seed) || built(id, seed))) return NONE;
  const oculus = t < 0.88;
  const w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
  piece();
  span(L[1], f[1], -M, G + 1);
  span(L[0] - C, f[0], -w, w);
  span(L[2] - C, f[2], -w, w);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plane(diag(2, sx, sz, C, C, dg) * Math.SQRT1_2);
  return gD;
}

function building(L, f, h) {
  let x0 = T + 3 * (h % 3), x1 = R - T - 3 * ((h >>> 2) % 3);
  let z0 = T + 3 * ((h >>> 4) % 3), z1 = R - T - 3 * ((h >>> 6) % 3);
  let top = G + 4 + ((h >>> 8) % 13);
  piece();
  span(L[0], f[0], x0, x1);
  span(L[2], f[2], z0, z1);
  span(L[1], f[1], G - 1, top);
  let d = gD;
  if (((h >>> 12) & 3) !== 0 && x1 - x0 >= 12 && z1 - z0 >= 12) {
    x0 += 3; x1 -= 3; z0 += 3; z1 -= 3;
    const up = Math.min(top + 3 + ((h >>> 14) % 6), R - 2);
    piece();
    span(L[0], f[0], x0, x1);
    span(L[2], f[2], z0, z1);
    span(L[1], f[1], top - 1, up);
    d = Math.min(d, gD);
    top = up;
  }
  const roof = (h >>> 18) & 3;
  if (roof >= 2) {
    const pyramid = roof === 3, alongZ = z1 - z0 >= x1 - x0;
    const rise = Math.min(Math.floor((pyramid ? Math.min(x1 - x0, z1 - z0) : alongZ ? x1 - x0 : z1 - z0) / 2), R - 1 - top);
    piece();
    span(L[0], f[0], x0, x1);
    span(L[2], f[2], z0, z1);
    span(L[1], f[1], top - 1, top + rise);
    if (pyramid || alongZ) {
      plane(diag(0, -1, 1, x0, top, 0) * Math.SQRT1_2);
      plane(diag(0, 1, 1, x1, top, 0) * Math.SQRT1_2);
    }
    if (pyramid || !alongZ) {
      plane(diag(1, -1, 1, z0, top, 0) * Math.SQRT1_2);
      plane(diag(1, 1, 1, z1, top, 0) * Math.SQRT1_2);
    }
    d = Math.min(d, gD);
  }
  return d;
}

function plaza(L, f, standing, h) {
  piece();
  span(L[0], f[0], -T, R + T);
  span(L[2], f[2], -T, R + T);
  span(L[1], f[1], G, R + M);
  const box = gD;
  return standing ? Math.max(box, -building(L, f, h)) : box;
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
  const w = well(L, f, id, seed);
  const p = plaza(L, f, w >= NONE, hashCell(id, seed ^ TOWER_SALT));
  return Math.min(p, w);
}

export default {
  ...halls,
  name: 'arcology',
  glsl: hallsGlsl + glsl,
  cellAir,
  // A plaza's air reaches up out of its cell, and its widest way runs
  // corner to corner beyond its sides.
  maxInterior: 0.5,
  longestWay: 2.1,

  // On the plaza, at the foot of the buildings (or inside one), in the city
  // row; the levels coarser are all solid, so anywhere does for them.
  ancestorDigit(level) {
    if (level > 0) return halls.ancestorDigit(level);
    if (level === 0) return [C, G, C];
    if (level === CITY) return [C, ROW, C];
    return [C, C, C];
  },
  // The sky starts at the top of the city's row.
  ground: R,
};
