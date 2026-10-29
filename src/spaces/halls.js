// "Halls": a lattice of built rooms, each of whose walls, floors and
// furnishings is in turn a lattice of smaller rooms.
//
// A space is a description of ONE cell, in lattice units where the cell spans
// 0..R and one unit is a child cell. The engine stacks that description at
// every scale. What a space provides:
//
//   R              children per cell edge
//   glsl           float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level,
//                             out float reach, out vec3 nrm)
//                  signed distance to the cell's air (negative inside air) at
//                  the point L + f. It may understate a distance but must
//                  never overstate one, on either side of the surface.
//                  When gRay is set it also answers for a ray: if the point
//                  is in air, reach is how far the ray goes before leaving
//                  the piece of air it is in (and nrm the surface there);
//                  otherwise reach is negative. See "Rays" below. The id
//                  of the cell's parent is in gUp.
//   cellAir        the distance alone, in JavaScript (see below), given
//                  (L, f, id, seed, dg, level, up), up the parent's id
//   volume         optionally, a table the space looks things up in rather
//                  than work them out: { size, data, words }, data a
//                  Uint32Array of `words` numbers (2 or 4) for each of
//                  size[0] * size[1] * size[2] cells, x fastest; in the
//                  shader, the usampler3D uVolume
//   tables         optionally, more tables, 2D: [{ name, size, data }], data
//                  an Int32Array of four numbers for each of size[0] *
//                  size[1], x fastest; in the shader, the isampler2D of that
//                  name (the space declares it)
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
//   skyPlane       optionally, in place of ground: the plane's height as a
//                  digit at each level j <= 0 (in the cells of level j), to be
//                  compared with ours digit by digit; where our digits are
//                  the default ones, those of the levels coarser than any
//                  we have been elsewhere at must cancel
//   skyClear       how far under the plane, in level-0 cells, it is open air
//                  everywhere (optional; none here)
//   sunReach       how far under the ground plane, in level-0 cells, there
//                  can be open air the sun shines into (optional; none here)
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

import { hash32, hashCell, hsv, levelSeed, wrapId as wrapIdR, glf, hexu, define, frozen } from '../util.js';
import { S, at, aim, through, airPiece, airPlane, airSpan, solidPiece, solidPlane, solidSpan, solidDone, diag, h01, beyond, NONE } from '../pieces.js';

export const R = 24; // children per cell edge
const wrapId = (id) => wrapIdR(id, R);
export const M = 3; // half the wall thickness between two rooms
const HLO = 12; // ceiling height of a low room; a tall room fills the cell (18)

// What the halls make of a cell's hashes, in one place for both copies (and
// for the planner, and the arcology's light wells): each choice is a hash of
// the cell, salted for what it chooses, as a number from 0 to 1, against
// these.
export const HALLS = {
  solid: 0.65, // the share of cells left solid, with no room
  low: 0.65, // the share of rooms that are low (HLO high); the rest fill the cell
  salt: { built: 0x3c6ef372, slab: 0x967a889b, furniture: 0x51ed270b, wallX: 0x68bc21eb, wallZ: 0x02e5be93 },
  // Through a wall: below none, nothing; then a door, a row of windows, an
  // arcade; above arcade, no wall at all (the rooms run together).
  wall: { none: 0.24, door: 0.52, windows: 0.68, arcade: 0.84 },
  // Through a slab: below solid, nothing; then an oculus; above, a light well.
  slab: { solid: 0.66, oculus: 0.88 },
  // In a room: below none, nothing; then piers, benches; above, a kiosk.
  furniture: { none: 0.4, piers: 0.62, benches: 0.82 },
};
// The halls, made from HALLS with what set changes (see define in util.js):
// their space, and the parts other spaces build on (see the end), so that a
// variant of them is another call of this.
export function makeHalls(set) {
  const spec = frozen(define(HALLS, set));
  const { salt, wall, slab, furniture: stands } = spec;

  // (Other spaces build on these halls: hallsGlsl and hallsAir are a halls
  // cell, whatever its level.)
  const hallsGlsl = /* glsl */ `
const int M = ${M};
const int HLO = ${HLO};
const int HHI = R - 2 * M;
const int C = R / 2;
const vec3 EX = vec3(1.0, 0.0, 0.0), EY = vec3(0.0, 1.0, 0.0), EZ = vec3(0.0, 0.0, 1.0);

float h01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

// Does this cell have a room in it? Some are left solid, so that a surface
// which cuts through cells (any diagonal) is not all cut-open rooms.
// (And only where the space allows a room: spaceRoom, which each space
// defines; the halls everywhere.)
bool spaceRoom(ivec3 id, uint seed);
bool built(ivec3 id, uint seed) { return spaceRoom(id, seed) && h01(hashCell(id, seed ^ ${hexu(salt.built)})) >= ${glf(spec.solid)}; }

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
  if (t < ${glf(wall.none)}) return false;
  // No wall at all: the two rooms run together.
  cu = C; hw = C - M; y0 = 0; sp = 1000; top = HLO;
  // A door, in one of three positions.
  if (t < ${glf(wall.door)}) { cu = C + (int(float(h & 255u) * (3.0 / 256.0)) - 1) * 5; hw = 2; sp = 5; top = 1000; }
  // A row of three windows.
  else if (t < ${glf(wall.windows)}) { cu = M + 3 + 6 * bay(u, fu); hw = 1; y0 = 4; sp = 3; top = 1000; }
  // An arcade of three arches.
  else if (t < ${glf(wall.arcade)}) { cu = M + 3 + 6 * bay(u, fu); hw = 2; sp = 6; top = 1000; }
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
  if (t < ${glf(slab.solid)}) return 1e9;
  bool oculus = t < ${glf(slab.oculus)};
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
  if (t < ${glf(stands.none)}) return 1e9;
  float d = 1e9;
  if (t < ${glf(stands.piers)}) {
    if (max(under, over) >= ${glf(slab.oculus)}) return 1e9;
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
  if (under >= ${glf(slab.solid)}) return 1e9;
  if (t < ${glf(stands.benches)}) {
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

float hallsCell(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {
  reach = -1.0;
  nrm = vec3(0.0);
  uint hc = hashCell(id, seed);
  bool here = built(id, seed);
  int H = here && h01(hc) < ${glf(spec.low)} ? HLO : HHI;

  // Of the pieces of air the point is in, the ray stays in air to the end of
  // whichever it is in for longest. Each piece is first asked only its
  // distance; only one the point turns out to be in is asked again, for
  // where the ray leaves it (asking that of every piece costs far more).
  bool ray = gRay;
  gRay = false;
  float room = 1e9;
  uint hup = hashCell(id, seed ^ ${hexu(salt.slab)});
  uint hdn = hashCell(wrapId(id - ivec3(0, 1, 0)), seed ^ ${hexu(salt.slab)});
  uint hf = hashCell(id, seed ^ ${hexu(salt.furniture)});
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
  uint hwx = hashCell(ox, seed ^ ${hexu(salt.wallX)}), hwz = hashCell(oz, seed ^ ${hexu(salt.wallZ)});
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

  // The same cell, in JavaScript, piece for piece (see pieces.js). The flight
  // asks this every frame (asking the GPU would mean waiting for it), so it
  // must agree with the GLSL above: the tests compare the two.
  const C = R / 2;
  const HHI = R - 2 * M;
  const bay = (u, fu) => Math.min(2, Math.max(0, Math.floor((u - M + fu) / 6)));
  const H2 = Math.SQRT1_2;

  function wallShape(h, u, fu) {
    const t = h01(h);
    if (t < wall.none) return null;
    if (t < wall.door) return { cu: C + (Math.floor(((h & 255) * 3) / 256) - 1) * 5, hw: 2, y0: 0, sp: 5, top: 1000 };
    if (t < wall.windows) return { cu: M + 3 + 6 * bay(u, fu), hw: 1, y0: 4, sp: 3, top: 1000 };
    if (t < wall.arcade) return { cu: M + 3 + 6 * bay(u, fu), hw: 2, y0: 0, sp: 6, top: 1000 };
    return { cu: C, hw: C - M, y0: 0, sp: 1000, top: HLO };
  }

  // (ea and eu: the axes, 0 to 2, of the wall's normal and across the wall.)
  function wallOpening(p, a, fa, u, fu, y, fy, high, h, ea, eu) {
    const s = wallShape(h, u, fu);
    if (!s) return NONE;
    const { cu, hw, y0, sp, top } = s;
    const x = u - cu, yy = y - M - y0;
    const ux = eu === 0 ? H2 : 0, uz = eu === 2 ? H2 : 0;
    airPiece();
    airSpan(a, fa, high ? R - M - 1 : -M, high ? R + M : M + 1, ea);
    airSpan(x, fu, -hw, hw, eu);
    airSpan(yy, fy, 0, top, 1);
    airPlane(diag(p, 1, 1, cu, M + y0, sp + hw) * H2, ux, H2, uz);
    airPlane(diag(p, -1, 1, cu, M + y0, sp + hw) * H2, -ux, H2, -uz);
    return S.d;
  }

  function slabOpening(L, f, up, H, h) {
    const t = h01(h);
    if (t < slab.solid) return NONE;
    const oculus = t < slab.oculus;
    const w = oculus ? 3 : 6, dg = oculus ? 4 : 1000;
    airPiece();
    airSpan(L[1], f[1], up ? M + H - 1 : -M, up ? R + M : M + 1, 1);
    airSpan(L[0] - C, f[0], -w, w, 0);
    airSpan(L[2] - C, f[2], -w, w, 2);
    for (let j = 0; j < 4; j++) {
      const sx = j & 1 ? 1 : -1, sz = j & 2 ? 1 : -1;
      airPlane(diag(2, sx, sz, C, C, dg) * H2, sx * H2, 0, sz * H2);
    }
    return S.d;
  }

  // Solid things standing in the room, as in the GLSL: for a distance, the
  // one in our quarter of the room is the nearest; a ray may strike any of a
  // set, so then all are asked.
  function furniture(L, f, h, under, over) {
    const t = h01(h);
    if (t < stands.none) return NONE;
    let d = NONE;
    if (t < stands.piers) {
      if (Math.max(under, over) >= slab.oculus) return NONE;
      const nx = beyond(L[0], f[0], C) ? 1 : 0, nz = beyond(L[2], f[2], C) ? 1 : 0;
      for (let k = 0; k < 4; k++) {
        const kx = k & 1, kz = k >> 1;
        if (!S.ray && (kx !== nx || kz !== nz)) continue;
        const cx = kx === 1 ? 17 : 7, cz = kz === 1 ? 17 : 7;
        solidPiece();
        for (let j = 0; j < 4; j++) {
          const sx = j & 1 ? 1 : -1, sz = j & 2 ? 1 : -1;
          solidPlane(diag(2, sx, sz, cx, cz, 2) * H2, sx * H2, 0, sz * H2);
        }
        d = Math.min(d, solidDone());
      }
      return d;
    }
    if (under >= slab.solid) return NONE;
    if (t < stands.benches) {
      const turn = ((h >>> 5) & 1) === 1;
      const p = turn ? L[2] : L[0], q = turn ? L[0] : L[2];
      const fp = turn ? f[2] : f[0], fq = turn ? f[0] : f[2];
      const ep = turn ? 2 : 0, eq = turn ? 0 : 2;
      const np = beyond(p, fp, C) ? 1 : 0, nq = beyond(q, fq, C) ? 1 : 0;
      for (let k = 0; k < 4; k++) {
        const kp = k & 1, kq = k >> 1;
        if (!S.ray && (kp !== np || kq !== nq)) continue;
        const p0 = kp === 1 ? 13 : 6, q0 = kq === 1 ? 15 : 8;
        solidPiece();
        solidSpan(p, fp, p0, p0 + 5, ep);
        solidSpan(q, fq, q0, q0 + 1, eq);
        solidSpan(L[1], f[1], M - 1, M + 1, 1);
        d = Math.min(d, solidDone());
      }
      return d;
    }
    solidPiece();
    solidSpan(L[0], f[0], C - 2, C + 2, 0);
    solidSpan(L[2], f[2], C - 2, C + 2, 2);
    solidSpan(L[1], f[1], M - 1, M + 3, 1);
    return solidDone();
  }

  function roomAir(L, f, H, h, under, over) {
    airPiece();
    airSpan(L[0], f[0], M, R - M, 0);
    airSpan(L[2], f[2], M, R - M, 2);
    airSpan(L[1], f[1], M, M + H, 1);
    const box = S.d;
    return Math.max(box, -furniture(L, f, h, under, over));
  }

  const ancestors = new Map(); // level -> where its cell sits in its parent
  // (rule: where the space allows a room, as spaceRoom in the GLSL; none, everywhere.)
  const built = (id, seed, rule) => (!rule || rule(id, seed)) && h01(hashCell(id, seed ^ salt.built)) >= spec.solid;

  // dg is the point along the diagonals (see Position.levels). Without it they
  // are worked out from L and f, which is only good far from any such surface.
  // For finding a way through the halls (see planner.js): a cell's room, if
  // it has one (its height, its middle in its lattice units, and whether
  // piers stand in it, which a way across it must go round), and the
  // openings in its six faces, each as the middle of where it crosses the
  // face, the way across it (e), and the cell on the other side. (Of a row
  // of three windows or arches, the middle one.) The same hashes as above.
  function hallsRoom(id, seed, rule) {
    if (!built(id, seed, rule)) return null;
    const H = h01(hashCell(id, seed)) < spec.low ? HLO : HHI;
    // (As furniture has it: piers, unless over or under a light well.)
    const t = h01(hashCell(id, seed ^ salt.furniture));
    const under = h01(hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab)), over = h01(hashCell(id, seed ^ salt.slab));
    return { H, middle: [C, M + H / 2, C], piers: t >= stands.none && t < stands.piers && Math.max(under, over) < slab.oculus };
  }
  function hallsOpenings(id, seed, rule) {
    const here = built(id, seed, rule);
    const out = [];
    for (const [a, sign] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1], [1, -1]]) {
      const e = [0, 0, 0];
      e[a] = sign;
      const nb = wrapId(id.map((x, b) => x + e[b]));
      if (!here && !built(nb, seed, rule)) continue;
      // A face belongs to the cell on its lower side.
      const owner = sign > 0 ? id : nb;
      const at = [C, 0, C];
      at[a] = sign > 0 ? R : 0;
      if (a === 1) {
        if (h01(hashCell(owner, seed ^ salt.slab)) < slab.solid) continue;
      } else {
        const s = wallShape(hashCell(owner, seed ^ (a === 0 ? salt.wallX : salt.wallZ)), C, 0);
        if (!s) continue;
        at[a === 0 ? 2 : 0] = s.cu;
        at[1] = M + s.y0 + Math.min(s.top, s.sp + s.hw) / 2;
      }
      out.push({ e, at, nb });
    }
    return out;
  }

  // The halls cell's distance at L + f (dg: its diagonals, see pieces.at). And
  // if ray is given ({ dir }), for a ray along dir from there: how far it goes
  // in the piece of air it is in (reach, in lattice units; less than 0, in
  // solid), and the surface it meets there (nx, ny, nz); known says whether
  // the cell answers that (here, always).
  function hallsAir(L, f, id, seed, dg, rule, ray) {
    at(L, f, dg);
    if (ray) aim(ray);
    const here = built(id, seed, rule);
    const H = here && h01(hashCell(id, seed)) < spec.low ? HLO : HHI;
    let room = NONE;
    const hup = hashCell(id, seed ^ salt.slab);
    const hdn = hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab);
    const hf = hashCell(id, seed ^ salt.furniture);
    if (here) {
      room = roomAir(L, f, H, hf, h01(hdn), h01(hup));
      through(ray, room, () => roomAir(L, f, H, hf, h01(hdn), h01(hup)));
    }
    // Openings reach only one unit into the room; deeper in, they change nothing.
    if (room < -1) return room;

    // Only the nearer face on each axis can matter to a point in this cell.
    const hx = beyond(L[0], f[0], C), hz = beyond(L[2], f[2], C), hy = beyond(L[1], f[1], M + H / 2);
    const ox = hx ? id : wrapId([id[0] - 1, id[1], id[2]]);
    const oz = hz ? id : wrapId([id[0], id[1], id[2] - 1]);
    let hwx = hashCell(ox, seed ^ salt.wallX), hwz = hashCell(oz, seed ^ salt.wallZ), hwy = hy ? hup : hdn;
    if (!here) {
      // A face has an opening only if there is a room on one side of it at
      // least. From a room, an opening into a solid cell is a niche.
      if (!built(wrapId([id[0] + (hx ? 1 : -1), id[1], id[2]]), seed, rule)) hwx = 0;
      if (!built(wrapId([id[0], id[1], id[2] + (hz ? 1 : -1)]), seed, rule)) hwz = 0;
      if (!built(wrapId([id[0], id[1] + (hy ? 1 : -1), id[2]]), seed, rule)) hwy = 0;
    }
    const wx = () => wallOpening(1, L[0], f[0], L[2], f[2], L[1], f[1], hx, hwx, 0, 2);
    const wz = () => wallOpening(0, L[2], f[2], L[0], f[0], L[1], f[1], hz, hwz, 2, 0);
    const wy = () => slabOpening(L, f, hy, H, hwy);
    const ax = wx(), az = wz(), ay = wy();
    through(ray, ax, wx);
    through(ray, az, wz);
    through(ray, ay, wy);

    // From inside the slab over a low room, the nearest air may be the room
    // above. This cell says nothing else about its neighbours' rooms.
    const above = Math.max(M - L[0] - f[0], L[0] - (R - M) + f[0], M - L[2] - f[2], L[2] - (R - M) + f[2], R + M - L[1] - f[1]);

    const a = Math.min(room, above, ax, az, ay);
    if (a <= 0) return a;

    // In solid, a must not overstate how far the nearest air is (see the GLSL).
    const q = [L[0] + f[0], L[1] + f[1], L[2] + f[2]];
    const edge = Math.min(q[0], R - q[0], q[1], R - q[1], q[2], R - q[2]);
    const unseen = Math.min(Math.abs(q[0] - C) + (C - M - 1), Math.abs(q[2] - C) + (C - M - 1), Math.abs(q[1] - (M + H / 2)) + (HLO / 2 - 1), edge + M);
    return Math.min(a, unseen);
  }

  const halls = {
    name: 'halls',
    R,
    glsl: hallsGlsl + /* glsl */ `
bool spaceRoom(ivec3 id, uint seed) { return true; }
float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {
  return hallsCell(L, f, id, seed, reach, nrm);
}
`,
    cellAir: (L, f, id, seed, dg, level, up, ray) => hallsAir(L, f, id, seed, dg, null, ray),
    maxInterior: 0.375,
    longestWay: 1.4,
    close: 0.3,
    openArea: 0.07,

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
    // For finding ways (see planner.js): a cell's room and its openings.
    room: (id, seed) => hallsRoom(id, seed),
    openings: (id, seed) => hallsOpenings(id, seed),
  };
  return { space: halls, spec, glsl: hallsGlsl, air: hallsAir, room: hallsRoom, openings: hallsOpenings, built };
}

// The halls as they are (and their parts, for the spaces built on them).
export const madeHalls = makeHalls();
export default madeHalls.space;
