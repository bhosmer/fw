// The Hexahedron, after Soleri's drawing (his elevations, drawing.jpg): a
// description only, as convex solids bounded by planes, for the arcology to
// build (see arcology.js). Nothing here is the engine's, and nothing in the
// engine knows about this building.
//
// Every number comes from the measurement page (.claude/measure/, the joint
// fit of the drawing's two elevations, with the silhouettes taken by their
// envelope: fit_drawing.json "hull"), in units of the masses' base edge E,
// here 30 cells of the city's lattice (level CITY + 1 cells):
//   upper height 0.497 (faces 60 deg), plate 0.024, open storey 0.054,
//   roof band 0.024, lower depth 0.543, lower apex 0.03 under the ground,
//   pillars at radius 0.333 (the star's inner hexagon, on the bisectors),
//   their section a square of 0.058 facing the centre (elevation 1's widths);
//   the turn between the masses 60 deg (fit 63 +- 2.4).
// Rounded to quarter cells (0.008 E), within the fit's errors.
//
// The towers under the lower are a placeholder: elevation 1 shows a block
// 0.20 wide coming down out of the lower to 0.08 over the ground, on two
// legs 0.065 wide at +-0.067 from the axis; the photo, four thin shafts. Their
// plan is not resolved; four legs at the block's corners give two in either
// elevation.

// Rational points are kept in twelfths of a cell (thirds and quarters both
// occur), and each plane is reduced to whole numbers n . X < K, X in cells.
const T = 12;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tw = (p) => p.map((x) => Math.round(x * T));

// The plane n . X = K (X in cells) through three points given in twelfths,
// facing away from the point `inside` (in twelfths).
function through(a, b, c, inside) {
  let n = cross(sub(b, a), sub(c, a));
  let K = dot(n, a); // n . (T X) = K, so (T n) . X = K
  n = n.map((x) => x * T);
  if (dot(n, inside) / T >= K) (n = n.map((x) => -x)), (K = -K);
  const g = [...n, K].reduce(gcd);
  return { n: n.map((x) => x / g), K: K / g };
}
// The plane n . X = n . p + w |n| (rounded to a twelfth): a face w out from
// p, facing along n.
function offset(n, p, w) {
  const len = Math.hypot(...n);
  const K = Math.round(dot(n, p) * T + w * len * T);
  const N = n.map((x) => x * T), g = [...N, K].reduce(gcd);
  return { n: N.map((x) => x / g), K: K / g };
}
const box = (lo, hi) => [0, 1, 2].flatMap((a) => {
  const e = [0, 0, 0];
  e[a] = 1;
  return [offset(e.map((x) => -x), lo, 0), offset(e, hi, 0)];
});

// Heights, in cells over the lower's apex.
const APEX_LO = 0, ROOF_LO = 16.25, ROOF_HI = 17, PLATE_LO = 18.5, PLATE_HI = 19.25, APEX_HI = 34.25;
export const GROUND = 1; // the ground, over the lower's apex
// Plan: the upper's corners, and the lower's (turned 60 degrees). (26/15 is
// within 0.04 degrees of root 3: the triangles are equilateral to that.)
const UP = [[-15, -26 / 3], [15, -26 / 3], [0, 52 / 3]];
const DOWN = UP.map(([x, z]) => [x, -z]);
// The star's inner hexagon, where the two triangles' edges cross: the pillars.
const HEX = [[10, 0], [5, 26 / 3], [-5, 26 / 3], [-10, 0], [-5, -26 / 3], [5, -26 / 3]];
const PILLAR = 1.75 / 2; // half the pillar's side
const TOWER = 3, LEG = 1, LEG_AT = 2, TOWER_LO = GROUND + 2.5; // the towers (placeholder)

function prism(corners, y0, y1) {
  const mid = tw([0, (y0 + y1) / 2, 0]);
  const planes = corners.map(([x, z], i) => {
    const [x2, z2] = corners[(i + 1) % 3];
    return through(tw([x, y0, z]), tw([x2, y0, z2]), tw([x, y1, z]), mid);
  });
  return [...planes, offset([0, -1, 0], [0, y0, 0], 0), offset([0, 1, 0], [0, y1, 0], 0)];
}
function pyramid(corners, yb, apex) {
  const tip = tw([0, apex, 0]), mid = tw([0, (yb + apex) / 2, 0]);
  const faces = corners.map(([x, z], i) => {
    const [x2, z2] = corners[(i + 1) % 3];
    return through(tw([x, yb, z]), tw([x2, yb, z2]), tip, mid);
  });
  const base = apex > yb ? offset([0, -1, 0], [0, yb, 0], 0) : offset([0, 1, 0], [0, yb, 0], 0);
  return { faces, base };
}

// The solids: each a list of planes, inside where n . X < K for all of them
// (X in cells from the axis at the lower's apex). A rim (the plate, the roof
// band) may meet a mass's relief; nothing else may. A mass's sloped faces carry
// relief (see arcology.js), kept clear of its base: ylo, yhi bound the
// relief's height.
export function hexahedron() {
  const solids = [];
  const upper = pyramid(UP, PLATE_HI, APEX_HI), lower = pyramid(DOWN, ROOF_LO, APEX_LO);
  solids.push({ name: 'upper', planes: [...upper.faces, upper.base], relief: [0, 1, 2], ylo: PLATE_HI, yhi: APEX_HI });
  solids.push({ name: 'lower', planes: [...lower.faces, lower.base], relief: [0, 1, 2], ylo: GROUND, yhi: ROOF_LO });
  solids.push({ name: 'plate', planes: prism(UP, PLATE_LO, PLATE_HI), rim: true });
  solids.push({ name: 'roof', planes: prism(DOWN, ROOF_LO, ROOF_HI), rim: true });
  // Pillars: squares facing the centre, from the ground (and a cell under
  // it) to the plate. Their radial direction, as whole numbers.
  for (const [x, z] of HEX) {
    // ((5, 26/3) runs along (15, 26).)
    const u = z === 0 ? [Math.sign(x), 0, 0] : [15 * Math.sign(x), 0, 26 * Math.sign(z)];
    const t = [-u[2], 0, u[0]];
    const c = [x, 0, z];
    const sides = [u, u.map((v) => -v), t, t.map((v) => -v)].map((n) => offset(n, c, PILLAR));
    solids.push({ name: 'pillar', planes: [...sides, offset([0, -1, 0], [0, GROUND - 1, 0], 0), offset([0, 1, 0], [0, PLATE_LO, 0], 0)] });
  }
  solids.push({ name: 'tower', planes: box([-TOWER, TOWER_LO, -TOWER], [TOWER, ROOF_LO, TOWER]) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    solids.push({ name: 'leg', planes: box([sx * LEG_AT - LEG, GROUND - 1, sz * LEG_AT - LEG], [sx * LEG_AT + LEG, TOWER_LO, sz * LEG_AT + LEG]) });
  return solids;
}
