// "Halls": a lattice of built rooms, each of whose walls, floors and
// furnishings is in turn a lattice of smaller rooms.
//
// A space is a description of ONE cell, in lattice units where the cell spans
// 0..R and one unit is a child cell. The engine stacks that description at
// every scale. What a space provides:
//
//   R              children per cell edge
//   glsl           float cell(ivec3 L, vec3 f, ivec3 id, uint seed,
//                             out float reach, out vec3 nrm)
//                  signed distance to the cell's air (negative inside air) at
//                  the point L + f. It may understate a distance but must
//                  never overstate one, on either side of the surface.
//                  When gRay is set it also answers for a ray: if the point
//                  is in air, reach is how far the ray goes before leaving
//                  the piece of air it is in (and nrm the surface there);
//                  otherwise reach is negative. See "Rays" below.
//   cellAir        the distance alone, in JavaScript (see below)
//   maxInterior    largest clearance any point in a cell's air can have, as a
//                  fraction of the cell
//   longestWay     the longest way through any one convex piece of a cell's
//                  air, in cells
//   close          how far (fraction of the cell) air is shrunk to fade a level
//                  out with distance
//   openArea       roughly what fraction of a surface is openings
//   ancestorDigit  where a cell sits inside its parent when nothing says
//                  otherwise (must be somewhere solid in the parent)
//   palette, sky, fogK, start
//   ground         the world has a top: above one horizontal plane there is
//                  only open sky. This says where: the plane is this many
//                  level-0 cells up from the floor of the level -1 cell that
//                  ancestorDigit leads to. Being on a cell boundary of level
//                  0, it leaves the rooms under it their roofs.
//   zenith, roof   the sky's colour overhead; the colour of the ground seen
//                  from above
//
// Rules for cellAir that keep the world exact at any depth:
//   - put every feature on integer lattice coordinates, with faces that are
//     axis-aligned or at 45 degrees in a coordinate plane
//   - always form distances as float(L - anchor) + f, never float(L) + f - anchor
//   - form the distance to a 45-degree plane with diag(), never from the f of
//     two axes: close to the plane those cancel
//   - when choosing which of several features a point is nearest, go by L + f,
//     not L: a wrong choice overstates the clearance and rays step into solid
// A feature aligned this way also never slices a child cell in half, so every
// surface of a room is a clean facade of the rooms one level down.
//
// Pieces. A cell's air is a union of convex pieces (the room, a tunnel
// through each face) less some convex solids (furniture). Each piece is
// written once, as the planes that bound it: airPiece() then airPlane() for
// each (or solidPiece(), solidPlane() and solidDone() for a solid). From
// those the engine has both the piece's distance and, for a ray, where it
// leaves the piece or strikes the solid, so the two always agree; and it
// shrinks or grows everything with distance. The JavaScript below is the
// same, piece for piece, with each plane only a distance. Rules:
//   - pieces of one cell that join must overlap, not just touch
//   - a solid may only stand in the room piece, clear of every tunnel
//   - a tunnel may run on into the next cell, where that cell's own
//     description of it must agree

import { hash32, hashCell, hsv, levelSeed, wrapId as wrapIdR } from '../util.js';

const R = 24; // children per cell edge
const wrapId = (id) => wrapIdR(id, R);
const M = 3; // half the wall thickness between two rooms
const HLO = 12; // ceiling height of a low room; a tall room fills the cell (18)
const SOLID = 0.5; // share of cells that are left solid, with no room in them
const BUILT_SALT = 0x3c6ef372;

const glsl = /* glsl */ `
const int M = ${M};
const int HLO = ${HLO};
const int HHI = R - 2 * M;
const int C = R / 2;
const vec3 EX = vec3(1.0, 0.0, 0.0), EY = vec3(0.0, 1.0, 0.0), EZ = vec3(0.0, 0.0, 1.0);

float h01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

// Does this cell have a room in it? Some are left solid, so that a surface
// which cuts through cells (any diagonal) is not all cut-open rooms.
bool built(ivec3 id, uint seed) { return h01(hashCell(id, seed ^ ${BUILT_SALT}u)) >= ${SOLID.toFixed(3)}; }

// Which of three bays, each six units wide, holds u (integer division is slow).
int bay(int u, float fu) { return int(clamp(floor((float(u - M) + fu) * (1.0 / 6.0)), 0.0, 2.0)); }

// Is the point x + f on the upper side of c? (L alone is rounded, and can
// put a point half a unit on the wrong side.)
bool beyond(int x, float f, int c) { return x > c || (x == c && f >= 0.0); }

// The opening, if any, through the wall on one horizontal side of the cell.
// One shape covers every kind: centred at cu along the wall, half width hw,
// its sill y0 above the floor, its sides rising sp before a 45-degree gable,
// and a flat top (each out of the way where a kind has none). Faces are
// shared, so the two cells either side hash the same owner (h) and agree on
// what is there.
bool wallShape(uint h, int u, float fu, out int cu, out int hw, out int y0, out int sp, out int top) {
  float t = h01(h);
  if (t < 0.24) return false;
  // No wall at all: the two rooms run together.
  cu = C; hw = C - M; y0 = 0; sp = 1000; top = HLO;
  // A door, in one of three positions.
  if (t < 0.52) { cu = C + (int(float(h & 255u) * (3.0 / 256.0)) - 1) * 5; hw = 2; sp = 5; top = 1000; }
  // A row of three windows.
  else if (t < 0.68) { cu = M + 3 + 6 * bay(u, fu); hw = 1; y0 = 4; sp = 3; top = 1000; }
  // An arcade of three arches.
  else if (t < 0.84) { cu = M + 3 + 6 * bay(u, fu); hw = 2; sp = 6; top = 1000; }
  return true;
}

// That opening as a piece of air: a tunnel along a (the wall's normal, ea),
// u across the wall (eu) and y up, which reaches one unit into our own room
// and stops at the neighbour's. p is the pair of axes (u, y), for diag().
float wallOpening(int p, int a, float fa, int u, float fu, int y, float fy, bool high, uint h, vec3 ea, vec3 eu) {
  int cu, hw, y0, sp, top;
  if (!wallShape(h, u, fu, cu, hw, y0, sp, top)) return 1e9;
  int x = u - cu, yy = y - M - y0;
  airPiece();
  airSpan(a, fa, high ? R - M - 1 : -M, high ? R + M : M + 1, ea);
  airSpan(x, fu, -hw, hw, eu);
  airSpan(yy, fy, 0, top, EY);
  airPlane(diag(p, 1, 1, cu, M + y0, sp + hw) * 0.70710678, (eu + EY) * 0.70710678);
  airPlane(diag(p, -1, 1, cu, M + y0, sp + hw) * 0.70710678, (EY - eu) * 0.70710678);
  return gD;
}

// An opening through the slab above (up) or below the room: an octagonal
// oculus, or a square light well (the oculus's diagonals out of its way).
float slabOpening(ivec3 L, vec3 f, bool up, int H, uint h) {
  float t = h01(h);
  if (t < 0.66) return 1e9;
  bool oculus = t < 0.88;
  int w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
  airPiece();
  airSpan(L.y, f.y, up ? M + H - 1 : -M, up ? R + M : M + 1, EY);
  airSpan(L.x - C, f.x, -w, w, EX);
  airSpan(L.z - C, f.z, -w, w, EZ);
  for (int j = 0; j < 4; j++) {
    int sx = (j & 1) == 1 ? 1 : -1, sz = (j & 2) == 2 ? 1 : -1;
    airPlane(diag(2, sx, sz, C, C, dg) * 0.70710678, vec3(float(sx), 0.0, float(sz)) * 0.70710678);
  }
  return gD;
}

// Solid things standing in the room: the distance to the nearest (negative
// inside it). under and over are what picks the openings in the floor and
// the ceiling: nothing stands over a hole in the floor, and a pier keeps
// clear of a light well at either end. (An opening reaches a unit into the
// room so that the two join cleanly; furniture in the way would leave a skin
// where they meet.) A ray may strike any of a set of them, so then all are
// asked; otherwise the one in our quarter of the room is the nearest.
float furniture(ivec3 L, vec3 f, uint h, float under, float over) {
  float t = h01(h);
  if (t < 0.40) return 1e9;
  float d = 1e9;
  if (t < 0.62) {
    if (max(under, over) >= 0.88) return 1e9;
    // Four diamond piers, floor to ceiling.
    int nx = beyond(L.x, f.x, C) ? 1 : 0, nz = beyond(L.z, f.z, C) ? 1 : 0;
    for (int k = 0; k < 4; k++) {
      int kx = k & 1, kz = k >> 1;
      if (!gRay && (kx != nx || kz != nz)) continue;
      int cx = kx == 1 ? 17 : 7, cz = kz == 1 ? 17 : 7;
      solidPiece();
      for (int j = 0; j < 4; j++) {
        int sx = (j & 1) == 1 ? 1 : -1, sz = (j & 2) == 2 ? 1 : -1;
        solidPlane(diag(2, sx, sz, cx, cz, 2) * 0.70710678, vec3(float(sx), 0.0, float(sz)) * 0.70710678);
      }
      d = min(d, solidDone());
    }
    return d;
  }
  if (under >= 0.66) return 1e9;
  if (t < 0.82) {
    // Two rows of benches, running along x or z (p, across q).
    bool turn = ((h >> 5) & 1u) == 1u;
    int p = turn ? L.z : L.x, q = turn ? L.x : L.z;
    float fp = turn ? f.z : f.x, fq = turn ? f.x : f.z;
    vec3 ep = turn ? EZ : EX, eq = turn ? EX : EZ;
    int np = beyond(p, fp, C) ? 1 : 0, nq = beyond(q, fq, C) ? 1 : 0;
    for (int k = 0; k < 4; k++) {
      int kp = k & 1, kq = k >> 1;
      if (!gRay && (kp != np || kq != nq)) continue;
      int p0 = kp == 1 ? 13 : 6, q0 = kq == 1 ? 15 : 8;
      solidPiece();
      solidSpan(p, fp, p0, p0 + 5, ep);
      solidSpan(q, fq, q0, q0 + 1, eq);
      solidSpan(L.y, f.y, M - 1, M + 1, EY);
      d = min(d, solidDone());
    }
    return d;
  }
  // A kiosk in the middle of the floor.
  solidPiece();
  solidSpan(L.x, f.x, C - 2, C + 2, EX);
  solidSpan(L.z, f.z, C - 2, C + 2, EZ);
  solidSpan(L.y, f.y, M - 1, M + 3, EY);
  return solidDone();
}

// The room: a box, less whatever stands in it.
float roomAir(ivec3 L, vec3 f, int H, uint h, float under, float over) {
  airPiece();
  airSpan(L.x, f.x, M, R - M, EX);
  airSpan(L.z, f.z, M, R - M, EZ);
  airSpan(L.y, f.y, M, M + H, EY);
  float box = gD;
  return max(box, -furniture(L, f, h, under, over));
}

float cell(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {
  reach = -1.0;
  nrm = vec3(0.0);
  uint hc = hashCell(id, seed);
  bool here = built(id, seed);
  int H = here && h01(hc) < 0.65 ? HLO : HHI;

  // Of the pieces of air the point is in, the ray stays in air to the end of
  // whichever it is in for longest. Each piece is first asked only its
  // distance; only one the point turns out to be in is asked again, for
  // where the ray leaves it (asking that of every piece costs far more).
  bool ray = gRay;
  gRay = false;
  float room = 1e9;
  uint hup = hashCell(id, seed ^ 0x967a889bu);
  uint hdn = hashCell(wrapId(id - ivec3(0, 1, 0)), seed ^ 0x967a889bu);
  uint hf = hashCell(id, seed ^ 0x51ed270bu);
  if (here) {
    room = roomAir(L, f, H, hf, h01(hdn), h01(hup));
    if (ray && room + gO <= 0.0) {
      gRay = true;
      roomAir(L, f, H, hf, h01(hdn), h01(hup));
      gRay = false;
      reach = gX;
      nrm = gN;
    }
  }
  // Openings reach only one unit into the room; deeper in, they change nothing.
  if (room < -1.0) {
    gRay = ray;
    return room;
  }

  // Only the nearer face on each axis can matter to a point in this cell.
  bool hx = beyond(L.x, f.x, C), hz = beyond(L.z, f.z, C), hy = beyond(L.y, f.y, M + H / 2);
  ivec3 ox = hx ? id : wrapId(id - ivec3(1, 0, 0));
  ivec3 oz = hz ? id : wrapId(id - ivec3(0, 0, 1));
  uint hwx = hashCell(ox, seed ^ 0x68bc21ebu), hwz = hashCell(oz, seed ^ 0x02e5be93u);
  uint hwy = hy ? hup : hdn;
  if (!here) {
    // A face has an opening only if there is a room on one side of it at
    // least. From a room, an opening into a solid cell is a niche.
    if (!built(wrapId(id + ivec3(hx ? 1 : -1, 0, 0)), seed)) hwx = 0u;
    if (!built(wrapId(id + ivec3(0, 0, hz ? 1 : -1)), seed)) hwz = 0u;
    if (!built(wrapId(id + ivec3(0, hy ? 1 : -1, 0)), seed)) hwy = 0u;
  }
  float ax = wallOpening(1, L.x, f.x, L.z, f.z, L.y, f.y, hx, hwx, EX, EZ);
  float az = wallOpening(0, L.z, f.z, L.x, f.x, L.y, f.y, hz, hwz, EZ, EX);
  float ay = slabOpening(L, f, hy, H, hwy);
  gRay = ray;
  if (ray && ax + gO <= 0.0) {
    wallOpening(1, L.x, f.x, L.z, f.z, L.y, f.y, hx, hwx, EX, EZ);
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  if (ray && az + gO <= 0.0) {
    wallOpening(0, L.z, f.z, L.x, f.x, L.y, f.y, hz, hwz, EZ, EX);
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  if (ray && ay + gO <= 0.0) {
    slabOpening(L, f, hy, H, hwy);
    if (gX > reach) { reach = gX; nrm = gN; }
  }

  // From inside the slab over a low room, the nearest air may be the room
  // above. This cell says nothing else about its neighbours' rooms.
  float above = max(max(max(float(M - L.x) - f.x, float(L.x - (R - M)) + f.x),
                        max(float(M - L.z) - f.z, float(L.z - (R - M)) + f.z)), float(R + M - L.y) - f.y);

  float a = min(min(min(room, above), ax), min(az, ay));
  if (a <= 0.0) return a;

  // In solid, a must not overstate how far the nearest air is, and the above
  // only looked at part of it. Air it did not look at is at least this far:
  // the far-side openings of this cell, which come no nearer than M + 1 to
  // their own side (so C - M - 1 from the middle across, and H / 2 - 1 from
  // it up or down, H being at least HLO); and whatever the neighbours hold,
  // none of which comes within M of the cell boundary unseen.
  vec3 q = vec3(L) + f;
  vec3 e = min(q, float(R) - q);
  float unseen = min(min(abs(q.x - float(C)), abs(q.z - float(C))) + float(C - M - 1), abs(q.y - float(M + H / 2)) + float(HLO / 2 - 1));
  unseen = min(unseen, min(e.x, min(e.y, e.z)) + float(M));
  return min(a, unseen);
}
`;

// The same cell, in JavaScript, piece for piece. The engine asks this for
// the camera's clearance every frame (asking the GPU would mean waiting for
// it), so it must agree with the GLSL above (the tests compare the two). Only
// the distances are wanted here, so a plane is only its distance.
const C = R / 2;
const HHI = R - 2 * M;
const NONE = 1e9;
const h01 = (h) => (h >>> 8) / 16777216;
const beyond = (x, f, c) => x > c || (x === c && f >= 0);
const bay = (u, fu) => Math.min(2, Math.max(0, Math.floor((u - M + fu) / 6)));

// The point being asked about, along the diagonals (set by cellAir), and
// the same diag() as the shaders have.
let dLp, dFp, dLm, dFm;
const diag = (p, sa, sb, ca, cb, k) =>
  sa === sb ? sa * (dLp[p] - ca - cb) - k + sa * dFp[p] : sa * (dLm[p] - ca + cb) - k + sa * dFm[p];

// Pieces, as in the shaders (airPiece and the rest).
let gD;
const piece = () => (gD = -Infinity);
const plane = (s) => (gD = Math.max(gD, s));
const span = (x, f, x0, x1) => (plane(x0 - x - f), plane(x - x1 + f));

function wallShape(h, u, fu) {
  const t = h01(h);
  if (t < 0.24) return null;
  if (t < 0.52) return { cu: C + (Math.floor(((h & 255) * 3) / 256) - 1) * 5, hw: 2, y0: 0, sp: 5, top: 1000 };
  if (t < 0.68) return { cu: M + 3 + 6 * bay(u, fu), hw: 1, y0: 4, sp: 3, top: 1000 };
  if (t < 0.84) return { cu: M + 3 + 6 * bay(u, fu), hw: 2, y0: 0, sp: 6, top: 1000 };
  return { cu: C, hw: C - M, y0: 0, sp: 1000, top: HLO };
}

function wallOpening(p, a, fa, u, fu, y, fy, high, h) {
  const s = wallShape(h, u, fu);
  if (!s) return NONE;
  const { cu, hw, y0, sp, top } = s;
  const x = u - cu, yy = y - M - y0;
  piece();
  span(a, fa, high ? R - M - 1 : -M, high ? R + M : M + 1);
  span(x, fu, -hw, hw);
  span(yy, fy, 0, top);
  plane(diag(p, 1, 1, cu, M + y0, sp + hw) * Math.SQRT1_2);
  plane(diag(p, -1, 1, cu, M + y0, sp + hw) * Math.SQRT1_2);
  return gD;
}

function slabOpening(L, f, up, H, h) {
  const t = h01(h);
  if (t < 0.66) return NONE;
  const oculus = t < 0.88;
  const w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
  piece();
  span(L[1], f[1], up ? M + H - 1 : -M, up ? R + M : M + 1);
  span(L[0] - C, f[0], -w, w);
  span(L[2] - C, f[2], -w, w);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plane(diag(2, sx, sz, C, C, dg) * Math.SQRT1_2);
  return gD;
}

// (Only the nearest of each set: that is all a distance needs.)
function furniture(L, f, h, under, over) {
  const t = h01(h);
  if (t < 0.4) return NONE;
  if (t < 0.62) {
    if (Math.max(under, over) >= 0.88) return NONE;
    const cx = beyond(L[0], f[0], C) ? 17 : 7, cz = beyond(L[2], f[2], C) ? 17 : 7;
    piece();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plane(diag(2, sx, sz, cx, cz, 2) * Math.SQRT1_2);
    return gD;
  }
  if (under >= 0.66) return NONE;
  if (t < 0.82) {
    const turn = ((h >>> 5) & 1) === 1;
    const p = turn ? L[2] : L[0], q = turn ? L[0] : L[2];
    const fp = turn ? f[2] : f[0], fq = turn ? f[0] : f[2];
    const p0 = beyond(p, fp, C) ? 13 : 6, q0 = beyond(q, fq, C) ? 15 : 8;
    piece();
    span(p, fp, p0, p0 + 5);
    span(q, fq, q0, q0 + 1);
    span(L[1], f[1], M - 1, M + 1);
    return gD;
  }
  piece();
  span(L[0], f[0], C - 2, C + 2);
  span(L[2], f[2], C - 2, C + 2);
  span(L[1], f[1], M - 1, M + 3);
  return gD;
}

function roomAir(L, f, H, h, under, over) {
  piece();
  span(L[0], f[0], M, R - M);
  span(L[2], f[2], M, R - M);
  span(L[1], f[1], M, M + H);
  const box = gD;
  return Math.max(box, -furniture(L, f, h, under, over));
}

const ancestors = new Map(); // level -> where its cell sits in its parent
const built = (id, seed) => h01(hashCell(id, seed ^ BUILT_SALT)) >= SOLID;

// dg is the point along the diagonals (see Position.levels). Without it they
// are worked out from L and f, which is only good far from any such surface.
function cellAir(L, f, id, seed, dg) {
  if (dg) ({ Lp: dLp, fp: dFp, Lm: dLm, fm: dFm } = dg);
  else {
    const pairs = [[0, 1], [2, 1], [0, 2]];
    dLp = pairs.map(([a, b]) => L[a] + L[b]);
    dFp = pairs.map(([a, b]) => f[a] + f[b]);
    dLm = pairs.map(([a, b]) => L[a] - L[b]);
    dFm = pairs.map(([a, b]) => f[a] - f[b]);
  }
  const here = built(id, seed);
  const H = here && h01(hashCell(id, seed)) < 0.65 ? HLO : HHI;
  let room = NONE;
  const hup = hashCell(id, seed ^ 0x967a889b);
  const hdn = hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ 0x967a889b);
  if (here) room = roomAir(L, f, H, hashCell(id, seed ^ 0x51ed270b), h01(hdn), h01(hup));
  if (room < -1) return room;

  const hx = beyond(L[0], f[0], C), hz = beyond(L[2], f[2], C), hy = beyond(L[1], f[1], M + H / 2);
  const ox = hx ? id : wrapId([id[0] - 1, id[1], id[2]]);
  const oz = hz ? id : wrapId([id[0], id[1], id[2] - 1]);
  let hwx = hashCell(ox, seed ^ 0x68bc21eb), hwz = hashCell(oz, seed ^ 0x02e5be93), hwy = hy ? hup : hdn;
  if (!here) {
    if (!built(wrapId([id[0] + (hx ? 1 : -1), id[1], id[2]]), seed)) hwx = 0;
    if (!built(wrapId([id[0], id[1], id[2] + (hz ? 1 : -1)]), seed)) hwz = 0;
    if (!built(wrapId([id[0], id[1] + (hy ? 1 : -1), id[2]]), seed)) hwy = 0;
  }
  const ax = wallOpening(1, L[0], f[0], L[2], f[2], L[1], f[1], hx, hwx);
  const az = wallOpening(0, L[2], f[2], L[0], f[0], L[1], f[1], hz, hwz);
  const ay = slabOpening(L, f, hy, H, hwy);
  const above = Math.max(M - L[0] - f[0], L[0] - (R - M) + f[0], M - L[2] - f[2], L[2] - (R - M) + f[2], R + M - L[1] - f[1]);

  const a = Math.min(room, above, ax, az, ay);
  if (a <= 0) return a;

  const q = [L[0] + f[0], L[1] + f[1], L[2] + f[2]];
  const edge = Math.min(q[0], R - q[0], q[1], R - q[1], q[2], R - q[2]);
  const unseen = Math.min(Math.abs(q[0] - C) + (C - M - 1), Math.abs(q[2] - C) + (C - M - 1), Math.abs(q[1] - (M + H / 2)) + (HLO / 2 - 1), edge + M);
  return Math.min(a, unseen);
}

export default {
  name: 'halls',
  R,
  glsl,
  cellAir,
  maxInterior: 0.375,
  longestWay: 1.4,
  close: 0.3,
  openArea: 0.1,

  // Standing height in the middle of a room.
  start: [0.5, (M + 4.5) / R, 0.5],

  // By default a cell sits in the surface layer of one of its parent's four
  // walls, above the height any opening reaches, which is the one place that
  // is solid whatever the parent turns out to be. If the parent is a tall
  // room, it is just outside.
  //
  // The cell one level in from this one must have a room for that to mean
  // anything, so of the places this could be, take the first that gives it one.
  ancestorDigit(level) {
    let d = ancestors.get(level);
    if (d) return d;
    // (Worked from level 0 outward, and not by recursion, which a first call
    // for a very distant level would overrun.)
    for (let j = Math.max(level, 0); j >= level; j--) {
      if (ancestors.has(j)) continue;
      const inner = j < 0 ? ancestors.get(j + 1) : null;
      for (let k = 0; ; k++) {
        const h = hash32((j * 2 + 1) ^ Math.imul(k, 0x632be5ab));
        const g = hash32(h);
        const across = M + ((h >>> 8) % (R - 2 * M));
        const y = M + HLO + ((h >>> 16) % (R - 2 * M - HLO));
        const depth = g & 2 ? M - 1 : R - M;
        d = g & 1 ? [depth, y, across] : [across, y, depth];
        if (!inner || k > 60 || built(inner.map((x, a) => x + R * d[a]), levelSeed(j + 1))) break;
      }
      ancestors.set(j, d);
    }
    return ancestors.get(level);
  },

  // Each level gets its own colour so that scale is legible: hue steps by the
  // golden angle, so neighbouring levels always contrast.
  palette(level) {
    const j = (hash32(level) & 0xffff) / 0xffff;
    const h = 0.085 + level * 0.381966;
    const s = 0.2 + 0.14 * j;
    return {
      wall: hsv(h, s, 0.86),
      floor: hsv(h + 0.02, s * 1.15, 0.56),
    };
  },

  sky: [0.72, 0.8, 0.9],
  zenith: [0.3, 0.5, 0.82],
  roof: hsv(0.09, 0.16, 0.6),
  // The room we start in is in the top storey.
  get ground() {
    return this.ancestorDigit(0)[1] + 1;
  },
  fogK: 250, // visibility, in cells of the room we are in
};
