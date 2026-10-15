const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by both programs: the per-level description of where the camera is
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
#define CLOSE ${glf(space.close)}
#define OPEN_AREA ${glf(space.openArea)}

uniform ivec3 uL[NLEV];
uniform vec3 uFr[NLEV];
uniform ivec3 uId[NLEV];
uniform uint uSeed[NLEV];
uniform float uSig[NLEV];
// The same split for the sum (p) and difference (m) of each pair of axes
// (x, y), (z, y), (x, z): see Position.levels.
uniform ivec3 uLp[NLEV];
uniform vec3 uFp[NLEV];
uniform ivec3 uLm[NLEV];
uniform vec3 uFm[NLEV];

uint hashCell(ivec3 p, uint s) {
  uint h = (uint(p.x) * 0x9E3779B1u) ^ (uint(p.y) * 0x85EBCA77u) ^ (uint(p.z) * 0xC2B2AE3Du) ^ s;
  h ^= h >> 16; h *= 0x7FEB352Du; h ^= h >> 15; h *= 0x846CA68Bu; h ^= h >> 16;
  return h;
}

// Cell ids repeat with period P. (Done in floats: integer division is slow
// on GPUs, and these integers are small enough to be exact.)
ivec3 wrapId(ivec3 a) { return a - P * ivec3(floor((vec3(a) + 0.5) * (1.0 / float(P)))); }

// What a space uses to answer for a ray (see spaces/halls.js). Lengths are in
// the level's lattice units. With distance, a level's air is shrunk back from
// its surfaces by gO, which grows by gA for each unit the ray travels, so the
// faces below are planes that move as the ray goes.
bool gRay;        // is a ray being asked about?
vec3 gDir;        // its direction
float gO, gA;
float gX;         // how far the ray can go
vec3 gN;          // the surface it meets there, facing the air
float gIn, gOut;
vec3 gInN;

// A face of a convex piece of air that the point is in: s is the point's
// distance outside it (so not positive), n points out of the piece.
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
void solidBox(ivec3 L, vec3 f, ivec3 lo, ivec3 hi) {
  solidBegin();
  solidFace(float(lo.x - L.x) - f.x, vec3(-1.0, 0.0, 0.0));
  solidFace(float(L.x - hi.x) + f.x, vec3(1.0, 0.0, 0.0));
  solidFace(float(lo.y - L.y) - f.y, vec3(0.0, -1.0, 0.0));
  solidFace(float(L.y - hi.y) + f.y, vec3(0.0, 1.0, 0.0));
  solidFace(float(lo.z - L.z) - f.z, vec3(0.0, 0.0, -1.0));
  solidFace(float(L.z - hi.z) + f.z, vec3(0.0, 0.0, 1.0));
  solidEnd();
}

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

${space.glsl}

// One level at the camera-relative point v: its air distance and, for the ray
// gDir when gRay is set, how far that goes before leaving the air it is in.
float levelRay(int i, vec3 v, out float reach, out vec3 nrm) {
  // Re-split into lattice point + small offset. Integers stay integers so the
  // compiler cannot fold the offset into a large number and lose it.
  vec3 s = uFr[i] + v * uSig[i];
  vec3 r = floor(s + 0.5);
  vec3 f = s - r;
  ivec3 I = uL[i] + ivec3(r);
  ivec3 J = I - ivec3(lessThan(f, vec3(0.0)));
  ivec3 c = ivec3(floor((vec3(J) + 0.5) / float(R)));
  float sg = uSig[i];
  vec3 sp = uFp[i] + vec3(v.x + v.y, v.z + v.y, v.x + v.z) * sg;
  vec3 sm = uFm[i] + vec3(v.x - v.y, v.z - v.y, v.x - v.z) * sg;
  vec3 rp = floor(sp + 0.5), rm = floor(sm + 0.5);
  gFp = sp - rp;
  gFm = sm - rm;
  gLp = uLp[i] + ivec3(rp) - ivec3(c.x + c.y, c.z + c.y, c.x + c.z) * R;
  gLm = uLm[i] + ivec3(rm) - ivec3(c.x - c.y, c.z - c.y, c.x - c.z) * R;
  return cell(I - c * R, f, wrapId(uId[i] + c), uSeed[i], reach, nrm);
}

float levelAir(int i, vec3 v) {
  float reach;
  vec3 nrm;
  gRay = false;
  return levelRay(i, v, reach, nrm);
}
`;
}

// One pixel per level: that level's air distance at the camera itself.
export function probeFrag(nlev, space) {
  return (
    common(nlev, space) +
    /* glsl */ `
out vec4 outColor;
void main() {
  outColor = vec4(levelAir(int(gl_FragCoord.x), vec3(0.0)), 0.0, 0.0, 1.0);
}`
  );
}

// exact: step each ray from one piece of air to the next (the renderer).
// Otherwise: step by the safe distance (sphere tracing, kept to check against).
export function viewFrag(nlev, space, nThread, exact) {
  return (
    common(nlev, space) +
    /* glsl */ `
#define NT ${nThread}
#define EXACT ${exact ? 1 : 0}
uniform int uN;            // levels in use, coarsest first
uniform float uNear[NLEV]; // how far from the camera each level's nearest air is
uniform vec3 uWall[NLEV];
uniform vec3 uFloor[NLEV];
uniform vec2 uRes;
uniform mat3 uCam;
uniform float uTan;        // tan(fov / 2)
uniform float uScale;      // our clearance, smoothed
uniform float uFogLen;
uniform float uMaxT;
uniform float uFogK;       // how far we see inside a level's air, over its uSig
uniform vec3 uSky;
// The air we are in may belong to a level too coarse to draw (we are very
// close to one of its surfaces, which has not opened for many levels). Then
// this stands in for it: the surface as a plane, air on the side its normal
// (xyz) points to, the camera w from it. Off when w < 0.
uniform vec4 uOuter;
// How far the camera is above the plane over which there is only sky
// (negative: below it).
uniform float uSkyH;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform float uFill;       // lighting scheme: see schemes.js
uniform float uSunK;
uniform vec3 uSunCol;
uniform float uAmbient;
uniform float uLamp;
uniform float uReach;
uniform float uGlow;
uniform float uMirror;
uniform float uDisc;
uniform float uClouds;
uniform float uStars;
uniform float uShafts;
uniform float uInlay;
uniform vec3 uSun;         // toward the sun
uniform vec3 uOuterWall;
uniform vec3 uOuterFloor;
uniform vec3 uThread[NT];  // the way we came, as a polyline, nearest end first
uniform int uThreadN;
uniform int uDebug;       // 1: steps per pixel; 2: skip nothing; 3: levels; 4: distance; 5: distance as a float;
                          // 6: the light the haze catches, alone (see shafts())
uniform sampler2D uShaftTex; // that light, drawn coarser (see Renderer.draw)
uniform float uStride;     // draw only every this many pixels (see Renderer.look)

out vec4 outColor;

const int STEPS = EXACT == 1 ? 96 : 160;
// A level's cells are carved as geometry between these sizes in pixels, so
// that nothing much under a pixel wide is ever carved (it would only
// shimmer). Below that the level shows as surface texture: see detail().
// In between, its air is shrunk back from its surfaces, by an amount that
// grows evenly with distance (so that a ray's way out of a piece of air is
// still where a straight line crosses a plane).
const float LOD_LO = 8.0;
const float LOD_HI = 24.0;
const float LOD_K = 1.0 / (1.0 / LOD_LO - 1.0 / LOD_HI);
// The longest way through any one piece of a cell's air, in cells.
const float REACH = 1.4;
// A sun ray is tried only from at most this many fog lengths under the
// ground, and gets at most this many steps to come out.
const float SUN_DEPTH = 1.0;
const int SUN_STEPS = 48;
// Steps for what a mirror floor reflects.
const int MIRROR_STEPS = 64;
// Shafts of light: how many points along a ray are tried for sunlight, and
// how many steps each gets to reach the sky.
const int SHAFT_SAMPLES = 16;
const int SHAFT_STEPS = 32;

// Per ray: for each level, how far along the ray it is known to stay solid.
float gSolid[NLEV];
// Lattice units of margin on "this level is solid for at least this far".
const float SLACK = 0.05;

// Distance to the nearest solid from camera-relative point v. Solid is what
// is left after every level has carved out its air, so this is the largest
// clearance any single level gives us. foot is the pixel footprint here and
// along is the distance from the camera; advance says this is a step of the
// ray itself, so what it learns can be remembered.
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
    if (d > MAX_IN * cell) break;      // already in bigger air than this level has
    float px = cell / foot;
    if (px < LOD_LO) break;            // too small to see: leave it solid
    float a = levelAir(i, v);
    if (advance && a > SLACK) gSolid[i] = along + (a - SLACK) / uSig[i];
    float w = -a / uSig[i];
    w -= clamp((foot / cell - 1.0 / LOD_HI) * LOD_K, 0.0, 1.0) * CLOSE * cell;
    // The surface takes its colour from the level whose air we are in. Where
    // two levels' air ends on the same plane (an opening that distance has
    // shrunk back flush with the wall it opens through), that is a coin toss
    // per pixel, so a finer level has to win clearly.
    if (w > d) {
      if (w > d + foot) slot = i;
      d = w;
    }
  }
  return d;
}

// Levels too small to carve still show: their openings are drawn onto the
// surface as texture, which the real geometry later grows into. Smaller
// still, the texture dissolves into the average tone it would have had.
vec3 detail(vec3 base, vec3 v, float foot, int slot) {
  for (int i = max(slot + 1, 0); i < NLEV; i++) {
    if (i >= uN) break;
    float px = float(R) / uSig[i] / foot;
    if (px < 0.5) break;
    float wgt = (1.0 - smoothstep(0.75, 1.0, smoothstep(LOD_LO, LOD_HI, px))) * smoothstep(0.5, 4.0, px);
    if (wgt <= 0.0) continue;
    float sharp = smoothstep(2.0, 8.0, px);
    float hole = OPEN_AREA;
    if (sharp > 0.0) {
      float a = levelAir(i, v) / uSig[i];
      hole = mix(hole, 1.0 - smoothstep(-foot, 0.5 * foot, a), sharp);
    }
    base = mix(base, mix(uWall[i] * 0.5, uWall[i], uInlay), hole * wgt * mix(0.8, 1.0, uInlay));
  }
  return base;
}

// Wherever a ray is, it is in some level's air, inside one convex piece of
// it, and stays in air at least until it leaves that piece. So: go straight
// to the furthest such way out, and look again. If no level has air there,
// that way out was a surface.
// The ray sets out from o (camera-relative) along dir, and goes at most maxT
// in at most most steps. Levels fade with distance as for a ray that set out
// t0 before o: the camera's own rays have t0 = 0. Returns how far it went;
// hit: it met a surface (or ran out of steps), of level slot, facing n;
// open: it went up into the sky. gSolid must be set beforehand.
float march(vec3 o, vec3 dir, float t0, float pix, float maxT, int most,
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
      if (best > REACH * cell) break;     // already going further than this level could take us
      float rel = (foot / cell - 1.0 / LOD_HI) * LOD_K;
      if (rel >= 1.0) break;              // too small to see: leave it solid
      gO = CLOSE * float(R) * max(rel, 0.0);
      gA = rel > 0.0 ? CLOSE * LOD_K * pix : 0.0;
      gRay = true;
      float reach;
      vec3 nn;
      float a = levelRay(i, v, reach, nn);
      if (reach >= 0.0) {
        // The shrinking changes pace where the level starts to fade and
        // where it is gone: go no further than that in one step.
        float turn = cell / ((rel > 0.0 ? LOD_LO : LOD_HI) * pix);
        float e = min(reach / uSig[i], max(turn - far, 0.0));
        if (e > best) {
          // The surface takes its colour from the level whose air we are
          // leaving; a finer level has to be clearly the one.
          if (e > best + foot) from = i;
          best = e;
          bn = nn;
        }
      } else if (uDebug != 2 && a > SLACK) gSolid[i] = t + (a - SLACK) / uSig[i];
    }
    if (best < 0.0) { hit = true; break; }
    slot = from;
    n = bn;
    // Step just past the way out, so as to be inside whatever comes next.
    t += best;
    t += 0.02 * pix * (t0 + t);
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
  float sun = max(dot(rd, uSun), 0.0);
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
    float shade = smoothstep(0.5, 0.9, fbm(q * 1.7 + vec2(0.4, 2.3) + 0.6 * uSun.xz));
    vec3 cloud = mix(vec3(1.0, 0.98, 0.95) * (0.5 + 0.5 * min(uDisc, 1.0)), mix(uSky, uZenith, 0.3) * 0.95, 0.55 * shade);
    col = mix(col, cloud, min(0.85 * uClouds, 0.95) * cover);
  }

  // Hills: two ranges, the further one higher and paler. Sampled round a
  // circle so that they join up behind us.
  vec2 ring = normalize(rd.xz + vec2(1e-6, 0.0));
  float lit = 0.5 + 0.5 * dot(ring, normalize(uSun.xz));
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

// The colour of a surface of level slot at p (camera-relative), facing n,
// seen along rd from t away, before any haze. shadows: cast a ray toward the
// sun to see whether it is in sunlight (else it is taken to be in shade).
vec3 shade(vec3 p, vec3 n, vec3 rd, float t, int slot, float pix, bool shadows) {
  float foot = max(t * pix, 1e-5 * uScale);
  int s2;

  // How open is it in front of this surface, at a spread of scales?
  float ao = 0.0;
  float h = max(2.0 * foot, 0.004 * uScale);
  float wt = 0.4;
  for (int i = 0; i < 4; i++) {
    ao += wt * clamp(map(p + n * h, foot, t + h, false, s2) / h, 0.0, 1.0);
    h *= 4.7;
    wt *= 0.7;
  }
  ao = clamp(ao / 0.96, 0.0, 1.0);

  // Ceilings are coloured as floors, except where floors are water.
  float flatness = smoothstep(0.5, 0.9, uMirror > 0.0 ? n.y : abs(n.y));
  vec3 base = slot == -2 ? uGround
            : slot < 0 ? mix(uOuterWall, uOuterFloor, flatness)
                       : mix(uWall[slot], uFloor[slot], flatness);
  base = detail(base, p, foot, slot);

  float hemi = 0.5 + 0.5 * n.y;
  float key = max(dot(n, uSun), 0.0);

  // Sunlight: does a ray from here toward the sun get out into the sky?
  // Not tried from too far below the ground for any to come in.
  float sunlit = 0.0;
  float below = -(p.y + uSkyH);
  if (shadows && uSunK > 0.0 && key > 0.0 && below < SUN_DEPTH * uFogLen) {
    for (int i = 0; i < NLEV; i++) gSolid[i] = 0.0;
    bool sh, so;
    int ss = slot, st = 0;
    vec3 sn = n;
    march(p + n * foot, uSun, t, pix, 1e30, SUN_STEPS, sh, so, ss, sn, st);
    sunlit = so ? 1.0 : 0.0;
  }
  float lamp = max(dot(n, -rd), 0.0) / (1.0 + pow(t / (uReach * uScale), 2.0));
  vec3 light = (0.15 + 0.85 * ao) * (uSky * uAmbient * mix(0.55, 1.05, hemi) + vec3(1.0, 0.93, 0.8) * key * uFill)
             + vec3(1.0, 0.9, 0.75) * lamp * uLamp
             + uSunCol * uSunK * key * sunlit
             + uGlow * (0.6 + 0.4 * ao);

  // Where sunlight adds to what was already bright, roll off gently
  // instead of clipping (nothing under 0.8 changes).
  vec3 lit = base * light;
  return mix(lit, 0.8 + 0.2 * (1.0 - exp(-(lit - 0.8) / 0.2)), step(0.8, lit));
}

// Shafts of light: how much of the haze in front of what we see (end away)
// is in sunlight, tried at points along the ray (from a different start in
// each pixel, so what falls between them shows as fine noise, not bands).
float shafts(vec3 rd, float end, float pix, int slot, vec3 n) {
  end = min(end, 2.0 * uFogLen);
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float sum = 0.0;
  for (int k = 0; k < SHAFT_SAMPLES; k++) {
    float s = end * (float(k) + j) / float(SHAFT_SAMPLES);
    vec3 q = rd * s;
    if (-(q.y + uSkyH) > SUN_DEPTH * uFogLen) continue;
    for (int i = 0; i < NLEV; i++) gSolid[i] = 0.0;
    bool sh, so;
    int ss = slot, st = 0;
    vec3 sn = n;
    march(q, uSun, s, pix, 1e30, SHAFT_STEPS, sh, so, ss, sn, st);
    if (so) sum += exp(-s / uFogLen);
  }
  float phase = 0.4 + 1.6 * pow(max(dot(rd, uSun), 0.0), 6.0);
  return phase * sum * end / (uFogLen * float(SHAFT_SAMPLES));
}

// The shafts of light drawn coarser (see Renderer.draw), here: from the four
// nearest of those, weighted by nearness and also by how near they ended to
// where this pixel's ray does, so that light in the haze behind an edge does
// not spill over onto what stands in front of it.
float shaftsHere(float end) {
  ivec2 size = textureSize(uShaftTex, 0);
  vec2 at = gl_FragCoord.xy * vec2(size) / uRes - 0.5;
  ivec2 c = ivec2(floor(at));
  vec2 f = at - vec2(c);
  float here = log2(max(end, 1e-30));
  float sum = 0.0, wsum = 1e-6;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec2 s = texelFetch(uShaftTex, clamp(c + o, ivec2(0), size - 1), 0).rg;
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    w *= 1.0 / (0.05 + abs(s.g - here));
    sum += w * s.r;
    wsum += w;
  }
  return sum / wsum;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * uStride * 2.0 - uRes) / uRes.y;
  vec3 rd = normalize(uCam * vec3(uv * uTan, -1.0));
  float pix = 2.0 * uTan / uRes.y;

  float t = 0.0, d = 0.0;
  int slot = 0, steps = 0;
  bool hit = false, open = false;
  vec3 n = -rd;
  // How far we see goes by the space we are in: out in the open, by how high
  // we are (uFogLen). But a ray that goes down into a cavity in the ground is
  // in that cavity from there on, and sees as far as it would from inside:
  // by the cavity's size (that of the coarsest level whose air it is).
  float down = 1e30, fogIn = uFogLen, maxT = uMaxT;
  if (uSkyH > 0.0 && rd.y < 0.0) {
    down = uSkyH / -rd.y;
    if (down < 4.0 * uFogLen) {
      vec3 c = rd * down - vec3(0.0, 0.01 * uScale, 0.0);
      for (int i = 0; i < NLEV; i++) {
        if (i >= uN) break;
        if (levelAir(i, c) < 0.0) { fogIn = max(uFogK / uSig[i], uFogLen); break; }
      }
      maxT = max(maxT, down + (4.0 - down / uFogLen) * fogIn);
    }
  }

  for (int i = 0; i < NLEV; i++) gSolid[i] = uDebug == 2 ? 0.0 : uNear[i];
#if EXACT
  t = march(vec3(0.0), rd, 0.0, pix, maxT, STEPS, hit, open, slot, n, steps);
#else
  for (int i = 0; i < STEPS; i++) {
    float foot = max(t * pix, 1e-12);
    d = map(rd * t, foot, t, uDebug != 2, slot);
    steps++;
    if (d < 0.5 * foot) { hit = true; break; }
    t += d * 0.9;
    if (t > maxT) break;
  }
  if (t <= maxT) hit = true;
#endif
  if (uDebug == 5) {
    outColor = vec4(hit ? t : -1.0, 0.0, 0.0, 1.0);
    return;
  }
  if (uDebug == 6) {
    float end = hit ? t : maxT;
    outColor = vec4(shafts(rd, end, pix, slot, n), log2(max(end, 1e-30)), 0.0, 1.0);
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
  if (hit) {
    vec3 p = rd * t;

#if !EXACT
    if (d > -1e19) {
      float foot = max(t * pix, 1e-5 * uScale);
      float e = 0.6 * foot;
      int s2;
      vec3 g = vec3(map(p + vec3(e, 0.0, 0.0), foot, t + e, false, s2),
                    map(p + vec3(0.0, e, 0.0), foot, t + e, false, s2),
                    map(p + vec3(0.0, 0.0, e), foot, t + e, false, s2)) - d;
      if (dot(g, g) > 0.0) n = normalize(g);
    }
#endif

    vec3 lit = shade(p, n, rd, t, slot, pix, true);

    // Mirror floors: what they reflect, more of it the more glancing the
    // look (and none of the sun's shadows, which would cost another ray).
    if (uMirror > 0.0 && n.y > 0.9) {
      vec3 rr = reflect(rd, n);
      for (int i = 0; i < NLEV; i++) gSolid[i] = 0.0;
      bool rh, ro;
      int rs = slot, rst = 0;
      vec3 rn = n;
      vec3 o = p + n * max(t * pix, 1e-5 * uScale);
      float rt = march(o, rr, t, pix, uMaxT, MIRROR_STEPS, rh, ro, rs, rn, rst);
      vec3 rc = beyond(rr, ro);
      if (rh) rc = mix(rc, shade(o + rr * rt, rn, rr, t + rt, rs, pix, false), exp(-rt / uFogLen));
      float glance = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
      lit = mix(lit, rc, uMirror * mix(0.35, 1.0, glance));
    }

    col = mix(col, lit, exp(-min(t, down) / uFogLen - max(t - down, 0.0) / fogIn));
  }

  // Shafts of light: drawn coarser beforehand, since they are soft anyway.
  if (uShafts > 0.0) col += uSunCol * uShafts * shaftsHere(hit ? t : maxT);

  // The thread: for each stretch of it, how close this pixel's ray passes.
  // It shows through walls, dimmed, so it can be followed out of sight.
  if (uThreadN > 1) {
    float depth = hit ? t : 1e30;
    float glow = 0.0;
    for (int i = 0; i < NT - 1; i++) {
      if (i >= uThreadN - 1) break;
      // Keep only the part of this stretch that is in front of us.
      vec3 a = uThread[i], c = uThread[i + 1];
      float sa = dot(a, rd), sc = dot(c, rd), front = 0.02 * uScale;
      if (sa < front && sc < front) continue;
      if (sa < front) a = mix(a, c, (front - sa) / (sc - sa));
      else if (sc < front) c = mix(c, a, (front - sc) / (sa - sc));
      vec3 ab = c - a;
      float b = dot(ab, rd);
      vec3 ap = a - rd * dot(a, rd), abp = ab - rd * b;
      float u = clamp(-dot(ap, abp) / max(dot(abp, abp), 1e-30), 0.0, 1.0);
      float s = dot(a, rd) + u * b;
      if (s <= 0.0) continue;
      float dist = length(ap + u * abp);
      float w = s * pix * (1.2 + 5.0 * uScale / (s + uScale));
      float g = 1.0 - smoothstep(0.5 * w, 1.5 * w, dist) + 0.35 * exp(-dist / (4.0 * w));
      g *= (s > depth ? 0.3 : 1.0) * exp(-s / (3.0 * uFogLen));
      glow = max(glow, g);
    }
    col += vec3(1.0, 0.82, 0.38) * glow;
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`
  );
}

// Edge anti-aliasing over the finished picture (FXAA): find each pixel that
// sits on an edge, walk along the edge both ways to see how long this stair
// step is, and blend across the edge by how far along the step the pixel is.
export const SMOOTH_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
out vec4 outColor;

const int SEARCH = 16;
const float SUBPIXEL = 0.4;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float lumaAt(vec2 uv) { return luma(texture(uTex, uv).rgb); }
float stride(int i) { return i < 5 ? 1.0 : i < 6 ? 1.5 : i < 10 ? 2.0 : i < 11 ? 4.0 : 8.0; }

void main() {
  vec2 px = 1.0 / uRes;
  vec2 uv = gl_FragCoord.xy * px;
  vec3 colour = texture(uTex, uv).rgb;
  float lC = luma(colour);
  float lD = luma(textureOffset(uTex, uv, ivec2(0, -1)).rgb);
  float lU = luma(textureOffset(uTex, uv, ivec2(0, 1)).rgb);
  float lL = luma(textureOffset(uTex, uv, ivec2(-1, 0)).rgb);
  float lR = luma(textureOffset(uTex, uv, ivec2(1, 0)).rgb);
  float lMin = min(lC, min(min(lD, lU), min(lL, lR)));
  float lMax = max(lC, max(max(lD, lU), max(lL, lR)));
  float range = lMax - lMin;
  outColor = vec4(colour, 1.0);
  if (range < max(0.0312, lMax * 0.125)) return;

  float lDL = luma(textureOffset(uTex, uv, ivec2(-1, -1)).rgb);
  float lUR = luma(textureOffset(uTex, uv, ivec2(1, 1)).rgb);
  float lUL = luma(textureOffset(uTex, uv, ivec2(-1, 1)).rgb);
  float lDR = luma(textureOffset(uTex, uv, ivec2(1, -1)).rgb);
  float lDU = lD + lU, lLR = lL + lR;
  float lLC = lDL + lUL, lDC = lDL + lDR, lRC = lDR + lUR, lUC = lUR + lUL;
  float eH = abs(-2.0 * lL + lLC) + abs(-2.0 * lC + lDU) * 2.0 + abs(-2.0 * lR + lRC);
  float eV = abs(-2.0 * lU + lUC) + abs(-2.0 * lC + lLR) * 2.0 + abs(-2.0 * lD + lDC);
  bool horz = eH >= eV;

  float l1 = horz ? lD : lL, l2 = horz ? lU : lR;
  float g1 = l1 - lC, g2 = l2 - lC;
  float gScaled = 0.25 * max(abs(g1), abs(g2));
  float across = horz ? px.y : px.x;
  float lAvg;
  if (abs(g1) >= abs(g2)) { across = -across; lAvg = 0.5 * (l1 + lC); }
  else lAvg = 0.5 * (l2 + lC);

  vec2 edge = uv;
  if (horz) edge.y += across * 0.5; else edge.x += across * 0.5;
  vec2 along = horz ? vec2(px.x, 0.0) : vec2(0.0, px.y);
  vec2 uv1 = edge - along, uv2 = edge + along;
  float e1 = lumaAt(uv1) - lAvg, e2 = lumaAt(uv2) - lAvg;
  bool r1 = abs(e1) >= gScaled, r2 = abs(e2) >= gScaled;
  if (!r1) uv1 -= along;
  if (!r2) uv2 += along;
  for (int i = 2; i < SEARCH; i++) {
    if (r1 && r2) break;
    if (!r1) { e1 = lumaAt(uv1) - lAvg; r1 = abs(e1) >= gScaled; }
    if (!r2) { e2 = lumaAt(uv2) - lAvg; r2 = abs(e2) >= gScaled; }
    if (!r1) uv1 -= along * stride(i);
    if (!r2) uv2 += along * stride(i);
  }

  float d1 = horz ? uv.x - uv1.x : uv.y - uv1.y;
  float d2 = horz ? uv2.x - uv.x : uv2.y - uv.y;
  float shift = 0.5 - min(d1, d2) / (d1 + d2);
  bool rightWay = ((d1 < d2 ? e1 : e2) < 0.0) != (lC < lAvg);
  if (!rightWay) shift = 0.0;

  float lAll = (2.0 * (lDU + lLR) + lLC + lRC) / 12.0;
  float s = clamp(abs(lAll - lC) / range, 0.0, 1.0);
  s = (3.0 - 2.0 * s) * s * s;
  shift = max(shift, s * s * SUBPIXEL);

  if (horz) uv.y += shift * across; else uv.x += shift * across;
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`;
