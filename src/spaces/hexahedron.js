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
// Under the lower's apex, elevation 1 shows a block 0.20 wide coming down
// out of the lower to 0.08 over the ground, on two legs; the photo, four thin
// shafts. In their place, a central column (see CORE).

// Rational points are kept in 24ths of a cell (thirds and quarters both
// occur, and the pillars' half sides need eighths), and each plane is reduced to whole numbers n . X < K, X in cells.
const T = 24;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tw = (p) => p.map((x) => Math.round(x * T));

// The plane n . X = K (X in cells) through three points given in 24ths,
// facing away from the point `inside` (in 24ths).
function through(a, b, c, inside) {
  let n = cross(sub(b, a), sub(c, a));
  let K = dot(n, a); // n . (T X) = K, so (T n) . X = K
  n = n.map((x) => x * T);
  if (dot(n, inside) / T >= K) (n = n.map((x) => -x)), (K = -K);
  const g = [...n, K].reduce(gcd);
  return { n: n.map((x) => x / g), K: K / g };
}
// The plane n . X = n . p + w |n| (rounded to a 24th): a face w out from
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

// The edges' candidates: rows of segments (see OPENINGS' segments in
// arcology.js), units over the band's bottom (18 high to the open storey's
// floor; the roof band's slab, the town's, another 12 over it); rows from
// its bottom start 2 under it (to open through it).
const S = (rows, block, cut, inset, deep, none = 0) => ({ kind: 'segments', rows, block, cut, inset, deep, none });
const EDGES = {
  // The cornice: the band's lower part set back in long runs, in two steps.
  cornice: [S([-2, 36, 10], 240, 24, 1, [3, 4]), S([-2, 36, 6], 240, 24, 1, [7, 8])],
  // Its steps three, each in runs of its own depth, now and then missing.
  steps: [S([-2, 36, 14], 240, 24, 1, [2, 3], 15), S([-2, 36, 10], 192, 24, 1, [4, 6], 15), S([-2, 36, 6], 144, 24, 1, [7, 10], 20)],
  // Courses: a deep setback below, thin reveals above it, as stacked slabs.
  strata: [S([-2, 36, 7], 240, 24, 1, [6, 9]), S([9, 36, 2], 240, 48, 1, [2, 3]), S([13, 36, 2], 192, 48, 1, [1, 2], 30)],
  // A plate girder: flanges proud, the web between them set back, crossed by
  // stiffeners one to three cells apart.
  girder: [S([4, 36, 10], 72, 24, 3, [3, 5])],
  // A shallow ledge carried on corbels, a cell or more apart, a deep setback
  // between them.
  corbels: [S([-2, 36, 12], 240, 24, 1, [2, 3]), S([-2, 36, 8], 120, 24, 3, [6, 8])],
  // The night's others: decks (the Tyrell building's bands), a loggia
  // (Soleri's promenades), hull panels, a trench; and mixed (a loggia on the
  // plate, decks on the roof band).
  decks: [S([2, 9, 5], 48, 4, 2, [3, 6], 10)],
  loggia: [S([4, 18, 10], 36, 6, 2, [8, 10])],
  panels: [S([1, 9, 7], 60, 4, 1, [1, 3], 25)],
  trench: [S([6, 18, 6], 36, 3, 1, [2, 6])],
  mixed: { plate: [S([4, 18, 10], 36, 6, 2, [8, 10])], roof: [S([2, 9, 5], 48, 4, 2, [3, 6], 10)] },
};
export const GROUND = 1; // the ground, over the lower's apex

// The building's definition: its numbers, as the measurement gave them and
// Basil chose among the candidates (a variant of the building changes some
// of them: see define in util.js).
export const HEXAHEDRON = {
  // Heights, in cells over the lower's apex.
  heights: { apexLo: 0, roofLo: 16.25, roofHi: 17, plateLo: 18.5, plateHi: 19.25, apexHi: 34.25 },
  // Plan: the upper's corners (the lower's turned 60 degrees: the same,
  // mirrored). (26/15 is within 0.04 degrees of root 3: the triangles are
  // equilateral to that.)
  up: [[-15, -26 / 3], [15, -26 / 3], [0, 52 / 3]],
  // The star's inner hexagon, where the two triangles' edges cross: the
  // pillars; and half a pillar's side.
  hex: [[10, 0], [5, 26 / 3], [-5, 26 / 3], [-10, 0], [-5, -26 / 3], [5, -26 / 3]],
  pillar: 1.75 / 2,
  // How the pillars meet the plate and the roof band (fringe.md; Basil chose
  // it from several, 2026-10-26): each pillar rises to the plate's top, its
  // plate-high part tapering upward by taper on each side, a buttress the
  // plate is joined to; the bands' undercuts stop bearing short of it, so
  // that they bear on it, and its channels run on through the roof band.
  bearing: 6 / 24,
  taper: 6 / 24,
  // What the plate's and the roof band's edges carry (fringe.md): one of
  // edges. Basil chose the cornice (2026-10-26): heavy, uninhabited
  // structure; its variations elaborate it structurally, with vertical
  // joints a cell or more apart (fine upright cuts shimmer); of them, the
  // steps. The rest are the night's other candidates.
  edge: 'steps',
  edges: EDGES,
  // The plaza on the roof band (Basil, 2026-10-28: the photo's roof top, a
  // section of cityscape, clusters of low structures with open floor
  // between; the drawing's PARK and PROMENADE, planting, left for now):
  // carved one level finer from a slab townH over the open storey's floor,
  // to the band's edge (see TOWN in arcology.js).
  townH: 0.5,
  // The central column (Basil, 2026-10-27/28: the structure needs it to look
  // as if it could stand; square, for variety with the pyramids' turn;
  // rusticated, unlike the pyramids and the pillars: a grid of raised blocks
  // between grooves, three to a face, and rings, the blocks framing pocks: a
  // shallow panel in nearly every block, deeper medium and small pocks within
  // and across it, each pock's edges jittered, so that overlapping ones join
  // in L, T and stepped shapes): a square prism on the axis, core each side
  // of it, from the ground (and a cell under it) through the open storey to
  // the plate's top. (core off the cells' sides: a face on one would leave
  // the cells inside it wholly inside the column, where the halls are, and
  // which cut no openings.) Units of a 24th of a cell (see OPENINGS in
  // arcology.js); the rings a pitch apart, one centred in the open storey
  // (their `from` worked out so, unless given); the panels' rows between
  // them.
  core: 2.875,
  coreFace: [
    { kind: 'flutes', pitch: 46, groove: 8, deep: 4 },
    { kind: 'rings', pitch: 36, up: 6, deep: 6 },
    { kind: 'segments', rows: [35, 36, 26], block: 92, cut: 23, inset: 4, deep: [2, 2], none: 10, jitter: 4 },
    { kind: 'segments', rows: [11, 12, 10], block: 60, cut: 12, inset: 2, deep: [3, 5], none: 50, jitter: 3 },
    { kind: 'segments', rows: [5, 12, 10], block: 48, cut: 12, inset: 2, deep: [4, 6], none: 60, jitter: 3 },
  ],
};

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
// band) may meet a mass's relief; so may the solids without relief (pillars,
// the column), which it keeps clear of (see bareIn and F.bare in
// arcology.js). Pillars, the column and the rims
// have openings on their upright faces (windows: a kind in OPENINGS in
// arcology.js, or a list of them; S6). A mass's sloped faces carry
// relief (see arcology.js), kept clear of its base: ylo, yhi bound the
// relief's height.
// (def: a whole definition, as HEXAHEDRON: makeArcology merges a variant's
// changes into it.)
export function hexahedron(def = HEXAHEDRON) {
  if (!Object.hasOwn(def.edges, def.edge)) throw new Error(`hexahedron: no edge ${def.edge} (there are ${Object.keys(def.edges).join(', ')})`);
  const { apexLo: APEX_LO, roofLo: ROOF_LO, roofHi: ROOF_HI, plateLo: PLATE_LO, plateHi: PLATE_HI, apexHi: APEX_HI } = def.heights;
  const UP = def.up, DOWN = UP.map(([x, z]) => [x, -z]), HEX = def.hex, PILLAR = def.pillar, BEARING = def.bearing, TAPER = def.taper;
  const TOWN_H = def.townH, CORE = def.core;
  // (y: the heights a pillar wears a band's at; a band's own are its own.)
  const edge = (which) => def.edges[def.edge][which] ?? def.edges[def.edge];
  const CORE_FACE = def.coreFace.map((f) => (f.kind === 'rings' && f.from === undefined ? { ...f, from: (((ROOF_HI + PLATE_LO) / 2 - GROUND) * T - f.up / 2) % f.pitch } : f));
  const solids = [];
  const upper = pyramid(UP, PLATE_HI, APEX_HI), lower = pyramid(DOWN, ROOF_LO, APEX_LO);
  solids.push({ name: 'upper', planes: [...upper.faces, upper.base], relief: [0, 1, 2], ylo: PLATE_HI, yhi: APEX_HI });
  // (The lower fills the central column's openings where it meets them; the
  // pillars' run on through it.)
  solids.push({ name: 'lower', planes: [...lower.faces, lower.base], relief: [0, 1, 2], ylo: GROUND, yhi: ROOF_LO, yields: ['pillar'] });
  solids.push({ name: 'plate', planes: prism(UP, PLATE_LO, PLATE_HI), rim: true, windows: edge('plate') });
  // (Its top raised TOWN_H over the open storey's floor, a slab the town is
  // carved from: see town in arcology.js.)
  solids.push({ name: 'roof', planes: prism(DOWN, ROOF_LO, ROOF_HI + TOWN_H), rim: true, yields: ['pillar'], windows: edge('roof'), town: { floor: ROOF_HI } });
  // Pillars: squares facing the centre, from the ground (and a cell under
  // it) to the plate's top, a buttress at the plate (see BEARING). Their
  // radial direction, as whole numbers.
  for (const [x, z] of HEX) {
    // (In whole numbers: (5, 26/3) runs along (15, 26).)
    const r = [x, z].map((v) => Math.round(v * T));
    if (r.some((v, i) => Math.abs(v - [x, z][i] * T) > 1e-9)) throw new Error(`hexahedron: a pillar off the 24ths, at ${x}, ${z}`);
    const g = gcd(r[0], r[1]), u = [r[0] / g, 0, r[1] / g];
    const t = [-u[2], 0, u[0]];
    const c = [x, 0, z];
    const sides = [u, u.map((v) => -v), t, t.map((v) => -v)];
    // (Its buttress's sides: each through its foot's edge at the plate's
    // underside and the line TAPER in from it at the plate's top.)
    const slope = (n) => {
      const h = n.map((v) => v / Math.hypot(...n)), m = [-h[2], 0, h[0]], at = (w, y, k) => tw([x + h[0] * w + m[0] * k, y, z + h[2] * w + m[2] * k]);
      return through(at(PILLAR, PLATE_LO, PILLAR), at(PILLAR, PLATE_LO, -PILLAR), at(PILLAR - TAPER, PLATE_HI, 0), tw([x, (PLATE_LO + PLATE_HI) / 2, z]));
    };
    // (keep: others' openings stop that far clear of it: see arcology.js.)
    solids.push({ name: 'pillar', planes: [...sides.map((n) => offset(n, c, PILLAR)), ...sides.map(slope), offset([0, -1, 0], [0, GROUND - 1, 0], 0), offset([0, 1, 0], [0, PLATE_HI, 0], 0)], windows: 'bays', keep: BEARING });
  }
  solids.push({ name: 'core', planes: box([-CORE, GROUND - 1, -CORE], [CORE, PLATE_HI, CORE]), windows: CORE_FACE });
  return solids;
}
