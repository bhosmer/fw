// The pieces worlds are built of, in JavaScript: the twin of the shader's
// (airPiece and the rest in shaders.js), so that a world written as pieces
// answers here what it answers there. For a point, a piece's distance (the
// most of the distances outside its planes); and for a ray from the point,
// where it leaves a piece of air it is in, or strikes a solid standing in
// it, and the surface there. And, as the shader does, shrunk back by a
// fade's state where one is given (see fade): the flight asks the world as
// it is, and the tests may give a state as the march would, to ask it as
// drawn. (The state is given, not worked out: the march's choice of it is
// the shader's alone.)
//
// A cell's air is a union of convex pieces less some convex solids standing
// in them. Each piece is written once, as the planes that bound it:
// airPiece() then airPlane() for each (or solidPiece(), solidPlane() and
// solidDone() for a solid). From those both twins have the piece's distance
// and, for a ray, where it leaves the piece or strikes the solid, so the two
// always agree; and the shader shrinks or grows everything with distance.
// Rules for a cell that keep the world exact at any depth:
//   - put every feature on integer lattice coordinates, its faces on planes
//     of whole-number normals (the axes, the diagonals in a coordinate
//     plane, or the space's slants)
//   - always form distances as float(L - anchor) + f, never float(L) + f - anchor
//   - form the distance to a 45-degree plane with diag(), never from the f of
//     two axes: close to the plane those cancel
//   - when choosing which of several features a point is nearest, go by L + f,
//     not L: a wrong choice overstates the clearance and rays step into solid
//   - pieces of one cell that join must overlap, not just touch
//
// The state the shader keeps in globals is kept in S, one object for all the
// worlds, set afresh for each point asked about.
//
// The sizes, in pixels, at which a level is carved fully and not at all, and
// how fast it fades between them (LOD_K: the fade's share per unit of
// 1 / pixels), as the shader's (see lean in shaders.js): for the spaces that
// fade at their own size.
export const LOD_LO = 8, LOD_HI = 24, LOD_K = 1 / (1 / LOD_LO - 1 / LOD_HI);

export const S = {
  ray: false, // is a ray being asked about? (gRay)
  dx: 0, dy: 0, dz: 0, // its direction (gDir)
  d: 0, // the piece's distance (gD)
  x: 0, nx: 0, ny: 0, nz: 0, // how far the ray can go, and the surface it meets there, facing the air (gX, gN)
  in: 0, out: 0, inx: 0, iny: 0, inz: 0, // a solid's: where the ray enters and leaves it, and its face (gIn, gOut, gInN)
  // How the level fades there (see fade): its air shrunk back by o, growing
  // by a for each unit the ray goes (gO, gA); the point's footprint as a
  // fraction of the level's cell, and its growth per unit (gScale,
  // gScaleRate).
  o: 0, a: 0, scale: 0, rate: 0,
  // The point along the diagonals (gLp, gFp, gLm, gFm: see Position.levels).
  Lp: [0, 0, 0], Fp: [0, 0, 0], Lm: [0, 0, 0], Fm: [0, 0, 0],
};

// The point L + f (lattice units) and its diagonals dg, as Position.levels
// gives them (without, they are worked out from L and f, which is only good
// far from any 45-degree surface); and for a ray, its direction (else none).
const PAIRS = [[0, 1], [2, 1], [0, 2]];
export function at(L, f, dg, dir) {
  if (dg) {
    for (let p = 0; p < 3; p++) (S.Lp[p] = dg.Lp[p]), (S.Fp[p] = dg.fp[p]), (S.Lm[p] = dg.Lm[p]), (S.Fm[p] = dg.fm[p]);
  } else {
    PAIRS.forEach(([a, b], p) => {
      S.Lp[p] = L[a] + L[b];
      S.Fp[p] = f[a] + f[b];
      S.Lm[p] = L[a] - L[b];
      S.Fm[p] = f[a] - f[b];
    });
  }
  S.ray = !!dir;
  if (dir) (S.dx = dir[0]), (S.dy = dir[1]), (S.dz = dir[2]);
}

// How the level fades where it is asked (as the shader's levelAir and march
// set it), { o, a, scale, rate } (see S); for a point alone, as levelAir
// has it, nothing grows. At rest S is unfaded (NO_FADE): whoever sets a
// state resets it after its ask (see airAt in air.js), and every part that
// sets its own for a while restores what it saved.
export const NO_FADE = Object.freeze({ o: 0, a: 0, scale: 0, rate: 0 });
export function fade({ o, a, scale, rate }, ray) {
  (S.o = o), (S.scale = scale), (S.a = ray ? a : 0), (S.rate = ray ? rate : 0);
}

// A face of a convex piece of air that the point is in: s is the point's
// distance outside it (so not positive), n points out of the piece.
function face(s, nx, ny, nz) {
  const r = nx * S.dx + ny * S.dy + nz * S.dz + S.a;
  if (r > 0) {
    const x = Math.max(-(s + S.o), 0) / r;
    if (x < S.x) (S.x = x), (S.nx = -nx), (S.ny = -ny), (S.nz = -nz);
  }
}

// A convex solid standing in that piece, which the point is outside: g is the
// point's distance outside each face, n points out of the solid. (Begun by
// solidBegin, ended by solidDone; or, as the arcology's openings ask, where
// the ray enters it and leaves it read from S: in and out.)
export function solidBegin() {
  (S.in = -1e30), (S.out = 1e30);
}
export function solidFace(g, nx, ny, nz) {
  const r = nx * S.dx + ny * S.dy + nz * S.dz - S.a, c = g - S.o;
  if (r < 0) {
    const x = c / -r;
    if (x > S.in) (S.in = x), (S.inx = nx), (S.iny = ny), (S.inz = nz);
  } else if (r > 0) S.out = Math.min(S.out, -c / r);
  else if (c > 0) S.out = -1;
}

export function airPiece() {
  S.d = -1e30;
  S.x = 1e30;
}
export function airPlane(s, nx, ny, nz) {
  S.d = Math.max(S.d, s);
  if (S.ray) face(s, nx, ny, nz);
}
export function solidPiece() {
  S.d = -1e30;
  if (S.ray) solidBegin();
}
export function solidPlane(s, nx, ny, nz) {
  S.d = Math.max(S.d, s);
  if (S.ray) solidFace(s, nx, ny, nz);
}
export function solidDone() {
  if (S.ray) {
    S.in = Math.max(S.in, 0);
    if (S.in < S.out && S.in < S.x) (S.x = S.in), (S.nx = S.inx), (S.ny = S.iny), (S.nz = S.inz);
  }
  return S.d;
}

// Two planes across axis a (0, 1, 2), inside when x0 <= x + f <= x1.
const E = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export function airSpan(x, f, x0, x1, a) {
  const [ex, ey, ez] = E[a];
  airPlane(x0 - x - f, -ex, -ey, -ez);
  airPlane(x - x1 + f, ex, ey, ez);
}
export function solidSpan(x, f, x0, x1, a) {
  const [ex, ey, ez] = E[a];
  solidPlane(x0 - x - f, -ex, -ey, -ez);
  solidPlane(x - x1 + f, ex, ey, ez);
}

// For the pair of axes p = (a, b): sa * (a - ca) + sb * (b - cb) - k, where
// sa and sb are 1 or -1. A 45-degree plane's distance is this over root two.
export const diag = (p, sa, sb, ca, cb, k) =>
  sa === sb ? sa * (S.Lp[p] - ca - cb) - k + sa * S.Fp[p] : sa * (S.Lm[p] - ca + cb) - k + sa * S.Fm[p];

// For a ray (an object { dir } to be told how far it goes: see cellAir in
// worlds.js), of a piece the point is in (d, its distance, as first
// asked; ask: the same piece again): asked again with the ray, it stays in
// air to the end of whichever piece it is in for longest.
export function through(ray, d, ask) {
  if (!ray || d + S.o > 0) return;
  S.ray = true;
  ask();
  S.ray = false;
  if (S.x > ray.reach) (ray.reach = S.x), (ray.nx = S.nx), (ray.ny = S.ny), (ray.nz = S.nz);
}

// Set the ray's direction, and say it is known (yet in no air).
export function aim(ray) {
  S.ray = false;
  (S.dx = ray.dir[0]), (S.dy = ray.dir[1]), (S.dz = ray.dir[2]);
  (ray.known = true), (ray.reach = -1), (ray.nx = ray.ny = ray.nz = 0);
}

// What every world's cells share: a hash's top bits as a number in [0, 1);
// is x + f on the upper side of c (L alone is rounded, and can put a point
// half a unit on the wrong side); and the distance for nothing at all.
export const h01 = (h) => (h >>> 8) / 16777216;
// A share's threshold, as both languages compare such a number (a whole
// number of 2^-24ths) with it: rounded up to a whole number of those, which
// single precision holds exactly. (Else the shader's literal, rounded down,
// could pick otherwise than the JavaScript for one number in 2^24.)
export const threshold = (x) => Math.ceil(x * 2 ** 24) / 2 ** 24;
export const beyond = (x, f, c) => x > c || (x === c && f >= 0);
export const NONE = 1e9;
