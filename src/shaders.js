import { glf } from './util.js';
import { lightGlsl } from './schemes.js';


// Lattice units of margin on "this level is solid for at least this far"
// (here, and in how far off view.js says each level's air is).
export const SLACK = 0.05;
export { slantCount4 };

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// A space's slants (see Position.levels): for each level, each slant's
// m . (L + f) as a lattice number and a small offset, four to a uniform.
const slantCount4 = (space) => Math.ceil((space.slants?.length ?? 0) / 4);
function slantUniforms(space) {
  if (!space.slants?.length) return '';
  return `#define NSL ${space.slants.length}
#define NSL4 ${slantCount4(space)}
uniform ivec4 uLs[NLEV * NSL4];
uniform vec4 uFs[NLEV * NSL4];`;
}
// The point being asked about, along the slants (set by levelRay), and the
// signed distance numerator of a plane across slant k: m . X - c, for X in
// the cell's lattice units, as diag() is for the diagonals.
function slantGlsl(space) {
  if (!space.slants?.length) return '';
  return `const ivec3 SLANT[NSL] = ivec3[NSL](${space.slants.map(([x, y, z]) => `ivec3(${x}, ${y}, ${z})`).join(', ')});
// The point being asked about (set by levelRay), from which slantAt works
// out m . (L + f) along slant k only when it is asked for: as a whole number
// (n) and the rest (returned), as levelRay splits L and f.
int gSi;
vec3 gSv;
ivec3 gSc;
float slantAt(int k, out int n) {
  ivec3 m = SLANT[k];
  float s = uFs[gSi * NSL4 + k / 4][k % 4] + dot(vec3(m), gSv) * uSig[gSi];
  float r = floor(s + 0.5);
  n = uLs[gSi * NSL4 + k / 4][k % 4] + int(r) - (m.x * gSc.x + m.y * gSc.y + m.z * gSc.z) * R;
  return s - r;
}
`;
}

// Shared by the programs that look at the world (the probe and both ways of
// drawing it): the per-level description of where the camera is
// (see Position.levels), and levelAir(), which evaluates one level of the
// world at a point given as a camera-relative offset v in level-F cell units.
function common(nlev, space) {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;

#define NLEV ${nlev}
#define R ${space.R}
#define P ${space.R * space.R}
#define MAX_IN ${glf(space.maxInterior)}
#define LONGEST ${glf(space.longestWay)}
#define CLOSE ${glf(space.close)}
#define OPEN_AREA ${glf(space.openArea)}

uniform ivec3 uL[NLEV];
uniform vec3 uFr[NLEV];
uniform ivec3 uId[NLEV];
uniform ivec3 uPid[NLEV];  // the id of the cell's parent
// The space's table (see volume in worlds.js).
uniform highp usampler3D uVolume;
${space.tables.map((t) => `// The space's table ${t.name} (see tables in worlds.js).\nuniform highp isampler2D ${t.name};`).join('\n')}
uniform uint uSeed[NLEV];
uniform int uLevel[NLEV];
uniform float uSig[NLEV];
// The same split for the sum (p) and difference (m) of each pair of axes
// (x, y), (z, y), (x, z): see Position.levels.
uniform ivec3 uLp[NLEV];
uniform vec3 uFp[NLEV];
uniform ivec3 uLm[NLEV];
uniform vec3 uFm[NLEV];
${slantUniforms(space)}

uint hashCell(ivec3 p, uint s) {
  uint h = (uint(p.x) * 0x9E3779B1u) ^ (uint(p.y) * 0x85EBCA77u) ^ (uint(p.z) * 0xC2B2AE3Du) ^ s;
  h ^= h >> 16; h *= 0x7FEB352Du; h ^= h >> 15; h *= 0x846CA68Bu; h ^= h >> 16;
  return h;
}

// Cell ids repeat with period P. (Done in floats: integer division is slow
// on GPUs, and these integers are small enough to be exact.)
ivec3 wrapId(ivec3 a) { return a - P * ivec3(floor((vec3(a) + 0.5) * (1.0 / float(P)))); }

// What every world's cells share: the middle of a cell; the axes; a hash's
// top bits as a number in [0, 1); and whether x + f is on the upper side of
// c (L alone is rounded, and can put a point half a unit on the wrong side).
// (The JavaScript's are in pieces.js.)
const int C = R / 2;
const vec3 EX = vec3(1.0, 0.0, 0.0), EY = vec3(0.0, 1.0, 0.0), EZ = vec3(0.0, 0.0, 1.0);
float h01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
bool beyond(int x, float f, int c) { return x > c || (x == c && f >= 0.0); }

// What a space uses to answer for a ray (see glsl in worlds.js). Lengths are in
// the level's lattice units. With distance, a level's air is shrunk back from
// its surfaces by gO, which grows by gA for each unit the ray travels, so the
// faces below are planes that move as the ray goes.
bool gRay;        // is a ray being asked about?
vec3 gDir;        // its direction
float gO, gA;
// (And the point's footprint, a pixel, as a fraction of the level's cell
// (seen from the side it is, for a ray), and how fast it grows with each
// unit the ray travels: for what fades at its own, finer scale.)
float gScale = 0.0, gScaleRate = 0.0;
// (The sizes, in pixels, at which a level is carved fully and not at all:
// see lean below.)
const float LOD_LO = 8.0;
const float LOD_HI = 24.0;
const float LOD_K = 1.0 / (1.0 / LOD_LO - 1.0 / LOD_HI);
float gX;         // how far the ray can go
vec3 gN;          // the surface it meets there, facing the air
bool gSkin;       // that air is only the coarser level's surface, cut back
                  // (its relief): coloured as that level's, not this one's
float gIn, gOut;
vec3 gInN;

// A face of a convex piece of air that the point is in: s is the point's
// distance outside it (so not positive), n points out of the piece. (Asked
// about a piece the point is not in, it finds nothing that means anything.)
void face(float s, vec3 n) {
  float r = dot(n, gDir) + gA;
  if (r > 0.0) {
    float x = max(-(s + gO), 0.0) / r;
    if (x < gX) { gX = x; gN = -n; }
  }
}

// A convex solid standing in that piece, which the point is outside: g is the
// point's distance outside each face, n points out of the solid.
void solidBegin() { gIn = -1e30; gOut = 1e30; }
void solidFace(float g, vec3 n) {
  float r = dot(n, gDir) - gA;
  float c = g - gO;
  if (r < 0.0) {
    float x = c / -r;
    if (x > gIn) { gIn = x; gInN = n; }
  } else if (r > 0.0) gOut = min(gOut, -c / r);
  else if (c > 0.0) gOut = -1.0;
}
void solidEnd() {
  gIn = max(gIn, 0.0);
  if (gIn < gOut && gIn < gX) { gX = gIn; gN = gInN; }
}

// A space gives each convex piece of a cell, air or solid, as the planes that
// bound it, one call each: s is the point's distance outside the plane
// (negative inside) and n its normal, pointing out of the piece. The piece's
// distance is the most of those (gD); and for a ray, the same planes are
// where it leaves the piece of air or strikes the solid, so the two cannot
// disagree. Begin a piece with airPiece() or solidPiece(). After a piece of
// air the point is in, gX and gN are where the ray leaves it (where the
// point is not in it, they mean nothing). solidDone() ends a solid, adding
// where the ray strikes it, and gives its distance.
float gD;
void airPiece() { gD = -1e30; gX = 1e30; }
void airPlane(float s, vec3 n) {
  gD = max(gD, s);
  if (gRay) face(s, n);
}
void solidPiece() {
  gD = -1e30;
  if (gRay) solidBegin();
}
void solidPlane(float s, vec3 n) {
  gD = max(gD, s);
  if (gRay) solidFace(s, n);
}
float solidDone() {
  if (gRay) solidEnd();
  return gD;
}
// Two planes across e, inside when x0 <= x + f <= x1.
void airSpan(int x, float f, int x0, int x1, vec3 e) {
  airPlane(float(x0 - x) - f, -e);
  airPlane(float(x - x1) + f, e);
}
void solidSpan(int x, float f, int x0, int x1, vec3 e) {
  solidPlane(float(x0 - x) - f, -e);
  solidPlane(float(x - x1) + f, e);
}

// The id of the parent of the cell being asked about (set by levelRay).
ivec3 gUp;

// The point being asked about, along the diagonals (set by levelRay).
ivec3 gLp, gLm;
vec3 gFp, gFm;

// For the pair of axes p = (a, b): sa * (a - ca) + sb * (b - cb) - k, where
// sa and sb are 1 or -1. A 45-degree plane's distance is this over root two.
// A space must form such distances this way and not from L and f, whose
// offsets cancel close to the plane.
float diag(int p, int sa, int sb, int ca, int cb, int k) {
  return sa == sb ? float(sa * (gLp[p] - ca - cb) - k) + float(sa) * gFp[p]
                  : float(sa * (gLm[p] - ca + cb) - k) + float(sa) * gFm[p];
}

${slantGlsl(space)}
${space.glsl}
// (What fraction of a surface (its normal n) opens at a level, there: see
// the detail asked after in main. gOwnInk: what opens at that level there
// is a building's own relief or openings, so it is drawn in the surface's
// shadow, not as the level's walls: decided by where the surface is, never
// by the way the ray came to it.)
bool gOwnInk;
${space.openAreaGlsl}

// One level at the camera-relative point v: its air distance and, for the ray
// gDir when gRay is set, how far that goes before leaving the air it is in.
// The cell of level i that v is in: the point in it (I - c R, f), and c,
// where it is from the level's own cell. (Re-split into lattice point + small
// offset: integers stay integers, so the compiler cannot fold the offset into
// a large number and lose it.)
ivec3 levelCell(int i, vec3 v, out ivec3 I, out vec3 f) {
  vec3 s = uFr[i] + v * uSig[i];
  vec3 r = floor(s + 0.5);
  f = s - r;
  I = uL[i] + ivec3(r);
  ivec3 J = I - ivec3(lessThan(f, vec3(0.0)));
  return ivec3(floor((vec3(J) + 0.5) / float(R)));
}
// (Its id, and its parent's, gUp.)
ivec3 levelId(int i, ivec3 c) {
  vec3 own = vec3(uId[i] - R * ivec3(floor((vec3(uId[i]) + 0.5) / float(R))));
  gUp = wrapId(uPid[i] + ivec3(floor((own + vec3(c) + 0.5) / float(R))));
  return wrapId(uId[i] + c);
}
float levelRay(int i, vec3 v, out float reach, out vec3 nrm) {
  ivec3 I;
  vec3 f;
  ivec3 c = levelCell(i, v, I, f);
  float sg = uSig[i];
  vec3 sp = uFp[i] + vec3(v.x + v.y, v.z + v.y, v.x + v.z) * sg;
  vec3 sm = uFm[i] + vec3(v.x - v.y, v.z - v.y, v.x - v.z) * sg;
  vec3 rp = floor(sp + 0.5), rm = floor(sm + 0.5);
  gFp = sp - rp;
  gFm = sm - rm;
  gLp = uLp[i] + ivec3(rp) - ivec3(c.x + c.y, c.z + c.y, c.x + c.z) * R;
  gLm = uLm[i] + ivec3(rm) - ivec3(c.x - c.y, c.z - c.y, c.x - c.z) * R;
${space.slants?.length ? '  gSi = i;\n  gSv = v;\n  gSc = c;' : ''}
  // (The cell's index in its parent is its id's last digit; carried over
  // into the parent's neighbours as c goes past them.)
  ivec3 id = levelId(i, c);
  gSkin = false;
  return cell(I - c * R, f, id, uSeed[i], uLevel[i], reach, nrm);
}

// (o: how far the level's air is shrunk there, for the spaces that fade
// their own way and take it out again: see gO; s: the footprint, gScale.)
float levelAir(int i, vec3 v, float o, float s) {
  float reach;
  vec3 nrm;
  gRay = false;
  gO = o;
  gA = 0.0;
  gScale = s;
  gScaleRate = 0.0;
  return levelRay(i, v, reach, nrm);
}
`;
}

// Points a probe can be asked about at once (see probeFrag).
export const PROBE_POINTS = 64;

// Two pixels per level and point (a row each, camera-relative), to check the
// JavaScript twin against: that level's air distance at the point; or, if
// uProbeDir is not nothing, what it says of a ray from there along it, as
// the world is (not shrunk with distance): the distance and how far the ray
// goes in its air (less than 0, none), and in the next pixel the surface
// it meets there.
export function probeFrag(nlev, space) {
  return (
    common(nlev, space) +
    /* glsl */ `
uniform vec3 uProbeV[${PROBE_POINTS}];
uniform vec3 uProbeDir;
out vec4 outColor;
void main() {
  int i = int(gl_FragCoord.x) / 2;
  vec3 v = uProbeV[int(gl_FragCoord.y)];
  if (uProbeDir == vec3(0.0)) {
    outColor = vec4(levelAir(i, v, 0.0, 0.0), 0.0, 0.0, 1.0);
    return;
  }
  gRay = true;
  gDir = uProbeDir;
  gO = 0.0;
  gA = 0.0;
  gScale = 0.0;
  gScaleRate = 0.0;
  float reach;
  vec3 nrm;
  float a = levelRay(i, v, reach, nrm);
  outColor = int(gl_FragCoord.x) % 2 == 0 ? vec4(a, reach, 0.0, 1.0) : vec4(nrm, 1.0);
}`
  );
}

// exact: step each ray from one piece of air to the next (the renderer).
// Otherwise: step by the safe distance (sphere tracing, kept to check against).
export function viewFrag(nlev, space, exact) {
  // (Where a level's air is open at every distance (the space's openAir: see
  // OPEN_AIR), what is said of it here and only then.)
  const open = space.openAir != null, ifOpen = (text, otherwise = '') => (open ? text : otherwise);
  return (
    common(nlev, space) +
    /* glsl */ `
#define EXACT ${exact ? 1 : 0}
${ifOpen(`// The level whose air is open at every distance (see openAir in
// worlds.js): it is not left out for being small or far itself. What
// of it fades (all but its open air) the space fades its own way: see gScale.
#define OPEN_AIR ${space.openAir}
`)}uniform int uN;            // levels in use, coarsest first
uniform float uNear[NLEV]; // how far from the camera each level's nearest air is
uniform vec3 uWall[NLEV];
uniform vec3 uFloor[NLEV];
uniform vec2 uRes;
uniform float uLodH;       // pixels down the picture that detail is sized for (see lodH in main.js)
uniform vec2 uJitter;      // where in its pixel this frame's ray goes (see TAAU_FRAG in frame.js)
uniform mat3 uCam;
uniform float uTan;        // tan(fov / 2)
uniform float uScale;      // our clearance, smoothed
uniform float uFogLen;
uniform float uMaxT;
uniform float uFogK;       // how far we see inside a level's air, over its uSig
// The air we are in may belong to a level too coarse to draw (we are very
// close to one of its surfaces, which has not opened for many levels). Then
// this stands in for it: the surface as a plane, air on the side its normal
// (xyz) points to, the camera w from it. Off when w < 0.
uniform vec4 uOuter;
// How far the camera is above the plane over which there is only sky
// (negative: below it).
uniform float uSkyH;
// How far under that plane sunlight can come in whatever we see from (see
// sunReach in worlds.js).
uniform float uSunReach;
// The scheme's lights (see SCHEME in schemes.js): uSun, the sun's strength;
// uSunDir, toward it.
${lightGlsl()}
uniform vec3 uOuterWall;
uniform vec3 uOuterFloor;
uniform int uDebug;       // 1: steps per pixel; 2: skip nothing; 3: levels; 4: distance; 5: the distance's log2, whole part and rest (the tour's look)
uniform float uStride;     // draw only every this many pixels (see Renderer.look)
uniform vec2 uToOut;       // the picture's pixels per pixel drawn, each way (temporal upscaling: see TAAU_FRAG in frame.js)

out vec4 outColor;

const int STEPS = EXACT == 1 ? 96 : 160;
// A level's cells are carved as geometry between these sizes in pixels, so
// that nothing much under a pixel wide is ever carved (it would only
// shimmer). Below that the level shows as surface texture: see the detail
// asked after in main.
// In between, its air is shrunk back from its surfaces, by an amount that
// grows evenly with distance (so that a ray's way out of a piece of air is
// still where a straight line crosses a plane).
// Sizes are as seen. An opening in a surface seen at a slant is foreshortened
// across it by the cosine between the surface and the line of sight (a pit
// in the ground far off is a wide, thin sliver), and what counts is its area
// on screen: so it goes by its size face on times lean(), the root of that
// cosine. The surface is, for a ray that has met one, the one it met; while
// marching, the one the ray is about to cross (its way out of the coarser
// air it is in) or, where no coarser level has air, the one it has just
// crossed: either way, the surface that finer levels cut their openings into.
// (LOD_LO, LOD_HI and LOD_K are above, with gScale, for the spaces too.)
float lean(vec3 n, vec3 dir) { return sqrt(max(abs(dot(n, dir)), 1e-6)); }
// (But no more than this, for whether a level is carved: where a ray grazes
// a surface it is mostly at a silhouette or an arris, where what is cut into
// the surface shows in profile, not foreshortened: looking up a ridge, its
// relief would otherwise be left out until one was nearly upon it.)
const float LEAN_MIN = 0.6;
// A sun ray is tried only from at most this many fog lengths under the
// ground, and gets at most this many steps to come out.
const float SUN_DEPTH = 1.0;
const int SUN_STEPS = 48;

// Per ray: for each level, how far along the ray it is known to stay solid.
float gSolid[NLEV];
// Per line of sight: where it came into the biggest air it has been in
// (bigger than the air we are in), and how far one sees inside that air.
// From there on it sees that far: a great hall seen through a doorway from a
// small room is not lost in the haze of the room.
float gWideT, gWideFog;
const float SLACK = ${glf(SLACK)};

// Distance to the nearest solid from camera-relative point v. Solid is what
// is left after every level has carved out its air, so this is the largest
// clearance any single level gives us. foot is the pixel footprint here and
// along is the distance from the camera; advance says this is a step of the
// ray itself, so what it learns can be remembered. (Only the older way of
// stepping rays, kept to check against, uses this; main asks the same for
// its ambient occlusion in its own loop, as this does.)
float map(vec3 v, float foot, float along, bool advance, out int slot) {
  float d = -1e20;
  slot = 0;
  if (uOuter.w >= 0.0) {
    d = dot(uOuter.xyz, v) + uOuter.w;
    slot = -1;
  }
  if (v.y + uSkyH > d) {
    d = v.y + uSkyH;
    slot = -2;
  }
  for (int i = 0; i < NLEV; i++) {
    if (i >= uN) break;
    if (along < gSolid[i]) continue;   // nothing but solid at this level yet
    float cell = float(R) / uSig[i];
    if (d > MAX_IN * cell${ifOpen(' && uLevel[i] != OPEN_AIR')}) break;      // already in bigger air than this level has
    float px = cell / foot;
    if (px < LOD_LO${ifOpen(' && uLevel[i] != OPEN_AIR')}) break;            // too small to see: leave it solid
    float a = levelAir(i, v, CLOSE * float(R) * clamp((foot / cell - 1.0 / LOD_HI) * LOD_K, 0.0, 1.0), foot / cell);
    if (advance && a > SLACK) gSolid[i] = along + (a - SLACK) / uSig[i];
    float w = -a / uSig[i];
    w -= clamp((foot / cell - 1.0 / LOD_HI) * LOD_K, 0.0, 1.0) * CLOSE * cell;
    // The surface takes its colour from the level whose air we are in. Where
    // two levels' air ends on the same plane (an opening that distance has
    // shrunk back flush with the wall it opens through), that is a coin toss
    // per pixel, so a finer level has to win clearly.
    if (w > d) {
      if (w > d + foot) slot = gSkin ? i - 1 : i;
      d = w;
    }
  }
  return d;
}

// Wherever a ray is, it is in some level's air, inside one convex piece of
// it, and stays in air at least until it leaves that piece. So: go straight
// to the furthest such way out, and look again. If no level has air there,
// that way out was a surface.
// The ray sets out from o (camera-relative) along dir, and goes at most maxT
// in at most most steps. Levels fade with distance as for a ray that set out
// t0 before o: the camera's own rays have t0 = 0. Returns how far it went;
// hit: it met a surface (or ran out of steps), of level slot, facing n;
// open: it went up into the sky. seen: this ray is a line of sight, so sizes
// are as foreshortened along it (the sun's rays leave them as they are).
// gSolid must be set beforehand.
float march(vec3 o, vec3 dir, float t0, float pix, float maxT, int most, bool seen,
            out bool hit, out bool open, inout int slot, inout vec3 n, inout int steps) {
  float t = 0.0;
  hit = false;
  open = false;
  gDir = dir;
  for (int k = 0; k < most; k++) {
    steps++;
    float far = t0 + t;
    float foot = max(far * pix, 1e-12);
    vec3 v = o + dir * t;
    float best = -1.0;
    int from = slot;
    vec3 bn = n;
    if (uOuter.w >= 0.0) {
      float above = dot(uOuter.xyz, v) + uOuter.w;
      if (above > 0.0) {
        float fall = -dot(uOuter.xyz, dir);
        best = fall > 0.0 ? above / fall : 2.0 * maxT;
        from = -1;
        bn = uOuter.xyz;
      }
    }
    // Above the ground there is nothing: a ray going up is gone, and one
    // coming down has a clear run to the ground.
    float high = v.y + uSkyH;
    if (high > 0.0) {
      if (dir.y >= 0.0) { open = true; break; }
      float e = high / -dir.y;
      if (e > best) {
        best = e;
        from = -2;
        bn = vec3(0.0, 1.0, 0.0);
      }
    }
    for (int i = 0; i < NLEV; i++) {
      if (i >= uN) break;
      if (t < gSolid[i]) continue;        // nothing but solid at this level yet
      float cell = float(R) / uSig[i];
${ifOpen(`      bool openAir = uLevel[i] == OPEN_AIR;
`)}      if (best > LONGEST * cell${ifOpen(' && !openAir')}) break;   // already going further than this level could take us
      if ((foot / cell - 1.0 / LOD_HI) * LOD_K >= 1.0${ifOpen(' && !openAir')}) break; // too small to see even face on: leave it solid
      float slant = seen ? max(lean(bn, dir), LEAN_MIN) : 1.0;
      float rel = (foot / (slant * cell) - 1.0 / LOD_HI) * LOD_K;
      if (rel >= 1.0${ifOpen(' && !openAir')}) continue;           // too foreshortened to see
${ifOpen(`      // (The open level, faded fully, stays so: its open air as it is, the
      // rest gone; see gScale.)
      rel = min(rel, 1.0);
`)}      gO = CLOSE * float(R) * max(rel, 0.0);
      gA = rel > 0.0${ifOpen(' && rel < 1.0')} ? CLOSE * LOD_K * pix / slant : 0.0;
      gScale = foot / (slant * cell);
      gScaleRate = pix / (slant * float(R));
      gRay = true;
      float reach;
      vec3 nn;
      float a = levelRay(i, v, reach, nn);
      if (reach >= 0.0) {
        float fog = uFogK / uSig[i];
        if (seen && fog > 1.5 * gWideFog) {
          gWideFog = fog;
          gWideT = t0 + t;
          maxT = max(maxT, t + 4.0 * fog);
        }
        // The shrinking changes pace where the level starts to fade and
        // where it is gone: go no further than that in one step.
        float turn = ${ifOpen('rel >= 1.0 ? 1e30 : ')}slant * cell / ((rel > 0.0 ? LOD_LO : LOD_HI) * pix);
        float e = min(reach / uSig[i], max(turn - far, 0.0));
        if (e > best) {
          // The surface takes its colour from the level whose air we are
          // leaving; a finer level has to be clearly the one.
          if (e > best + foot) from = gSkin ? i - 1 : i;
          best = e;
          bn = nn;
        }
      } else if (uDebug != 2 && a > SLACK) gSolid[i] = t + (a - SLACK) / uSig[i];
    }
    if (best < 0.0) { hit = true; break; }
    slot = from;
    n = bn;
    // Step just past the way out, so as to be inside whatever comes next.
    // (Some way, even setting out from the camera: a camera exactly on the
    // plane it is leaving by would otherwise never leave.)
    t += best;
    t += 0.02 * pix * max(t0 + t, 1e-3 * uScale);
    if (t > maxT) break;
  }
  if (t <= maxT && !open) hit = true;
  return t;
}

// Value noise, for the sky.
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise2(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// Open sky, seen along rd from col (the haze at the horizon): bluer overhead,
// a sun, clouds, and hills along the horizon. All of it is infinitely far
// off, as befits a world with no size.
vec3 openSky(vec3 col, vec3 rd) {
  float up = max(rd.y, 0.0);
  col = mix(col, uZenith, pow(up, 0.55));
  float sun = max(dot(rd, uSunDir), 0.0);
  col += uSunCol * (0.3 * pow(sun, 16.0) + 6.0 * pow(sun, 1500.0)) * uDisc;

  // Stars: a few of the cells of a fine grid of directions hold one.
  if (uStars > 0.0) {
    vec3 c = rd * 260.0;
    float h = fract(sin(dot(floor(c), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float b = max(h - 0.993, 0.0) / 0.007;
    col += uStars * (0.3 + b) * step(0.993, h) * smoothstep(0.5, 0.15, length(fract(c) - 0.5)) * smoothstep(0.0, 0.12, rd.y);
  }

  // Clouds: a layer overhead, thinning out toward the horizon, lit by the
  // sun as bright as it is. More cloud than usual covers more of the sky.
  if (uClouds > 0.0) {
    vec2 q = rd.xz / (up + 0.06) * 0.9;
    float c = fbm(q + vec2(3.1, 7.7));
    float cover = smoothstep(0.52 - 0.1 * max(uClouds - 1.0, 0.0), 0.78, c) * smoothstep(0.02, 0.25, up);
    float shade = smoothstep(0.5, 0.9, fbm(q * 1.7 + vec2(0.4, 2.3) + 0.6 * uSunDir.xz));
    vec3 cloud = mix(vec3(1.0, 0.98, 0.95) * (0.5 + 0.5 * min(uDisc, 1.0)), mix(uSky, uZenith, 0.3) * 0.95, 0.55 * shade);
    col = mix(col, cloud, min(0.85 * uClouds, 0.95) * cover);
  }

  // Hills: two ranges, the further one higher and paler. Sampled round a
  // circle so that they join up behind us.
  vec2 ring = normalize(rd.xz + vec2(1e-6, 0.0));
  float lit = 0.5 + 0.5 * dot(ring, normalize(uSunDir.xz));
  float far = 0.012 + 0.07 * smoothstep(0.38, 0.8, fbm(ring * 2.6 + vec2(11.0, 4.0)));
  float near = 0.004 + 0.035 * smoothstep(0.35, 0.85, fbm(ring * 6.0 + vec2(3.0, 8.0)));
  vec3 farCol = mix(uSky, uZenith, 0.5) * mix(0.82, 0.95, lit);
  vec3 nearCol = mix(uSky, uZenith, 0.35) * mix(0.62, 0.78, lit);
  float rise = smoothstep(0.0, 0.015, rd.y);   // their feet are lost in the haze
  col = mix(col, farCol, (1.0 - smoothstep(far - 0.001, far + 0.001, rd.y)) * rise * 0.8);
  col = mix(col, nearCol, (1.0 - smoothstep(near - 0.001, near + 0.001, rd.y)) * rise * 0.85);
  return col;
}

// What is seen along rd where nothing is hit: the haze, or the open sky.
vec3 beyond(vec3 rd, bool open) {
  vec3 col = uSky * (1.0 + 0.15 * rd.y);
  return open ? openSky(col, rd) : col;
}

// The colour of a surface of level slot facing n, before it is lit.
// (Ceilings are coloured as floors.)
vec3 surfaceColour(int slot, vec3 n) {
  float flatness = smoothstep(0.5, 0.9, abs(n.y));
  return slot == -2 ? uGround
       : slot < 0 ? mix(uOuterWall, uOuterFloor, flatness)
                  : mix(uWall[slot], uFloor[slot], flatness);
}

// A surface of colour base facing n, seen along rd from t away, lit: by the
// sky (as open as ao says it is in front of it), the fill light, the light
// we carry, and the sun, as much as reaches it (sunlit), before any haze.
vec3 litBy(vec3 base, vec3 n, vec3 rd, float t, float ao, float sunlit) {
  float hemi = 0.5 + 0.5 * n.y;
  float key = max(dot(n, uSunDir), 0.0);
  float lamp = max(dot(n, -rd), 0.0) / (1.0 + pow(t / (uLampReach * uScale), 2.0));
  vec3 light = (0.15 + 0.85 * ao) * (uSky * uAmbient * mix(0.55, 1.05, hemi) + vec3(1.0, 0.93, 0.8) * key * uFill)
             + vec3(1.0, 0.9, 0.75) * lamp * uLamp
             + uSunCol * uSun * key * sunlit;
  // Where sunlight adds to what was already bright, roll off gently
  // instead of clipping (nothing under 0.8 changes).
  vec3 lit = base * light;
  return mix(lit, 0.8 + 0.2 * (1.0 - exp(-(lit - 0.8) / 0.2)), step(0.8, lit));
}

void main() {
  vec2 uv = ((gl_FragCoord.xy + uJitter) * uStride * uToOut * 2.0 - uRes) / uRes.y;
  vec3 rd = normalize(uCam * vec3(uv * uTan, -1.0));
  float pix = 2.0 * uTan / uLodH;

  float t = 0.0, d = 0.0;
  int slot = 0, steps = 0;
  bool hit = false, open = false;
  vec3 n = -rd;
  // How far we see goes by the space we are in: out in the open, by how high
  // we are (uFogLen). But a ray that goes down into a cavity in the ground is
  // in that cavity from there on, and sees as far as it would from inside:
  // by the cavity's size (that of the coarsest level whose air it is).
  float down = 1e30, fogIn = uFogLen, maxT = uMaxT;
  bool fogDown = false;
  if (uSkyH > 0.0 && rd.y < 0.0) {
    down = uSkyH / -rd.y;
    fogDown = down < 4.0 * uFogLen;
  }

  // The world's levels are asked about points in one place in this program,
  // and rays are marched through them in one other: each place writes out the
  // whole of the world's geometry, and the time it takes to build the
  // program grows steeply with how many there are (for the arcology, two
  // places take about 3 s, three about 11 s: see tests/unit/shader.test.js).
  // So everything that asks goes round one loop, in two phases. Phase 0:
  // where the ray goes down into the ground near enough, whose air it is
  // there (the fog); then the camera's ray. Phase 1, if that met a surface:
  // how open it is in front of the surface, at four points (ambient
  // occlusion), and what finer levels show on it (detail); then, if the sun
  // may reach it, the sun's ray.
  // (The loops' bounds are worked out as the pixel goes, on purpose: a
  // compiler that could count them might write the loop out once for each
  // time round, and each copy would hold the whole geometry again. This
  // one, ANGLE on Metal, does not, by bench/cold.mjs; keep the bounds so,
  // and time any change to these loops with it: the unit test counts only
  // the places written in the source.)
  const int ASK_FOG = 0, ASK_SHADE = 1, ASK_DETAIL = 5, ASKS = 6; // 1 to 4: occlusion's points
  vec3 p = vec3(0.0), base = vec3(0.0);
  float foot = 0.0, seenFoot = 0.0, ao = 0.0, sunlit = 0.0;
  bool sunTried = false;
  int phases = 1;
  for (int ph = 0; ph < phases; ph++) {
    float h = max(2.0 * foot, 0.004 * uScale), wt = 0.4;
    for (int q = ph == 0 ? ASK_FOG : ASK_SHADE; q < (ph == 0 ? (fogDown ? 1 : 0) : ASKS); q++) {
      // Asking about a point: the fog's; occlusion's (each as map finds the
      // distance there: the most clearance any level gives); or the surface
      // itself, for its detail.
      bool occlusion = q > ASK_FOG && q < ASK_DETAIL;
      vec3 v = q == ASK_FOG ? rd * down - vec3(0.0, 0.01 * uScale, 0.0) : occlusion ? p + n * h : p;
      float along = t + h, m = -1e20;
      if (occlusion) {
        if (uOuter.w >= 0.0) m = dot(uOuter.xyz, v) + uOuter.w;
        if (v.y + uSkyH > m) m = v.y + uSkyH;
      }
      for (int i = q == ASK_DETAIL ? max(slot + 1, 0) : 0; i < NLEV; i++) {
        if (i >= uN) break;
        float cell = float(R) / uSig[i];
        bool ask = true;
        float o = 0.0, sc = 0.0, wgt = 0.0, hole = 0.0, sharp = 0.0;
        vec3 ink = vec3(0.0);
        if (q == ASK_FOG) {
          // (Not as far as levels too small to see from here, as with drawing.)
          if (cell < LOD_LO * down * pix${ifOpen(' && uLevel[i] != OPEN_AIR')}) break;
        } else if (occlusion) {
          if (along < gSolid[i]) continue;   // nothing but solid at this level yet
          if (m > MAX_IN * cell${ifOpen(' && uLevel[i] != OPEN_AIR')}) break;      // already in bigger air than this level has
          float px = cell / seenFoot;
          if (px < LOD_LO${ifOpen(' && uLevel[i] != OPEN_AIR')}) break;            // too small to see: leave it solid
          o = CLOSE * float(R) * clamp((seenFoot / cell - 1.0 / LOD_HI) * LOD_K, 0.0, 1.0);
          sc = seenFoot / cell;
        } else {
          // Levels too small to carve still show: their openings are drawn
          // onto the surface as texture, which the real geometry later grows
          // into. Smaller still, the texture dissolves into the average tone
          // it would have had. (In the colour of what it stands for: where
          // the space says what opens at that level is a building's own relief
          // or openings (gOwnInk: see openAreaAt), in the surface's own
          // colour, in its shadow; elsewhere, the level's walls'. Each level
          // as it says, wherever the surface is and however near, never by
          // the way the ray came.) (The average is what the space says opens
          // there, at that level: see openAreaAt; none (0), and nothing finer
          // opens there either; less than 0, nothing of that level, but finer
          // levels may.)
          float px = float(R) / uSig[i] / seenFoot;
          if (px < 0.5) break;
          wgt = (1.0 - smoothstep(0.75, 1.0, smoothstep(LOD_LO, LOD_HI, px))) * smoothstep(0.5, 4.0, px);
          if (wgt <= 0.0) continue;
          ivec3 I;
          vec3 f;
          ivec3 id = levelId(i, levelCell(i, v, I, f));
          hole = openAreaAt(uLevel[i], id, gUp, n);
          if (hole < 0.0) continue;
          if (hole == 0.0) break;
          sharp = smoothstep(2.0, 8.0, px);
          ink = gOwnInk ? base * 0.55 : mix(uWall[i] * 0.5, uWall[i], uInlay);
          ask = sharp > 0.0;
        }
        float a = ask ? levelAir(i, v, o, sc) : 0.0;
        if (q == ASK_FOG) {
          if (a < 0.0) { fogIn = max(uFogK / uSig[i], uFogLen); break; }
        } else if (occlusion) {
          float w = -a / uSig[i];
          w -= clamp((seenFoot / cell - 1.0 / LOD_HI) * LOD_K, 0.0, 1.0) * CLOSE * cell;
          if (w > m) m = w;
        } else {
          if (ask) {
            hole = mix(hole, 1.0 - smoothstep(-seenFoot, 0.5 * seenFoot, a / uSig[i]), sharp);
            // (Relief is the surface's own, in its shadow.)
            if (gSkin) ink = mix(ink, base * 0.55, sharp);
          }
          base = mix(base, ink, hole * wgt * mix(0.8, 1.0, uInlay));
        }
      }
      if (occlusion) {
        ao += wt * clamp(m / h, 0.0, 1.0);
        h *= 4.7;
        wt *= 0.7;
      }
    }

    // Marching: the camera's ray, or the sun's (does a ray from the surface
    // toward the sun get out into the sky?): from o along dir, as if set out
    // t0 before it, at most so far in so many steps.
    vec3 o, dir;
    float t0, far;
    int most;
    if (ph == 0) {
      if (fogDown) maxT = max(maxT, down + (4.0 - down / uFogLen) * fogIn);
      gWideT = fogIn > uFogLen ? down : 1e30;
      gWideFog = fogIn;
      for (int i = 0; i < NLEV; i++) gSolid[i] = uDebug == 2 ? 0.0 : uNear[i];
      o = vec3(0.0); dir = rd; t0 = 0.0; far = maxT; most = STEPS;
    } else {
      ao = clamp(ao / 0.96, 0.0, 1.0);
      if (!sunTried) break;
      for (int i = 0; i < NLEV; i++) gSolid[i] = 0.0;
      o = p + n * foot; dir = uSunDir; t0 = t; far = 1e30; most = SUN_STEPS;
    }
    bool rh, ro;
    int rs = slot, rst = 0;
    vec3 rn = n;
#if EXACT
    float rt = march(o, dir, t0, pix, far, most, ph == 0, rh, ro, rs, rn, rst);
#else
    // (The older way, kept to check against, steps the camera's ray by the
    // safe distance, and finds the surface's facing from how that changes.)
    float rt = 0.0;
    if (ph == 0) {
      rh = false;
      ro = false;
      for (int i = 0; i < STEPS; i++) {
        float ft = max(rt * pix, 1e-12);
        d = map(rd * rt, ft, rt, uDebug != 2, rs);
        rst++;
        if (d < 0.5 * ft) { rh = true; break; }
        rt += d * 0.9;
        if (rt > maxT) break;
      }
      if (rt <= maxT) rh = true;
    } else rt = march(o, dir, t0, pix, far, most, false, rh, ro, rs, rn, rst);
#endif
    if (ph == 1) {
      sunlit = ro ? 1.0 : 0.0;
      break;
    }
    t = rt;
    hit = rh;
    open = ro;
    slot = rs;
    n = rn;
    steps = rst;
    if (!hit || uDebug == 1 || uDebug == 3 || uDebug == 4 || uDebug == 5) break;
    p = rd * t;
    foot = max(t * pix, 1e-5 * uScale);
#if !EXACT
    if (d > -1e19) {
      float e = 0.6 * foot;
      int s2;
      vec3 g = vec3(map(p + vec3(e, 0.0, 0.0), foot, t + e, false, s2),
                    map(p + vec3(0.0, e, 0.0), foot, t + e, false, s2),
                    map(p + vec3(0.0, 0.0, e), foot, t + e, false, s2)) - d;
      if (dot(g, g) > 0.0) n = normalize(g);
    }
#endif
    seenFoot = foot / lean(n, rd); // (what is carved or drawn here goes by this)
    base = surfaceColour(slot, n);
    // (The sun's ray is not tried from too far below the ground for any to
    // come in: further than the space lets sunlight reach, and further than
    // we see from here. Going by how far we see alone, where the space is
    // open well under the ground, shadows came and went as that changed.)
    float key = max(dot(n, uSunDir), 0.0), below = -(p.y + uSkyH);
    sunTried = uSun > 0.0 && key > 0.0 && below < max(SUN_DEPTH * uFogLen, uSunReach);
    phases = 2;
  }

  if (uDebug == 5) {
    // (The distance's log, its whole part and the rest apart: the tour's look
    // is drawn in the view's own half floats, so that the GPU uses the
    // pipeline it built for the view, not another it would build at the
    // first look (ledger B10); so split, half floats hold it to a few parts
    // in ten thousand, at any distance. -1000: nothing hit.)
    float l = hit ? log2(max(t, 1e-30)) : -1000.0;
    outColor = vec4(floor(l), l - floor(l), 0.0, 1.0);
    return;
  }
  if (uDebug == 4) {
    // Distance to what was hit, on a log scale, in 24 bits.
    float v = hit ? clamp((log2(max(t, 1e-30)) + 64.0) / 96.0, 0.0, 1.0) : 1.0;
    float q = floor(v * 16777215.0);
    outColor = vec4(floor(q / 65536.0), mod(floor(q / 256.0), 256.0), mod(q, 256.0), 255.0) / 255.0;
    return;
  }
  if (uDebug == 1) {
    float s = float(steps) / float(STEPS);
    outColor = vec4(s, s > 0.99 ? 0.0 : s * s, s > 0.99 ? 1.0 : 0.0, 1.0);
    return;
  }

  if (uDebug == 3) {
    int sl = slot + 1;
    vec3 tint = vec3(float(sl & 1), float((sl >> 1) & 1), float((sl >> 2) & 1));
    outColor = vec4(mix(vec3(0.2), tint, 0.8) * (0.5 + 0.5 * fract(t * 40.0)), 1.0);
    return;
  }
  vec3 col = beyond(rd, open);
  if (hit) col = mix(col, litBy(base, n, rd, t, ao, sunlit), exp(-min(t, gWideT) / uFogLen - max(t - gWideT, 0.0) / gWideFog));

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  // (And how far off what it saw is, for the next frame to find it again:
  // see TAAU_FRAG in frame.js.)
  outColor = vec4(col, hit ? log2(max(t, 1e-30)) : 1e4);
}`
  );
}
