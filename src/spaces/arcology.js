// "Arcology": the halls, built up into a great building above the ground.
//
// Every level is halls (see halls.js) but one, the city's: there, one row of
// cells, running on in every direction to the horizon, is a plaza open to
// the sky, and in the middle of it stands a building. It is solid at the
// city's level, so the halls one level finer are its rooms (each of which is
// a great hall of the halls one level finer still). Under the plaza are more
// halls, whose light wells open up through its floor. Above the city's row
// there is only sky, and the levels coarser than the city's are solid
// throughout (as air, they would swallow parts of it).
//
// A building is a list of convex solids, each bounded by planes of any
// orientation (see hexahedron.js, the one building so far). A plane is
// n . X < K with n and K whole numbers, X in the city's lattice units (level
// CITY + 1 cells): through rational points, and kept exact at any depth by
// carrying each normal across levels (the space's slants: see
// Position.levels), as the halls' 45-degree planes are.
//
// One level finer, the cells near a mass's sloped faces are its skin: no
// rooms in them, but pockets cut into the face (see pocket), boxes of many
// sizes and depths in the face's own frame, so that a face reads as built
// up of masses small and large, as in the photograph of Soleri's model.
// Deeper in, the cells are halls; cells the other solids cross are solid.

import * as P from '../pieces.js';
import * as twin from '../twin.js';
import { makeHalls, HALLS, R, M, STANDING, ancestorDigit as hallsDigit } from './halls.js';
import { hash32, hashCell, hsv, levelSeed, wrapId as wrapIdR, glf, hexu, define, frozen } from '../util.js';
import { hexahedron, HEXAHEDRON, GROUND } from './hexahedron.js';
import { townShapeJs, townShapeGlsl, townShapes, TOWN_TYPES } from './town.js';

const wrapId = (id) => wrapIdR(id, R);
const C = R / 2;
export const CITY = -2; // the city's level
const ROW = 12; // which row of its parent the city's cells are in
const G = M; // the plaza's floor, up from the bottom of a city cell
export const ROWS = 2; // how many rows of cells high the city is, from its floor to the sky
// Ids are a cell's index in its parent plus R times its parent's in the
// grandparent: the city's row, and the cell in the middle of it, as ids.
export const ROW_ID = ROW + R * C;
const MID = C + R * C;
const ABOVE = 200; // how many rows over the city's are known to be over it

// The relief cut into the masses' faces (see LEVELS in makeArcology): its
// two levels, the city's own and the next finer.
const RELIEF = {
  city: { sb: 4, sby: 2, quant: 1, splits: 3, min: 1, depths: [0, 0.25, 0.5], weights: [0.25, 0.4, 0.35] },
  finer: { sb: 24, sby: 24, quant: 2, splits: 3, min: 3, depths: [0, 2, 4, 6, 8], weights: [0.3, 0.25, 0.2, 0.15, 0.1] },
};
// The town on the roof band (see TOWN in makeArcology). A cell's lots,
// [x0, z0, x1, z1] in units, by plan (after real towns' blocks: a grid of
// small lots; a 2 by 2 of larger; strips, along x or z, as of row houses on
// a street; one whole block; a strip beside a grid), picked by the cell's
// hash from pick; the share of lots built on, by cluster (two cells
// square), from density; how far inside its lot a building keeps (margin);
// how far inside the band's edge, in units, every building keeps (setback.by:
// cut back to that line, so that a strip of the band's floor sets the
// buildings apart from the band: Basil's 5, 2026-10-30; 0, they stand to the
// edge, cut by the band's faces, as they did: ledger F15), and how much of a box must stand past that line for it
// to stand at all (setback.least: a square that many units a side, at its
// corner furthest in; a box with less is dropped, so that what is left of the
// box is never thinner than that there; with by 0 it does nothing); and the
// kinds of building (see town.js).
const TOWN_DEF = {
  plans: [
    [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => [8 * i, 8 * j, 8 * i + 8, 8 * j + 8])),
    [0, 1].flatMap((j) => [0, 1].map((i) => [12 * i, 12 * j, 12 * i + 12, 12 * j + 12])),
    [0, 1, 2].map((j) => [0, 8 * j, 24, 8 * j + 8]),
    [0, 1, 2].map((i) => [8 * i, 0, 8 * i + 8, 24]),
    [[0, 0, 24, 24]],
    [[0, 0, 8, 24], ...[0, 1, 2].flatMap((j) => [1, 2].map((i) => [8 * i, 8 * j, 8 * i + 8, 8 * j + 8]))],
  ],
  pick: [0, 0, 1, 1, 2, 3, 4, 5],
  density: [15, 45, 80],
  margin: 1,
  setback: { by: 5, least: 2 },
  types: TOWN_TYPES,
};
// Whether the plaza's air fades with distance as the rest of its level does
// (fades), or, being open at every distance, never does (see openAir in
// halls.js, and plaza): the rest of the level (the building's masses, the
// light wells, the city's pockets, the halls under the plaza) fades either
// way. (Basil chose the open plaza, 2026-10-30: ledger B33; plaza.fades=true
// is the plaza as it was, fading.)
const PLAZA = { fades: false };
// The arcology's definition: its building (see hexahedron.js), the halls it
// is built of (see HALLS in halls.js), its relief, its town and its plaza.
export const ARCOLOGY = frozen({ building: HEXAHEDRON, halls: HALLS, relief: RELIEF, town: TOWN_DEF, plaza: PLAZA });
// How far (a fraction of a cell) air is shrunk to fade a level out with
// distance (see close, and gScale in shaders.js).
const CLOSE = 0.3;

// The most ridge rows a face's rectangle can span, one level finer: as many
// as both copies look under (see underRidge), check's bound on the relief.
const RIDGE_SPAN = 6;

// The most ridge rows one level finer that a rectangle of that level (lv: its
// sby, quant, splits and min) can span. A ridge's rows are each city cell
// split as ridgeRow splits it: a part of n quanta, 2 min or more, is cut at
// any whole quantum leaving min each side, each part again, splits deep;
// each cell its own. A rectangle is sby high, from a city cell's edge plus
// a whole number of sby: so from any multiple of gcd(sby, R) along a cell.
function spans(lv) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a), memo = new Map();
  // (The most parts of [lo, hi), cut d deep, that meet [a, b).)
  const meet = (lo, hi, d, a, b) => {
    if (hi <= a || lo >= b) return 0;
    const n = (hi - lo) / lv.quant, key = `${lo},${hi},${d},${a},${b}`;
    if (d === 0 || n < 2 * lv.min) return 1;
    if (!memo.has(key)) {
      let most = 0;
      for (let s = lv.min; s <= n - lv.min; s++) most = Math.max(most, meet(lo, lo + s * lv.quant, d - 1, a, b) + meet(lo + s * lv.quant, hi, d - 1, a, b));
      memo.set(key, most);
    }
    return memo.get(key);
  };
  let most = 0;
  for (let o = 0; o < R; o += gcd(lv.sby, R)) {
    let rows = 0;
    for (let c = 0; c * R < o + lv.sby; c++) rows += meet(0, R, lv.splits, Math.max(o, c * R) - c * R, Math.min(o + lv.sby, (c + 1) * R) - c * R);
    most = Math.max(most, rows);
  }
  return most;
}

// What the rest of the arcology needs of a definition's relief and town,
// beyond its kinds (define checks those): a variant that breaks one is
// refused here, saying which, rather than built wrong (or into a shader
// the GPU will not take).
function check(def) {
  const bad = (what) => {
    throw new Error(`arcology: ${what}`);
  };
  const whole = (x) => Number.isInteger(x) && x > 0;
  for (const [name, lv] of Object.entries(def.relief)) {
    if (!['sb', 'sby', 'quant', 'splits', 'min'].every((k) => whole(lv[k]))) bad(`relief.${name}: sb, sby, quant, splits and min must be whole numbers over 0`);
    if (!lv.depths.length || lv.weights.length !== lv.depths.length) bad(`relief.${name}: as many weights as depths, at least one`);
    if (lv.weights.some((w) => !(w >= 0)) || Math.abs(lv.weights.reduce((a, b) => a + b) - 1) > 1e-9) bad(`relief.${name}: weights of 0 or more, adding up to 1`);
  }
  // (The city's rows are halved, and the finer level's heights are halved
  // into twelfths of a cell (h12): whole numbers in both copies only if
  // even; rectangles and rows are cut at whole quanta (so finer heights are
  // even); its depths are in whole twelfths, as the city's in quarters, of a
  // cell; and both copies look under at most RIDGE_SPAN ridge rows under a
  // rectangle (the city's: two at most): see spans.)
  const { city, finer } = def.relief;
  if (city.sby % 2 || finer.quant % 2) bad('relief: city.sby and finer.quant must be even');
  for (const [name, lv] of Object.entries(def.relief)) if (lv.sb % lv.quant || lv.sby % lv.quant) bad(`relief.${name}: sb and sby in whole quanta (multiples of quant, ${lv.quant})`);
  const rows = spans(finer);
  if (rows > RIDGE_SPAN) bad(`relief.finer: a rectangle could span ${rows} ridge rows, more than the ${RIDGE_SPAN} looked under (fewer splits, a larger min, or another sby would do)`);
  if (!city.depths.every((d) => Number.isInteger(d * 4) && d >= 0)) bad('relief.city: depths in quarters of a cell');
  if (!finer.depths.every((d) => Number.isInteger((12 * d) / R) && d >= 0)) bad(`relief.finer: depths in twelfths of a cell (multiples of ${R / 12})`);
  // (The halls by level: only where there are halls, at the city's level
  // (under the plaza, by the building) and finer.)
  for (const l of Object.keys(def.halls.byLevel)) if (+l < CITY) bad(`halls.byLevel.${l}: there are no halls coarser than the city's level (${CITY})`);
  const t = def.town;
  // (A building stands a unit inside its lot (see PREAMBLE in town.js): the
  // margin may be no more.)
  if (!(t.margin > 0 && t.margin <= 1)) bad('town.margin must be over 0 and at most 1 (buildings stand a unit inside their lots)');
  if (![t.setback.by, t.setback.least].every((x) => Number.isInteger(x) && x >= 0 && x <= R)) bad(`town.setback: { by, least }, whole units from 0 to ${R}`);
  if (!t.types.length) bad('town.types: none');
  if (!t.density.length || !t.density.every((d) => Number.isInteger(d) && d >= 0 && d <= 100)) bad('town.density: whole percentages, at least one');
  if (!t.pick.length || !t.pick.every((i) => Number.isInteger(i) && i >= 0 && i < t.plans.length)) bad(`town.pick: plans by their index (0 to ${t.plans.length - 1}), at least one`);
  t.plans.forEach((plan, i) => {
    if (!plan.length || plan.length > 16) bad(`town.plans[${i}]: one lot to sixteen (lots' hashes are told apart by 4 bits)`);
    if (!plan.every((r) => r.length === 4 && r.every((x) => Number.isInteger(x) && x >= 0 && x <= R) && r[0] < r[2] && r[1] < r[3])) bad(`town.plans[${i}]: lots [x0, z0, x1, z1], whole units within the cell`);
    // (Lots tile the cell, each point in the first lot whose far sides it is
    // short of: as both copies find a point's lot.)
    for (let x = 0; x <= R; x += 0.5) for (let z = 0; z <= R; z += 0.5) {
      const r = plan.find((r) => (x < r[2] || r[2] === R) && (z < r[3] || r[3] === R));
      if (!r || x < r[0] || z < r[1] || x > r[2] || z > r[3]) bad(`town.plans[${i}]: lots must tile the cell, in order (at ${x}, ${z})`);
      if (x < R && z < R && plan.filter((q) => x + 0.25 > q[0] && x + 0.25 < q[2] && z + 0.25 > q[1] && z + 0.25 < q[3]).length !== 1) bad(`town.plans[${i}]: lots overlap or leave a gap (at ${x}, ${z})`);
    }
  });
  return def;
}

// The arcology, made from ARCOLOGY with what set changes (see define in
// util.js): all that follows is worked out from that, so that a variant of
// it is another call of this. Gives the space, its definition, and for the
// checks its table and its parts (_V2).
export function makeArcology(set) {
  // (What every world's cells share: see pieces.js.)
  const { beyond, h01 } = P;
  const def = check(frozen(define(ARCOLOGY, set)));
  // (Whether the plaza's air is open at every distance: see PLAZA.)
  const UNFADED = !def.plaza.fades;
  const { spec: HALLS, glsl: hallsGlsl, air: hallsAir, room: hallsRoom, openings: hallsOpenings, built, slabHole, slabHalf } = makeHalls(def.halls);
  // The building, its solids' planes moved to the city's lattice: from the
  // middle city cell's corner, its axis at the middle of that cell, the
  // lower's apex a cell under the plaza's floor (see GROUND).
  const SOLIDS = hexahedron(def.building);
  const ORIGIN = [C, G - 1, C];

  // Each plane's direction: an axis (0, 1, 2) where its normal is one, or else
  // a slant (3 on): the normal itself, in whole numbers, so that the plane
  // lies on a whole value of what is carried (a divisor of it, the primitive
  // direction, could leave the plane between two whole values, where the small
  // parts cancel). Scale: 1 or -1.
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const SLANTS = [];
  function slantOf(n) {
    const sign = Math.sign(n.find((x) => x !== 0));
    const m = n.map((x) => x * sign);
    let k = SLANTS.findIndex((t) => t.every((x, a) => x === m[a]));
    if (k < 0) k = SLANTS.push(m) - 1;
    return { k, sign };
  }
  const PLANES = []; // { dir, scale, m, n, K, len }
  SOLIDS.forEach((s) => {
    s.first = PLANES.length;
    for (const { n, K } of s.planes) {
      const nz = n.filter((x) => x !== 0);
      let dir, scale, m;
      if (nz.length === 1 && Math.abs(nz[0]) === 1) (dir = n.findIndex((x) => x !== 0)), (scale = nz[0]), (m = n.map(Math.abs));
      else {
        const { k, sign } = slantOf(n);
        (dir = k + 3), (scale = sign), (m = SLANTS[k]);
      }
      // (In the lattice: n . X < K, X from the middle city cell's corner.)
      PLANES.push({ dir, scale, m, n, K: K + n[0] * ORIGIN[0] + n[1] * ORIGIN[1] + n[2] * ORIGIN[2], len: Math.hypot(...n) });
    }
    s.last = PLANES.length;
  });

  // Of the corners of the level-(CITY + 1) cell whose corner is c (lattice
  // units from the middle cell's corner), the one furthest along n (e 1),
  // or furthest back (e -1): n . q over the cell's corners q is at its most
  // (its least) there. The solids' normals are whole numbers, as the corners
  // are, so n . q is exact there and at every corner: what rises or falls
  // with n . q (a plane's side, a face's depth) is at its most or its least
  // there, exactly as trying all eight would find it.
  const toward = (n, c, e) => [c[0] + (e * n[0] > 0 ? 1 : 0), c[1] + (e * n[1] > 0 ? 1 : 0), c[2] + (e * n[2] > 0 ? 1 : 0)];
  for (const s of SOLIDS) for (const { n } of s.planes) if (!n.every(Number.isInteger)) throw new Error(`arcology: a plane of ${s.name} whose normal (${n}) is not in whole numbers: the cells' tests take a plane's side at one of a cell's corners for its least or most over all eight, exact only for whole numbers (see toward)`);
  // Whether such a cell is wholly inside a solid (all its corners are), and
  // whether it is wholly outside it (all outside one of its planes), or
  // outside one by at least w (cellOutBy).
  const side = (p, q) => p.n[0] * q[0] + p.n[1] * q[1] + p.n[2] * q[2] - p.K;
  const planesOf = (s) => PLANES.slice(s.first, s.last);
  const cellIn = (s, c) => {
    for (let i = s.first; i < s.last; i++) if (!(side(PLANES[i], toward(PLANES[i].n, c, 1)) <= 0)) return false;
    return true;
  };
  const cellOutBy = (s, c, w) => {
    for (let i = s.first; i < s.last; i++) if (side(PLANES[i], toward(PLANES[i].n, c, -1)) >= w * PLANES[i].len) return true;
    return false;
  };
  const cellOut = (s, c) => cellOutBy(s, c, 0);

  // (The point where three planes n . X = b meet.)
  const solve3 = (M, b) => {
    const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const D = det(M);
    return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((x, j) => (j === c ? b[i] : x)))) / D);
  };
  // Each solid's bounds in the lattice (the cells it may touch: those no
  // one of its planes leaves wholly outside: see cellOut). A cell c is such
  // just when n . c < K + (the sum of n's parts below 0) for each plane,
  // the solid with its planes moved out by a cell's reach: so they lie
  // within that one's corners (where three of its planes meet, inside the
  // rest), looked through once. (Its planes are in the lattice's measure:
  // see PLANES.)
  for (const s of SOLIDS) {
    const ps = planesOf(s).map((p) => ({ n: p.n, K: p.K + p.n.reduce((t, x) => t + Math.max(0, -x), 0) })), at = [];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        for (let k = j + 1; k < ps.length; k++) {
          const X = solve3([ps[i].n, ps[j].n, ps[k].n], [ps[i].K, ps[j].K, ps[k].K]);
          if (X.every(Number.isFinite) && ps.every((p) => dot(p.n, X) <= p.K + 1e-6 * Math.hypot(...p.n))) at.push(X);
        }
    if (!at.length) throw new Error(`arcology: ${s.name} has no corners: its planes bound nothing`);
    const wlo = [0, 1, 2].map((a) => Math.floor(Math.min(...at.map((X) => X[a]))));
    const whi = [0, 1, 2].map((a) => Math.ceil(Math.max(...at.map((X) => X[a]))) + 1);
    s.lo = [Infinity, Infinity, Infinity];
    s.hi = [-Infinity, -Infinity, -Infinity];
    for (let x = wlo[0]; x < whi[0]; x++)
      for (let y = wlo[1]; y < whi[1]; y++)
        for (let z = wlo[2]; z < whi[2]; z++) {
          const c = [x, y, z];
          if (cellOut(s, c)) continue;
          for (let a = 0; a < 3; a++) (s.lo[a] = Math.min(s.lo[a], c[a])), (s.hi[a] = Math.max(s.hi[a], c[a] + 1));
        }
  }
  const TOP = Math.max(...SOLIDS.map((s) => s.hi[1]));
  // (Under the sky: the city's rows over the plaza hold it.)
  if (!(TOP < ROWS * R)) throw new Error(`arcology: the building's top (${TOP - ORIGIN[1]} cells over its lower's apex) is over the sky (${ROWS * R - ORIGIN[1]})`);

  // The city cells, across from the middle one, that the building stands in:
  // no light well opens in those (it would come up into it).
  const BUILT = new Set();
  for (const { lo, hi } of SOLIDS)
    for (let a = Math.floor(lo[0] / R); a <= Math.floor((hi[0] - 1) / R); a++)
      for (let b = Math.floor(lo[2] / R); b <= Math.floor((hi[2] - 1) / R); b++) BUILT.add(`${a},${b}`);
  const BUILT_CELLS = [...BUILT].map((k) => k.split(',').map(Number));
  // The city's own pieces in JavaScript (see cityPieces), and those made into
  // functions here: where the middle city cell is, and where the halls may
  // have rooms (the rest below, once what they read is made).
  const CITY_JS = cityPieces(true);
  const { fromMiddle, offBuilt, spaceRoom } = new Function(
    'R', 'NBUILT', 'BUILT_CELLS',
    `'use strict';\n${twin.AS_GLSL}\nconst max = Math.max, min = Math.min;\n${CITY_JS.middle}\n${CITY_JS.offBuilt}\n${CITY_JS.room}\nreturn { fromMiddle, offBuilt, spaceRoom };\n//# sourceURL=cityRooms.gen.js`,
  )(R, BUILT_CELLS.length, BUILT_CELLS);
  // A level-(CITY + 1) cell's place in its city cell (own: from the cell's
  // id): its two forms, side by side, the same arithmetic.
  const ownGlsl = (id) => `${id} - R * ivec3(floor((vec3(${id}) + 0.5) / float(R)))`;
  const ownOf = (id) => id.map((x) => x - R * Math.floor((x + 0.5) / R));

  // Where the plaza does not fade (see PLAZA), the solids standing in it are
  // grown as their level fades, by up to a whole fade (CLOSE R: see plaza):
  // how far out along any axis a solid then reaches, for each unit its planes
  // are moved out, at most (GROW), from their corners. (Each extent is
  // concave in the growth, so the most is for the least: asked at a small
  // one.) And how far that is at a whole fade (GROWN), by which the solids'
  // bounds are taken out where the plaza's pieces are listed (NEAR).
  const reach = (s, g) => {
    const ps = planesOf(s).map((p) => ({ n: p.n, K: p.K + g * Math.hypot(...p.n) })), at = [];
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        for (let k = j + 1; k < ps.length; k++) {
          const X = solve3([ps[i].n, ps[j].n, ps[k].n], [ps[i].K, ps[j].K, ps[k].K]);
          if (X.every(Number.isFinite) && ps.every((p) => dot(p.n, X) <= p.K + 1e-6 * Math.hypot(...p.n))) at.push(X);
        }
    return [0, 1, 2].flatMap((a) => [Math.min(...at.map((X) => X[a])), Math.max(...at.map((X) => X[a]))]);
  };
  const GROW = UNFADED ? Math.max(...SOLIDS.flatMap((s) => {
    const r0 = reach(s, 0), g = 1e-3;
    return reach(s, g).map((x, i) => (i % 2 ? x - r0[i] : r0[i] - x) / g);
  })) : 0;
  const GROWN = GROW * CLOSE * R;

  // For each city cell (across from the middle one) with any solid near it,
  // the solids that reach into the air it answers for (its plaza piece, see
  // plaza): only those are asked about.
  const NEAR = new Map();
  SOLIDS.forEach(({ lo, hi }, k) => {
    // (Grown, where the plaza does not fade: see GROWN.)
    const [x0, y0, z0] = lo.map((x) => x - GROWN), [x1, y1, z1] = hi.map((x) => x + GROWN);
    for (let a = Math.floor((x0 - 2 * R) / R); a <= Math.floor((x1 + R) / R); a++)
      for (let b = UNFADED ? 0 : Math.floor((y0 - R - M) / R); b <= (UNFADED ? ROWS - 1 : Math.floor((y1 + M) / R)); b++)
        for (let c = Math.floor((z0 - 2 * R) / R); c <= Math.floor((z1 + R) / R); c++) {
          if (b < 0 || b >= ROWS) continue;
          // (Where the plaza does not fade, each piece is the whole height of
          // the city's rows: see plaza.)
          const lo = [a * R - R, UNFADED ? G : b * R + (b === 0 ? G : -M), c * R - R], hi = [a * R + 2 * R, UNFADED ? ROWS * R + M : b * R + R + M, c * R + 2 * R];
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
  // Where the plaza does not fade (see PLAZA): the city cells (x and z,
  // across from the middle one) that hold anything but the plaza's air, its
  // solids (NEAR) and the cells with halls under them and wells up through
  // the floor (offBuilt 0 or 1), lie in NEAR_X0 to NEAR_X1 and NEAR_Z0 to
  // NEAR_Z1 (the higher not included). A cell further out than one past them
  // holds the plaza's air alone, and answers it as one piece: see plaza.
  const [NEAR_X0, NEAR_Z0] = [0, 2].map((a) => Math.min(...NEAR_CELLS.map((c) => c[a]), ...BUILT_CELLS.map((c) => c[a / 2] - 1)));
  const [NEAR_X1, NEAR_Z1] = [0, 2].map((a) => Math.max(...NEAR_CELLS.map((c) => c[a] + 1), ...BUILT_CELLS.map((c) => c[a / 2] + 2)));

  // Pockets: a face is cut, along it and up it, into rectangles: super-blocks
  // sb long in rows sby high (rows by true height), each row shifted along by
  // its own whole number of quanta (so that no line runs on up the face), each
  // split `splits` times at whole quanta (along it, quanta of its own measure).
  // Each rectangle is cut into the face to its own depth (depths, as often as
  // weights), level and square to the face. The same rule at two levels: the city's own (lengths in its lattice units,
  // cells), whose boxes make the masses and the ragged silhouettes; and the
  // next (in its units), smaller boxes cut into those. What keeps anything
  // from being cut loose is in the setup after BARE.
  // (Each level's depths' cumulative shares, as thresholds: see pieces.js.)
  const LEVELS = [def.relief.city, def.relief.finer].map((lv) => ({ ...lv, cumulative: lv.weights.map((_, i) => P.threshold(lv.weights.slice(0, i + 1).reduce((x, y) => x + y))) }));
  const ND = Math.max(...LEVELS.map((lv) => lv.depths.length));
  const POCKET_SALT = 0x27d4eb2d, ROW_SALT = 0x165667b1, DEPTH_SALT = 0xd3a2646c;

  // The faces that carry pockets: a mass's sloped faces. Each in its own
  // frame: across it, h (the plane's normal laid flat, in whole numbers, out
  // of the mass), along it, t (flat, along its edge), and up. Its plane is
  // n . X < K (X in the city's lattice units from the building's origin; one
  // level finer, R times both), with n = alpha h + (0, ny, 0); its pockets keep
  // within heights lo to hi (4 y, so that the rims' quarter cells are whole).
  // One rule, whatever way it faces.
  const FOUR = slantOf([0, 4, 0]);
  const FACES = [];
  SOLIDS.forEach((s) => {
    for (const i of s.relief ?? []) {
      const { n, K } = s.planes[i];
      // (h and t are scaled by sub, so that a face's measure is fine enough
      // for a quarter cell's depth whichever way it faces: w = h . X is sub
      // times the distance in the plain direction's units.)
      const alpha = gcd(n[0], n[2]), h0 = [n[0] / alpha, 0, n[2] / alpha], sub = Math.max(1, Math.ceil(4 / Math.hypot(...h0)));
      const h = h0.map((x) => x * sub), t = [-h[2], 0, h[0]];
      const len = Math.hypot(...h);
      FACES.push({ n, K, alpha, sub, ny: n[1], plane: slantOf(n), h: slantOf(h), t: slantOf(t), hv: h, tv: t, len, len2: dot2(h),
                   q: LEVELS.map((lv) => Math.round(lv.quant * len)),
                   lo4: Math.round(s.ylo * 4), hi4: Math.round(s.yhi * 4), solid: s });
    }
    // (The cell table compares heights with ylo and yhi themselves: see reached and deaf.)
    if (s.relief && !(Number.isInteger(s.ylo * 4) && Number.isInteger(s.yhi * 4))) throw new Error('arcology: relief heights off the quarters');
  });
  function dot2(v) {
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  }
  // (A cell's table entry has a bit for each, six in all.)
  if (FACES.length > 6) throw new Error(`arcology: ${FACES.length} faces with relief, at most 6`);
  // How far behind a face anything is cut (cells): DMAX, along its normal (see below).
  const REACH = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R + 0.05;
  // Each solid's planes, n . X < K (X in cells from the building's origin):
  // exactly, one level finer, n and R K in whole numbers (SOLID_PI: see
  // planeAt); and n as a unit normal (SOLID_NRM).
  const SOLID_PI = SOLIDS.map((s) => s.planes.map(({ n, K }) => [...n, R * K]));
  const SOLID_NRM = SOLIDS.map((s) => s.planes.map(({ n }) => n.map((x) => x / Math.hypot(...n))));
  // The solids that are neither masses nor their rims (pillars, the column): the
  // city's cuts stop at them (see bareIn), and the notches one level finer
  // keep clear of the cells they touch (see F.bare).
  // (No upright face, nor top, of a solid without relief on a cell's side:
  // the cells inside it would be wholly inside the solid, where the halls are,
  // and those next to open air would show them through its face.)
  SOLIDS.filter((s) => !s.relief && !s.rim).forEach((s) => s.planes.forEach(({ n, K }) => {
    const axis = n.filter((x) => x).length === 1, a = n.findIndex((x) => x);
    if (axis && (a !== 1 || n[1] > 0) && Number.isInteger(K / n[a])) throw new Error(`arcology: a face of ${s.name} on a cell's side (${'xyz'[a]} = ${K / n[a]})`);
  }));
  const BARE = SOLIDS.filter((s) => !s.relief && !s.rim);
  // (And their bounds, cells from the building's origin: a first, cheap test.)
  const BARE_BOX = BARE.map((s) => [s.lo.map((x, a) => x - ORIGIN[a]), s.hi.map((x, a) => x - ORIGIN[a])]);
  // (Beyond this from all of them (cells: more than the diagonal of a city
  // pocket's box, 5.7), a ray through the city's pockets cannot strike one:
  // see cell() in the shader.)
  const BARE_NEAR = 6;
  if (BARE_NEAR < Math.hypot(LEVELS[0].sb, LEVELS[0].sby, 1 + REACH)) throw new Error('arcology: BARE_NEAR under a city pocket');
  // How deep anything is cut at most (cells): both levels' deepest.
  const DMAX = LEVELS[0].depths.at(-1) + LEVELS[1].depths.at(-1) / R;
  // How far in from a face, and out past it, anything of the city's is cut (cells).
  const BAND_IN = LEVELS[0].depths.at(-1) + 0.01, BAND_OUT = 1.01;
  const TILE_SALT = 0x6c8e9cf5;
  // How much nearer its own face than any other a cut of a face keeps (cells).
  const MARGIN = 0.1;
  for (const F of FACES) {
    F.nn = dot2(F.n);
    F.nl = Math.sqrt(F.nn);
    F.q2 = [F.q[0], (F.q[0] * LEVELS[1].quant) / LEVELS[0].quant];
  }
  FACES.forEach((F, k) => (F.index = k));
  // Relief (.claude/design/relief-v4.md, relief-v5.md): pockets are cut level
  // into a face, in rows by true height, so their floors and ceilings are
  // level and their side walls upright; their back walls follow the face.
  // Each face is tiled at each level, all the way to its ridges and apex, and
  // so is each ridge, by height. Everything is decided slice by slice: a cut t
  // deep keeps W(t) (about 2t) from each ridge, so that it is in its face's
  // half of the slice, nearer its own plane than any other face's by MARGIN;
  // or it comes nearer a ridge, and is then no deeper than the ridge's own
  // row there, whose pair of notches (one into each face) it joins. Then
  // every cut of a slice meets its edge in one connected stretch, so what is
  // left of the slice is in one piece and holds its middle, and the middles
  // of all the slices are a straight line (the axis): nothing is cut loose.
  for (const F of FACES) {
    const mass = FACES.filter((G) => G.solid === F.solid);
    F.near = mass.filter((G) => G !== F);
    // (Rows by true height: a point's height on the face is its own.)
    F.mv = [0, 1, 0];
    F.gm = 1;
    F.ms = slantOf(F.mv);
    F.mlen = 1;
    F.p = 1;
    F.yk = 0;
    // In, level and square to the face, DELTA cells deeper.
    const hh = F.n[0] * F.n[0] + F.n[2] * F.n[2], v = [(-F.n[0] * F.nl) / hh, 0, (-F.n[2] * F.nl) / hh];
    // The point on the face at (u, y) (city measure, cells), and DELTA cells in.
    const M = [F.n, F.tv, [0, 1, 0]];
    F.at = (u, y, delta) => solve3(M, [F.K, u, y]).map((x, a) => x + delta * v[a]);
    // Its ridges with the mass's other faces, each as where it crosses height
    // y in F's measure, u = (al y + be) / dl, in whole numbers (at a level S
    // times finer: (al y + S be) / dl), and how far from it a cut t deep keeps
    // (W(t), below).
    F.edges = F.near.map((G) => {
      const n = F.n, g = G.n, t = F.tv;
      const dl = n[0] * g[2] - n[2] * g[0];
      const al = t[0] * (n[2] * g[1] - n[1] * g[2]) + t[2] * (g[0] * n[1] - n[0] * g[1]);
      const be = t[0] * (F.K * g[2] - n[2] * G.K) + t[2] * (n[0] * G.K - g[0] * F.K);
      // (Going in, G comes nearer by fall per unit; along the face, it is
      // per u nearer per unit of F's measure.)
      const dG = (X) => (G.K - dot(G.n, X)) / G.nl, fall = dot(G.n, v) / G.nl;
      const per = Math.abs(dG(F.at(1, 20, 0)) - dG(F.at(0, 20, 0)));
      // (W(t) at each level, in its u-units, t twelfths: going t in at a
      // pocket's near edge leaves it MARGIN nearer F than G.)
      const Wt = [1, R].map((S) => Array.from({ length: 17 }, (_, t) => Math.ceil((((t / 12) * (1 + fall) + MARGIN) * S) / per) + 1));
      // (The plane of a notch's edge, W in from the ridge and along it: its
      // gradient in u-units per lattice unit, gl, and its unit normal into
      // the face, gn (both with sg, below).)
      const gv = [t[0], -al / dl, t[2]];
      return { G, dl, al, be, Wt, W: Wt[0][16], sg: 0, gl: Math.hypot(...gv), gv };
    });
    // (Which way from each ridge the face lies.)
    const ym = (F.solid.ylo + F.solid.yhi) / 2, uAt = (E) => (E.al * ym + E.be) / E.dl;
    F.edges[0].sg = Math.sign(uAt(F.edges[1]) - uAt(F.edges[0]));
    F.edges[1].sg = -F.edges[0].sg;
    for (const E of F.edges) E.gn = E.gv.map((x) => (E.sg * x) / E.gl);
    // The inradius of the mass's level slice at height y (cells): how deep its
    // middle is behind each face (relief-v4.md: never cut).
    const [G, H] = F.near, un = (X) => X.n.map((x) => x / X.nl);
    const inr = (y) => {
      const X = solve3([un(F).map((x, a) => x - un(G)[a]), un(F).map((x, a) => x - un(H)[a]), [0, 1, 0]], [F.K / F.nl - G.K / G.nl, F.K / F.nl - H.K / H.nl, y]);
      return (F.K - dot(F.n, X)) / F.nl;
    };
    F.inr = (y) => Math.max(0, inr(y));
    // (The zone tests' whole numbers, one level finer, stay well within 32
    // bits wherever they are asked: within two cells of the mass's box, and a
    // super-block further along.)
    const lo = F.solid.lo.map((x, a) => x - ORIGIN[a] - 2), hi = F.solid.hi.map((x, a) => x - ORIGIN[a] + 2);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, 1, 2].map((a) => ((i >> a) & 1 ? hi[a] : lo[a])));
    const um = Math.max(...corners.map((X) => Math.abs(dot(F.tv, X)))) + (LEVELS[0].sb / LEVELS[0].quant) * F.q2[0];
    const yb = Math.max(...corners.map((X) => Math.abs(X[1])));
    for (const E of F.edges)
      if (R * (Math.abs(E.al) * yb + Math.abs(E.be) + (E.W + um) * Math.abs(E.dl)) >= 2 ** 30) throw new Error(`arcology: the faces of ${F.solid.name} are too fine for the relief's whole numbers (zone tests): another slope (see slopes in hexahedron.js)`);
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  // The ridges: each pair of faces of a mass.
  const RIDGES = [];
  FACES.forEach((F, i) => FACES.forEach((G, j) => {
    if (i < j && F.solid === G.solid) RIDGES.push({ a: i, b: j, F, G });
  }));
  for (const r of RIDGES) {
    // The ridge's line: where the two planes meet, at heights y (cells).
    r.at = (y) => solve3([r.F.n, r.G.n, [0, 1, 0]], [r.F.K, r.G.K, y]);
  }
  // Depths are a quarter cell's whole number (the city's) and a twelfth's
  // (one level finer's): a face's depth plane x twelfths deep is worked out
  // in whole numbers of its measure (n . X), rounded in, so never deeper (see
  // depthN). (Its whole numbers stay under 2^31 for the deepest cut the
  // tables hold, 16 twelfths, one level finer: q = (16 R)^2 n . n, and its
  // correction asks 144 (dn + 1)^2, about q + 24 root q + 144.)
  if (FACES.some((F) => { const q = (16 * R) ** 2 * F.nn; return q + 24 * Math.sqrt(q) + 144 >= 2 ** 31; })) throw new Error(`arcology: a face too fine for the relief's whole numbers (depths): another slope (see slopes in hexahedron.js)`);
  const quarters = (x) => Math.round(x * 4), twelfths = (x) => Math.round(x * 12);
  // The notches one level finer keep clear of the cells that the solids
  // without relief (pillars, the column) touch (they are cut in skin cells only,
  // which such solids never touch): for each face, the rectangles of it (u in
  // its city measure, y in cells, rounded out) over which a notch could meet
  // one (see r.barep). (The city's cuts stop at such solids instead: see
  // bareIn.)
  for (const F of FACES) {
    F.bare = [];
    // (Only the part of each cell that a notch could reach: from a cell out
    // to DMAX in, at the heights cuts are made; sampled every quarter cell,
    // and rounded out by more than that.)
    const Q = 0.25;
    for (const sol of BARE) {
      // (Row by row of height, so that a solid crossing the face at a slant
      // blanks its own footprint and not the rectangle round it.)
      const rows = new Map();
      for (let cx = sol.lo[0]; cx < sol.hi[0]; cx++)
        for (let cy = Math.max(sol.lo[1], Math.floor(F.solid.ylo + ORIGIN[1]) - 1); cy < Math.min(sol.hi[1], Math.ceil(F.solid.yhi + ORIGIN[1]) + 1); cy++)
          for (let cz = sol.lo[2]; cz < sol.hi[2]; cz++) {
            const c = [cx, cy, cz];
            if (cellOut(sol, c)) continue;
            const m = (F.K - dot(F.n, c.map((x, a) => x + 0.5 - ORIGIN[a]))) / F.nl;
            if (m < -2 || m > DMAX + 2) continue;
            for (let x = 0; x <= 1 + 1e-9; x += Q) for (let y = 0; y <= 1 + 1e-9; y += Q) for (let z = 0; z <= 1 + 1e-9; z += Q) {
            const X = [c[0] + x - ORIGIN[0], c[1] + y - ORIGIN[1], c[2] + z - ORIGIN[2]], depth = (F.K - dot(F.n, X)) / F.nl;
            if (depth < -1 - Q || depth > DMAX + Q) continue;
            const u = dot(F.tv, X), yp = (F.gm * dot(F.mv, X) + F.yk * F.K) / F.p;
            for (let r = Math.floor(yp - Q); r <= Math.floor(yp + Q); r++) {
              const o = rows.get(r) ?? [Infinity, -Infinity];
              rows.set(r, [Math.min(o[0], u), Math.max(o[1], u)]);
            }
            }
          }
      for (const [r, [u0, u1]] of [...rows].sort((p, q) => p[0] - q[0])) {
        if (r + 1 <= F.solid.ylo || r >= F.solid.yhi) continue;
        const lo = Math.floor(u0 - Q * F.len), hi = Math.ceil(u1 + Q * F.len), last = F.bare.at(-1);
        if (last && last[3] === r && last[0] === lo && last[1] === hi) last[3] = r + 1;
        else F.bare.push([lo, hi, r, r + 1]);
      }
    }
  }
  const zone = (E, u, y, S) => E.sg * Math.sign(E.dl) * (u * E.dl - E.al * y - S * E.be); // (distance past the ridge, times |dl|)
  const rectBare = (F, u0, u1, y0, y1) => F.bare.some(([a, b, c, d]) => u0 < b && u1 > a && y0 < d && y1 > c);
  const fdiv = (a, b) => Math.floor(a / b);
  const cdiv = (a, b) => Math.ceil(a / b);
  // The ridges are tiled too, by height only (relief-v5.md, v6): rows of the
  // city's (its rows of two cells, some halved) and, one level finer, rows
  // within each cell (split as the faces' rectangles are, at whole quanta and
  // never under the least). Each row draws a depth as a face's rectangle does,
  // the same for both faces (it is the ridge's), one level finer on top of the
  // city's row it is in; and is shallower, or not cut, until a pair of
  // notches that deep fits: one into each face, from past the ridge to W(t)
  // in from it (an edge that follows the ridge), leaving W(t) to each face's
  // other ridge, no deeper than the slice allows (CAP), and, one level finer,
  // clear of the solids without relief (BAREP). A face's rectangle near a
  // ridge is cut no deeper than the ridge's rows beside it (see rectDepth).
  const RIDGE_SALT = 0x2b7e1516;
  // (Segments' hash: see OPENINGS.)
  const SEGMENT_SALT = 0x3c6ef372;
  // (How deep a ridge's rows may be drawn at each level, as an index into its
  // depths; and in how many quarters of the city's rows they are halved.)
  const RIDGE_JMAX = [1, 2], RIDGE_HALVES = 4;
  RIDGES.forEach((r, i) => (r.index = i));
  for (const F of FACES) F.er = F.edges.map((E) => RIDGES.find((r) => (r.F === F && r.G === E.G) || (r.G === F && r.F === E.G)).index);
  // (A depth drawn as the rectangles' are, by a hash: its index in P.depths.)
  const drawJ = (lv, h) => {
    const t = h01(h), P = LEVELS[lv];
    let j = 0;
    for (let i = 0; i < ND - 1; i++) if (t >= (P.cumulative[i] ?? 2)) j = i + 1;
    return j;
  };
  // The deepest cut (twelfths, 0 to 16) the slice of a face's mass allows at
  // each height, by twelfths of a cell from F.c0 (its middle is never cut: at
  // most half its inradius, and MARGIN short of it): F.cap; and, for a
  // ridge's notch at each level, also as much as leaves the face W(t) from
  // both its ridges: F.ncap[lv]. Each condition is concave or affine in the
  // height, so a row's are its two ends'.
  for (const F of FACES) {
    // (Over the heights of its mass, with a row each side where nothing is cut.)
    F.c0 = Math.floor(12 * F.solid.ylo) - 1;
    const n = Math.ceil(12 * F.solid.yhi) + 2 - F.c0;
    const room = (y) => (y < F.solid.ylo - 1e-9 || y > F.solid.yhi + 1e-9 ? 0 : Math.min(F.inr(y) / 2, F.inr(y) - MARGIN));
    const width = (y, S) => Math.abs((F.edges[0].al * y * S + S * F.edges[0].be) / F.edges[0].dl - (F.edges[1].al * y * S + S * F.edges[1].be) / F.edges[1].dl);
    const most = (ok) => { let t = 16; while (t > 0 && !ok(t)) t--; return t; };
    F.cap = Array.from({ length: n }, (_, i) => most((t) => t / 12 <= room((i + F.c0) / 12) + 1e-12));
    F.ncap = [1, R].map((S, lv) => Array.from({ length: n }, (_, i) => most((t) => t <= F.cap[i] && width((i + F.c0) / 12, S) >= F.edges[0].Wt[lv][t] + F.edges[1].Wt[lv][t])));
  }
  const capIndex = (F, i) => Math.min(Math.max(i - F.c0, 0), F.cap.length - 1);
  // (Whether F's notch at its e-th ridge, from the ridge to W(16) in, over
  // cells Y0 to Y1, could meet a solid without relief: the whole box, also
  // where it runs on past the ridge, to where F's out-plane or its floor
  // meets G's.)
  function notchBare(F, e, Y0, Y1) {
    const E = F.edges[e], G = E.G, t = 16;
    const at = [Y0, Y1].map((y) => (E.al * y + E.be) / E.dl + E.sg * E.Wt[0][t]);
    const past = [Y0, Y1].flatMap((y) => [Math.ceil(F.nl), (-t / 12) * F.nl].map((a) => dot(F.tv, solve3([F.n, G.n, [0, 1, 0]], [F.K + a, G.K + Math.ceil(G.nl), y]))));
    const all = [...at, ...past];
    return rectBare(F, Math.floor(Math.min(...all)), Math.ceil(Math.max(...all)), Math.floor(Y0), Math.ceil(Y1));
  }
  // For each ridge, how many of the twelfths of a cell below each height (from
  // its faces' c0) its finer notches could meet a solid without relief in.
  for (const r of RIDGES) {
    r.barep = [0];
    for (let i = 0; i < r.F.cap.length; i++) {
      const y = (i + r.F.c0) / 12, bare = [r.F, r.G].some((X) => notchBare(X, X.er.indexOf(r.index), y, y + 1 / 12));
      r.barep.push(r.barep[i] + (bare ? 1 : 0));
    }
  }
  const bareAt = (r, i) => r.barep[Math.min(Math.max(i - r.F.c0, 0), r.barep.length - 1)];
  const bareRows = (r, i0, i1) => bareAt(r, i1) - bareAt(r, i0);
  // Whether a pair t deep fits at ridge r over heights i0 to i1 (twelfths of a cell), at level lv.
  const pairFits = (r, lv, i0, i1, t) => [r.F, r.G].every((X) => t <= Math.min(X.ncap[lv][capIndex(X, i0)], X.ncap[lv][capIndex(X, i1)])) && (lv === 0 || bareRows(r, i0, i1) === 0);
  // The row of ridge r at level lv that height y (whole level units, at least
  // the point's) is in: { y0, y1 } in level units, t its depth (twelfths, the
  // city's row's included one level finer) and tc the city's row's.
  function ridgeRow(r, lv, y) {
    if (lv === 0) {
      const sby = LEVELS[0].sby, sr = fdiv(y, sby), half = hashCell([sr, r.index, 0], RIDGE_SALT >>> 0) % 4 < RIDGE_HALVES;
      const a = half && y >= sr * sby + sby / 2 ? sr * sby + sby / 2 : sr * sby, b = half ? a + sby / 2 : a + sby;
      let t = 0;
      for (let j = Math.min(RIDGE_JMAX[0], drawJ(0, hashCell([a, r.index, 1], RIDGE_SALT >>> 0))); j > 0; j--) {
        const tt = 3 * quarters(LEVELS[0].depths[j]);
        if (pairFits(r, 0, 12 * a, 12 * b, tt)) { t = tt; break; }
      }
      return { y0: a, y1: b, t, tc: t, cy0: a, cy1: b };
    }
    const P = LEVELS[1], cy = fdiv(y, R), cw = ridgeRow(r, 0, cy), tc = cw.t;
    let y0 = cy * R, y1 = y0 + R, h = hashCell([cy, r.index, 2], RIDGE_SALT >>> 0);
    for (let i = 0; i < P.splits; i++) {
      const ny = (y1 - y0) / P.quant, m = P.min;
      if (ny >= 2 * m) {
        const c = y0 + P.quant * (m + ((h >>> 8) % (ny - 2 * m + 1)));
        if (y >= c) y0 = c;
        else y1 = c;
      }
      h = hashCell([y0, y1, r.index], (RIDGE_SALT ^ 1) >>> 0);
    }
    let t = tc;
    for (let j = Math.min(RIDGE_JMAX[1], drawJ(1, hashCell([y0, r.index, 3], RIDGE_SALT >>> 0))); j > 0; j--) {
      const tt = tc + twelfths(P.depths[j] / R);
      if (pairFits(r, 1, y0 / 2, y1 / 2, tt)) { t = tt; break; }
    }
    return { y0, y1, t, tc, cy0: R * cw.y0, cy1: R * cw.y1 };
  }
  // The ridges' rows as a table, for both copies to look up rather than
  // work out (each takes several hashes and caps; review21): for each ridge
  // and level, from RR_FROM[lv] (level units) for RR_N[lv] heights,
  // ridgeRow's y0, y1, t and tc, as a texture's rows (2 r + lv). Wide enough
  // for every height the cell table can ask after, its cells' and a cell or
  // two more each way (a height outside is held to the table's last row: so
  // the table must cover them all, as checked once the table is made; at
  // least -4 to 43, as it has been).
  const cellsLo = Math.min(...SOLIDS.map((s) => s.lo[1])) - ORIGIN[1], cellsHi = Math.max(...SOLIDS.map((s) => s.hi[1])) - ORIGIN[1];
  const RR0 = Math.min(-4, cellsLo - 4), RR1 = Math.max(44, cellsHi + 7);
  const RR_FROM = [RR0, RR0 * R], RR_N = [RR1 - RR0, (RR1 - RR0) * R];
  const RIDGE_ROWS = (() => {
    const w = Math.max(...RR_N), data = new Int32Array(4 * w * 2 * RIDGES.length);
    for (const r of RIDGES)
      for (let lv = 0; lv < 2; lv++)
        for (let i = 0; i < RR_N[lv]; i++) {
          const { y0, y1, t, tc } = ridgeRow(r, lv, RR_FROM[lv] + i);
          data.set([y0, y1, t, tc], 4 * ((2 * r.index + lv) * w + i));
        }
    return { size: [w, 2 * RIDGES.length], data };
  })();
  // (The shader takes a depth plane of 0 for no cut; the tables of W(t)
  // and the caps hold t up to 16; a pair's two floors, each rounded in to its
  // face's measure, differ by less than MARGIN: see relief-v4.md.)
  if (3 * quarters(LEVELS[0].depths.at(-1)) + twelfths(LEVELS[1].depths.at(-1) / R) > 16) throw new Error('arcology: cuts deeper than the tables');
  if (!(MARGIN > Math.max(...FACES.map((F) => 1 / F.nl)))) throw new Error('arcology: a face too coarse for the relief\'s measure (MARGIN): another slope (see slopes in hexahedron.js)');
  // (A notch's edge's normal is its value's gradient: checked numerically.)
  for (const F of FACES)
    for (const E of F.edges) {
      const at = (X) => zone(E, dot(F.tv, X), X[1], 1) / (Math.abs(E.dl) * E.gl), X = [1.3, 20.7, -2.1], h = 1e-3;
      const g = [0, 1, 2].map((a) => (at(X.map((x, b) => x + (a === b ? h : 0))) - at(X)) / h);
      if (g.some((x, a) => Math.abs(x - E.gn[a]) > 1e-6)) throw new Error('arcology: a notch edge normal is not its gradient');
    }
  // Openings (S6): the upright faces of the solids that have them carry
  // grids of openings one level finer, in the face's own frame: each opening
  // `along` wide in a pitch `pitch` (the finer units), `up` high in a pitch
  // `upPitch`, `deep` into the face; and over each opening's width, all the
  // way up, a channel `channel` deep (0: none). By kind, from the solid, the
  // face (its plane P) and the solid's bottom and top (a solid's windows is a
  // kind, or a list of { kind, ... }, each kind's spec). Each opening is in the
  // middle of its pitch both ways,
  // the grid from the building's axis and the ground; unless `centre` (a point
  // the grid is centred on along the face), `from` (the height its rows start
  // at, finer units over the ground) or `fade` (the size of its openings'
  // features, for fading them sooner than their level: see scale); or it may
  // `vary`, as segments (below).
  // (Openings that open through a solid's face run 2 units past it, so that
  // no other solid's openings meeting them there leave a sheet.)
  // The central column: upright grooves (flutes) and level slots (rings), a
  // grid of raised blocks, framing pocks (segments, their edges jittered).
  // The pillars (pillars.md, after the drawing): smooth shafts at their
  // corners, and on each face between them a channel (the middle half of the
  // face) of shelves, their fronts at its floor, a third of a cell apart: one
  // opening per face along, each the gap between two shelves, deeper.
  // The plate and the roof band (fringe.md): a cornice, stepped back below in
  // runs (see EDGES in hexahedron.js).
  const OPENINGS = {
    bays: (s, P) => {
      const { width, mid } = across(s, P);
      return { pitch: R * width, along: (R * width) / 2, upPitch: 8, up: 6, deep: 9, channel: 3, centre: mid };
    },
    // Flutes: upright grooves `groove` wide, `deep`, all the way up, as many
    // as come nearest `pitch` apart, dividing the face exactly, half a pitch
    // off its middle if even (a ridge at each end).
    flutes: (s, P, y, { pitch, groove, deep }) => {
      const { width, mid } = across(s, P), n = Math.max(1, Math.round((R * width) / pitch)), p = (R * width) / n;
      // (On upright faces square to the axes, where a unit along is a unit.)
      if (P.n[0] && P.n[2]) throw new Error('arcology: flutes on a slanted face');
      if (!Number.isInteger(p)) throw new Error('arcology: flutes that do not divide their face');
      const t = [-P.n[2], P.n[0]].map((x) => x / Math.hypot(P.n[0], P.n[2])), d = n % 2 ? 0 : p / 2 / R;
      // (The groove is the channel; the rows of openings within it, of the
      // same depth, add nothing.)
      return { pitch: p, along: groove, upPitch: 24, up: 12, deep, channel: deep, centre: [mid[0] + t[0] * d, 0, mid[2] + t[1] * d] };
    },
    // Rings: level slots `up` high, `deep`, a `pitch` apart up the face, each
    // the face's whole width and on past its ends (meeting its neighbours'
    // round the corners).
    rings: (s, P, y, { pitch, up, deep, from }) => {
      // (One opening to a face: any pitch along longer than the opening will do.)
      const { width, mid } = across(s, P);
      return { pitch: 8 * R * width, along: R * width + 2 * deep + 4, upPitch: pitch, up, deep, centre: mid, from };
    },
    // Rows of segments (the bands' edges: see EDGES in hexahedron.js): rows
    // from `from` units over the band's bottom, a pitch apart, each so high;
    // along, blocks split at up to three cuts; each segment set in by `inset`
    // at each end, at a depth between `deep`'s, or (a chance in 100) none;
    // narrower than 2 units, left out. They run on past the face's ends: round
    // a band's (convex) corners, each face's into the other's (Basil: no
    // corner posts; the profile steps).
    // (And each segment's edges, each set in by up to `jitter` more, by its
    // own hash: segments of varied size and alignment.)
    segments: (s, P, [y0], { rows: [from, upPitch, up], block, cut, inset, deep, none = 0, jitter = 0 }) =>
      ({ pitch: block, along: block, upPitch, up, deep: deep[1], from: R * (y0 - GROUND) + from, vary: { kind: 'segments', cut, inset, deep, none, jitter }, fade: Math.min(up - 2 * jitter, deep[0], 4) }),
  };
  // (The width of a solid's upright face P, along it, and its middle.)
  function across(s, P) {
    // (In plan: the face's line, from its point nearest the axis along its
    // tangent, cut by the solid's other upright planes.)
    const nn = P.n[0] * P.n[0] + P.n[2] * P.n[2], foot = [(P.n[0] * P.K) / nn, (P.n[2] * P.K) / nn], t = [-P.n[2] / Math.sqrt(nn), P.n[0] / Math.sqrt(nn)];
    let lo = -Infinity, hi = Infinity;
    for (const Q of s.planes) {
      if (Q === P || Q.n[1] !== 0) continue;
      const a = Q.n[0] * t[0] + Q.n[2] * t[1], b = Q.K - Q.n[0] * foot[0] - Q.n[2] * foot[1];
      if (Math.abs(a) < 1e-12) continue;
      if (a > 0) hi = Math.min(hi, b / a);
      else lo = Math.max(lo, b / a);
    }
    const m = (lo + hi) / 2;
    return { width: hi - lo, mid: [foot[0] + t[0] * m, 0, foot[1] + t[1] * m] };
  }
  // (A solid's bottom and top, from its level planes.)
  function heightsOf(s) {
    const level = (sg) => s.planes.filter(({ n }) => !n[0] && !n[2] && Math.sign(n[1]) === sg).map(({ n, K }) => K / n[1]);
    return [Math.max(...level(-1)), Math.min(...level(1))];
  }
  const WINDOWS = [], GRIDS = [], FAR = 1 << 28;
  // (Which solids' openings cut through a solid inside their own, as bits by
  // index: those it names as it yields to, else a mass's, all.)
  // (At most 31 solids: see SOLID_BITS.)
  const YIELDS = SOLIDS.map((s) => SOLIDS.reduce((m, o, i) => ((s.yields ? s.yields.includes(o.name) : s.relief) ? m | (1 << i) : m), 0) >>> 0);
  SOLIDS.forEach((s) => s.yields?.forEach((y) => { if (!SOLIDS.some((o) => o.name === y)) throw new Error(`arcology: ${s.name} yields to ${y}, which is no solid`); }));
  SOLIDS.forEach((s) => {
    if (!s.windows) return;
    s.wfirst = WINDOWS.length;
    const kinds = typeof s.windows === 'string' ? [{ kind: s.windows }] : s.windows;
    s.planes.forEach((P) => {
      const { n, K } = P;
      if (n[1] !== 0) return;
      const alpha = gcd(n[0], n[2]), h = [n[0] / alpha, 0, n[2] / alpha], t = [-h[2], 0, h[0]], len = Math.hypot(...h);
      const W = { n, K, alpha, h: slantOf(h), t: slantOf(t), hv: h, tv: t, len, solid: s, g0: GRIDS.length };
      for (const { kind, ...spec } of kinds) {
        const o = OPENINGS[kind](s, P, heightsOf(s), spec);
        // (The grid's phase: where an opening starts along the face, and where
        // a row of them starts up it; and where it may have openings, along
        // and up.)
        const pu = Math.round(o.pitch * len), wu = Math.round(o.along * len), py = o.upPitch, hy = o.up;
        const ph = (o.centre ? Math.round(R * (t[0] * o.centre[0] + t[2] * o.centre[2]) - pu / 2) : 0) + Math.trunc((pu - wu) / 2);
        const yb = o.from ?? Math.trunc((py - hy) / 2);
        if (![pu, wu, ph, py, hy, yb].every(Number.isInteger)) throw new Error('arcology: an opening off the finer grid');
        // (Segments: GVAR (1; their block, cut and inset) and GVB (their
        // depths, least and most; the chance in 100 of none); else 0.)
        const vk = o.vary?.kind, vd = o.vary?.deep ?? [0, 0];
        const v = vk === 'segments' ? [1, o.pitch, o.vary.cut, o.vary.inset] : [0, 0, 0, 0];
        const vb = [...vd, o.vary?.none ?? 0, o.vary?.jitter ?? 0];
        if (vk && (vd[1] > o.deep || o.pitch % o.vary.cut || o.pitch / o.vary.cut < 2 || o.vary.inset < 1 || py - hy < 2 || !(Number.isInteger(vb[3]) && vb[3] >= 0) || hy - 2 * vb[3] < 2)) throw new Error('arcology: segments out of their bounds');
        // (And when it fades, if sooner than its level: openings of size
        // `fade` units fade as the level does where its cells are 4 fade wide,
        // the level's own relief being about a quarter of a cell; as a fraction
        // of a cell, 1 for as the level.)
        const scale = Math.min(1, (4 * (o.fade ?? R)) / R);
        GRIDS.push({ pu, wu, ph, py, hy, yb, vary: v, varyB: vb, scale, dw: Math.round(o.deep * len), ch: Math.round((o.channel ?? 0) * len) });
      }
      W.ng = GRIDS.length - W.g0;
      W.deep = Math.max(...GRIDS.slice(W.g0).map((g) => Math.max(g.dw, g.ch)));
      WINDOWS.push(W);
    });
    if (WINDOWS.length - s.wfirst > 4) throw new Error('arcology: a solid with more than four faces with openings');
  });
  // Whether the slab of face W's openings, from their back (the deeper of
  // gap and channel) to their outer plane as windowAir has them, meets the
  // cell whose corner is c, and its solid touches it. (Outside their solid
  // they make no air that isn't air already, or are stopped: see CLIP.)
  const slabMeets = (W, c) => {
    if (cellOut(W.solid, c)) return false;
    // (Its w across the cell, the least and the most: see toward; alpha is over 0.)
    const K = W.K * R, w = (q) => (R * W.n.reduce((a, x, i) => a + x * (q[i] - ORIGIN[i]), 0)) / W.alpha;
    return w(toward(W.n, c, -1)) < cdiv(K, W.alpha) + Math.ceil(W.len) && w(toward(W.n, c, 1)) > fdiv(K, W.alpha) - W.deep;
  };

  // The table, one cell of level CITY + 1 to an entry (see volume in
  // halls.js): in its first number, the cell's kind (KIND bits: 1 deep, its
  // rooms the halls'; 2 skin, pockets and no rooms; 3 plain, solid), the faces
  // whose pockets reach into it (FACE_AT, a bit each), and for a deep cell,
  // for each of its six sides (+x, -x, +y, -y, +z, -z), whether its rooms'
  // openings may run on across it (OPEN_AT: the next cell is deep too, or
  // clear of every solid); for a skin cell, whether its pockets one level
  // finer may, and whether they run on as one box or three (CROSS_AT, in the
  // second number: see runOn below). In the second number too, the solids
  // touching it or the cells its openings run on into, that they stop at
  // (CLIP: one more than each's index in SOLIDS, in SOLID_BITS each). In the
  // third, the openings it cuts (a skin or plain cell), of up to three solids
  // (WIN_AT, in WIN_BITS each: one more than the solid's index in SOLIDS, 0
  // for none; and a bit for each of its faces with openings, from its first,
  // wfirst). In the fourth, how its openings run on (OPEN_AT and CROSS_AT, as
  // for its pockets in the first and second).
  const WORDS = 4, DEEP = 1, SKIN = 2, PLAIN = 3, FACE_AT = 2, OPEN_AT = 8, SOLID_BITS = 5, WIN_AT = [0, 9, 18], WIN_BITS = 9;
  const CLIP_MOST = 6, CROSS_AT = SOLID_BITS * CLIP_MOST;
  if (SOLIDS.length >= 1 << SOLID_BITS) throw new Error(`arcology: ${SOLIDS.length} solids, at most ${(1 << SOLID_BITS) - 1}`);
  // The town on the roof band's top (.claude/design/town.md): carved from the
  // slab the band's top is raised by, one level finer, in its cells (TOWN_AT,
  // in a plain cell's first number; its run-on as a deep cell's, OPEN_AT, for
  // its four upright sides, and for its four corners, TOWN_CORNER_AT: ++, +-,
  // -+, --). Each cell is laid out in lots by one of TOWN_PLANS, and each lot
  // holds up to TOWN_SHAPES boxes (a building) standing in it, by its hash,
  // all at least TOWN_MARGIN inside it.
  const TOWN_AT = 14, TOWN_CORNER_AT = 15, TOWN_SALT = 0x5be0cd19, TOWN_MARGIN = def.town.margin;
  const TOWN = (() => {
    const s = SOLIDS.find((x) => x.town);
    if (!s) return null;
    const floor = s.town.floor, H = Math.round((heightsOf(s)[1] - floor) * R);
    if (!Number.isInteger(floor) || H < 1 || H > R || R !== 24) throw new Error('arcology: a town that does not fit');
    return { solid: s, floor, H };
  })();
  // (Its lots, plans, densities and kinds of building: see TOWN_DEF.)
  const TOWN_PLANS = def.town.plans, TOWN_PICK = def.town.pick, TOWN_DENSITY = def.town.density, TOWN_SHAPES = townShapes(def.town.types);
  // (The plans' lots in one list, each plan's first (and one past the last),
  // and the town's height in units: as both languages read them.)
  const TOWN_LOT = TOWN_PLANS.flat(), TOWN_PLAN_AT = TOWN_PLANS.map((_, i) => TOWN_PLANS.slice(0, i).flat().length).concat([TOWN_LOT.length]), TOWN_H = TOWN ? TOWN.H : 1;
  // Box k of a lot r, by the lot's hashes h, h2 and its cluster's density
  // (see town.js, whence the shader's too).
  const townShape = townShapeJs(TOWN_H, false, def.town.types);
  // Where the town is set back from the band's edge (def.town.setback), the
  // band's upright faces, which every building keeps `by` units inside: each
  // with its normal across (x, z) and its K, whole numbers (n . X <= K, X in
  // cells from the building's origin, as the cell's corner, CELL.b, is; the
  // shader works them out in whole numbers), its length's reciprocal, and
  // the least whole T that R K - n . p (p in units from the same origin) must
  // be at a box's corner furthest in for the box to stand: the line `by`
  // units in, by |n| in n . p (M, the ceiling of by |n|, found exactly:
  // (M - 1)^2 < by^2 n . n <= M^2), and the square `least` units a side past
  // it, least (|nx| + |nz|) more. None where it is not (by 0): the buildings
  // stand to the edge, cut by the faces as the band ends.
  const TOWN_EDGES = TOWN && def.town.setback.by > 0 ? TOWN.solid.planes.filter(({ n }) => n[1] === 0).map(({ n, K }) => {
    if (!Number.isInteger(K)) throw new Error(`arcology: a face of the town's ${TOWN.solid.name} (${n}) at ${K}, not a whole number: its setback is worked out in whole numbers (see TOWN_EDGES)`);
    const nn = n[0] * n[0] + n[2] * n[2], W2 = def.town.setback.by ** 2 * nn;
    let M = Math.ceil(Math.sqrt(W2));
    while (M * M < W2) M++;
    while ((M - 1) ** 2 >= W2) M--;
    return { n: [n[0], n[2]], K, inv: 1 / Math.sqrt(nn), T: M + def.town.setback.least * (Math.abs(n[0]) + Math.abs(n[2])) };
  }) : [];
  // A box's distance at p (for the tests: the town asks boxSolid).
  const boxDist = ([x0, y0, z0, x1, y1, z1], [x, y, z]) => Math.max(x0 - x, x - x1, y0 - y, y - y1, z0 - z, z - z1);
  const TOWN_CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // (For the checks in .claude/verify.)
  // (For the checks: how many rays the solids without relief have stopped
  // in the city's pockets: see the pockets' block in cellAir.)
  const SEEN = { clipped: 0 };
  const _V2 = { FACES, RIDGES, DMAX, WINDOWS, ORIGIN, SOLID_PI, BITS: { WORDS, OPEN_AT, WIN_AT, WIN_BITS, SOLID_BITS, CROSS_AT, TOWN_AT, DEEP, SKIN, PLAIN }, relief: (...a) => relief(...a), MID, NEAR, NEAR_BOX: [NEAR_X0, NEAR_X1, NEAR_Z0, NEAR_Z1], GROW, BARE_BOX, SEEN, wellOf: (...a) => wellOf(...a), TOWN, TOWN_PLANS, TOWN_SHAPES, TOWN_DENSITY, TOWN_SALT, townTypes: def.town.types, townShape, boxDist, BUILT_CELLS, ridgeRows: { built: (r, lv, y) => ridgeRow(RIDGES[r], lv, y), looked: (r, lv, y) => rowOf(r, lv, y), from: RR_FROM, n: RR_N } };
  const VOLUME = (() => {
    const lo = [0, 1, 2].map((a) => Math.min(...SOLIDS.map((s) => s.lo[a])) - 2);
    const hi = [0, 1, 2].map((a) => Math.max(...SOLIDS.map((s) => s.hi[a])) + 2);
    lo[1] = Math.max(lo[1], G);
    const size = hi.map((h, a) => h - lo[a]);
    const n = size[0] * size[1] * size[2];
    const at = ([x, y, z]) => x + size[0] * (y + size[1] * z);
    const within = ([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
    const kind = new Uint8Array(n), open = new Uint8Array(n), faces = new Uint8Array(n), win = WIN_AT.map(() => new Uint16Array(n));
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const c = [x + lo[0], y + lo[1], z + lo[2]], v = at([x, y, z]);
      const touched = SOLIDS.filter((s) => !cellOut(s, c));
      if (!touched.length) {
        open[v] = 1;
        continue;
      }
      // Faces whose pockets may reach in: some corner of the cell less than
      // REACH inside the face's plane, in its mass.
      let f = 0;
      FACES.forEach((F, i) => {
        if (cellOut(F.solid, c)) return;
        const q = toward(F.n, c, 1);
        if ((F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]) - F.K) / Math.hypot(...F.n) > -REACH) f |= 1 << i;
      });
      // Skin where pockets reach and only masses, their rims and solids out of
      // the pockets' heights touch it (a post's top that is the plate's: see
      // heights); deep where it is wholly inside some solid (whatever else
      // crosses it) and no pocket reaches; plain otherwise.
      // (ylo and yhi are on the quarters the pockets are cut to: see LEVELS' lo4.)
      const reached = (s) => FACES.some((F, i) => f & (1 << i) && heightsOf(s)[0] < F.solid.yhi && heightsOf(s)[1] > F.solid.ylo);
      if (f && touched.every((s) => s.relief || s.rim || !reached(s))) (kind[v] = SKIN), (faces[v] = f);
      else kind[v] = !f && touched.some((s) => cellIn(s, c)) ? DEEP : PLAIN;
      // A skin or plain cell has the openings of each face of each solid with
      // them that touches it whose slab (from behind the face as deep as they
      // go to past it as far as they reach: see windowAir) meets the cell,
      // stopped at the other solids (see CLIP below).
      if (kind[v] === SKIN || kind[v] === PLAIN) {
        const ws = touched.filter((s) => s.windows);
        if (ws.length > WIN_AT.length) throw new Error(`arcology: ${ws.length} solids with openings touch the cell ${c}`);
        ws.forEach((s, k) => {
          let mask = 0;
          WINDOWS.forEach((W, j) => W.solid === s && slabMeets(W, c) && (mask |= 1 << (j - s.wfirst)));
          if (mask) win[k][v] = (SOLIDS.indexOf(s) + 1) | (mask << SOLID_BITS);
        });
      }
    }
    // A skin cell's pockets one level finer run on a cell past each side in
    // OPEN_AT, so that a pocket across the side is one piece and not two that
    // only touch (shrunk with distance, two would leave a sheet between them).
    // A side is open unless the next cell is one that a pocket of the cell's
    // faces could reach (from its lip past the face to REACH in) and that would
    // not cut it (deaf): a deep or plain cell. A skin cell cuts the same
    // pockets (they are the point's alone), and a cell clear of every solid is
    // the city's air. The open sides make one box, across edges and corners
    // too; where that box would take in a deaf cell, each piece is three
    // instead, each run on along one axis only (CROSS_AT).
    const lip = Math.max(...FACES.map((F) => Math.ceil(F.nl) / F.nl)) / R + 1e-3;
    const deaf = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      if (kind[v] !== DEEP && kind[v] !== PLAIN) continue;
      const c = [v % size[0], Math.floor(v / size[0]) % size[1], Math.floor(v / size[0] / size[1])].map((x, a) => x + lo[a]);
      FACES.forEach((F, i) => {
        if (c[1] - ORIGIN[1] >= F.solid.yhi || c[1] + 1 - ORIGIN[1] <= F.solid.ylo) return; // (pockets are cut at those heights only)
        // (Its depth behind the face at the cell's corners, the least and the most: see toward.)
        const depth = (q) => (F.K - (F.n[0] * (q[0] - ORIGIN[0]) + F.n[1] * (q[1] - ORIGIN[1]) + F.n[2] * (q[2] - ORIGIN[2]))) / F.nl;
        if (depth(toward(F.n, c, 1)) < REACH && depth(toward(F.n, c, -1)) > -lip) deaf[v] |= 1 << i;
      });
    }
    // (The steps along each axis to the cells in the box of the open sides.)
    const boxOf = (open) => [0, 1, 2].map((a) => [0, ...(open & (1 << (2 * a)) ? [1] : []), ...(open & (2 << (2 * a)) ? [-1] : [])]);
    // (The sides open where the cell u next to [x, y, z] across them is
    // ok(u), and whether as one box or three.)
    const runOn = (x, y, z, ok) => {
      const okAt = (dx, dy, dz) => ok([x + dx, y + dy, z + dz]);
      let open = 0;
      SIDES.forEach((e, k) => okAt(...e) && (open |= 1 << k));
      const ax = boxOf(open);
      const box = ax[0].every((dx) => ax[1].every((dy) => ax[2].every((dz) => okAt(dx, dy, dz))));
      return [open, !box];
    };
    const skinOk = (f) => (u) => !within(u) || !(deaf[at(u)] & f);
    // A cell's openings run on likewise, unless the next cell is one their
    // slab meets and that does not cut them (off the solid's other faces, say,
    // or under the table's floor, the plaza's ground: there the openings stop
    // at the cell's side). In a skin cell, where both its pockets and its
    // openings may.
    const winsOf = (v) => win.flatMap((w) => [0, 1, 2, 3].filter((k) => (w[v] >> SOLID_BITS) & (1 << k)).map((k) => SOLIDS[(w[v] & ((1 << SOLID_BITS) - 1)) - 1].wfirst + k));
    const plainOk = (ws) => (u) => {
      if (within(u) && open[at(u)]) return true;
      const cuts = within(u) ? winsOf(at(u)) : [], c = u.map((q, a) => q + lo[a]);
      return ws.every((j) => cuts.includes(j) || !slabMeets(WINDOWS[j], c));
    };
    // CLIP: the solids that touch the cell or any cell its openings run on
    // into (the box of its open sides). Each solid's openings stop at the
    // others: at the masses outside it (inside it they cut through: a pillar's
    // channels run on where the lower's slope passes through it), at the rest
    // everywhere (so the roof band runs across a pillar whole). Within any
    // cell their stopping is the same whichever cell asks (a solid that does
    // not touch a cell has nothing in it).
    // (A solid's `keep`: how far clear of it, in cells, others' openings stop.)
    const clipOf = (x, y, z, open) => {
      const out = [], ax = boxOf(open);
      for (const dx of ax[0]) for (const dy of ax[1]) for (const dz of ax[2]) {
        const c = [x + dx + lo[0], y + dy + lo[1], z + dz + lo[2]];
        SOLIDS.forEach((s, i) => !out.includes(i + 1) && !cellOutBy(s, c, s.keep ?? 0) && out.push(i + 1));
      }
      if (out.length > CLIP_MOST) throw new Error(`arcology: ${out.length} solids to stop openings at, at ${[x, y, z]}`);
      return out.reduce((w, i, k) => w | (i << (SOLID_BITS * k)), 0);
    };
    // (The town's cells: plain, the roof band the only solid touching them, in
    // the floor's row, to the band's edge (what stands past its faces is air
    // anyway). Cells by the pillars and the column are left: plinths.)
    const town = new Uint8Array(n);
    if (TOWN)
      for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        const c = [x + lo[0], y + lo[1], z + lo[2]], v = at([x, y, z]);
        if (kind[v] !== PLAIN || c[1] - ORIGIN[1] !== TOWN.floor) continue;
        const touched = SOLIDS.filter((s) => !cellOut(s, c));
        if (touched.length !== 1 || touched[0] !== TOWN.solid) continue;
        town[v] = 1;
      }
    const townOk = (u) => !within(u) || (open[at(u)] && !kind[at(u)]) || town[at(u)];
    const data = new Uint32Array(WORDS * n);
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const v = at([x, y, z]);
      if (!kind[v]) continue;
      let word = kind[v] | (faces[v] << FACE_AT);
      if (kind[v] === DEEP)
        SIDES.forEach((e, k) => {
          const u = [x + e[0], y + e[1], z + e[2]];
          if (!within(u) || open[at(u)] || kind[at(u)] === DEEP) word |= 1 << (OPEN_AT + k);
        });
      if (kind[v] === SKIN) {
        const [open, cross] = runOn(x, y, z, skinOk(faces[v]));
        word |= open << OPEN_AT;
        data[WORDS * v + 1] = cross ? 1 << CROSS_AT : 0;
      }
      if (town[v]) {
        word |= 1 << TOWN_AT;
        [0, 1, 4, 5].forEach((k) => townOk([x + SIDES[k][0], y, z + SIDES[k][2]]) && (word |= 1 << (OPEN_AT + k)));
        TOWN_CORNERS.forEach(([sx, sz], c) => townOk([x + sx, y, z + sz]) && (word |= 1 << (TOWN_CORNER_AT + c)));
      }
      const ws = winsOf(v);
      if (ws.length) {
        const [open, cross] = runOn(x, y, z, plainOk(ws));
        data[WORDS * v + 1] |= clipOf(x, y, z, open);
        data[WORDS * v + 3] = (open << OPEN_AT) | (cross ? 1 << CROSS_AT : 0);
      }
      data[WORDS * v] = word;
      data[WORDS * v + 2] = win.reduce((w, x, k) => w | (x[v] << WIN_AT[k]), 0);
    }
    return { lo, size, data, words: WORDS, kind, open, at, within };
  })();
  // (Both copies look a ridge's rows up in RIDGE_ROWS, at the heights of the
  // table's cells (notchBox) and, within them, of the faces' masses
  // (underRidge: no deeper than the caps, which are nothing outside them): so
  // the ridges' rows' table must hold the table's heights.)
  if (VOLUME.lo[1] - ORIGIN[1] < RR0 || VOLUME.lo[1] + VOLUME.size[1] - ORIGIN[1] > RR1) throw new Error('arcology: the ridges\' rows\' table short of the table\'s heights (RR0, RR1)');

  // The ways into the building from the plaza, for the tour (see
  // Planner.waysFromCity): each a room of the halls one level finer than the
  // city's, in a deep cell, with an opening in one of its walls straight out
  // onto open air. As { id, e }: the room's cell's id at that level, and the
  // way out of it through the opening.
  const ENTRANCES = (() => {
    const { lo, size, kind, open, at, within } = VOLUME;
    const seed = levelSeed(CITY + 1), out = [];
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const v = [x, y, z];
      if (kind[at(v)] !== DEEP) continue;
      const id = wrapId([x + lo[0] + R * C, y + lo[1] + R * ROW, z + lo[2] + R * C]);
      if (!hallsRoom(id, seed, CITY + 1, spaceRoom)) continue;
      for (const o of hallsOpenings(id, seed, CITY + 1, spaceRoom)) {
        if (o.e[1] !== 0) continue;
        const u = v.map((q, a) => q + o.e[a]);
        if (within(u) && open[at(u)]) out.push({ id, e: o.e, at: o.at });
      }
    }
    return out;
  })();

  const ivecs = (rows) => rows.map(([x, y, z]) => `ivec3(${x}, ${y}, ${z})`).join(', ');

  // The openings' tables (see WINDOWS and GRIDS, and the shader's
  // declarations of them), as rows that both languages read: the faces with
  // openings, their grids, and the solids' planes in one list (SOLID_PI,
  // SOLID_INV and SOLID_NRM, each solid's at SOLID_AT: first, how many).
  // (A row of nothing where there are none, as the shader needs one.)
  const rowsOf = (list, none, row) => (list.length ? list : [none]).map(row);
  const OPEN_ROWS = {
    WHT: rowsOf(WINDOWS, { h: { k: 0, sign: 1 }, t: { k: 0, sign: 1 } }, (W) => [W.h.k, W.h.sign, W.t.k, W.t.sign]),
    WKA: rowsOf(WINDOWS, { K: 0, alpha: 1 }, (W) => [W.K, W.alpha]),
    WH: rowsOf(WINDOWS, { hv: [1, 0, 0] }, (W) => W.hv),
    WT: rowsOf(WINDOWS, { tv: [0, 0, 1] }, (W) => W.tv),
    WLEN: rowsOf(WINDOWS, { len: 1 }, (W) => W.len),
    WGR: rowsOf(WINDOWS, { g0: 0, ng: 0 }, (W) => [W.g0, W.ng]),
    GGRID: rowsOf(GRIDS, { pu: 1, wu: 1, dw: 1, ch: 0 }, (g) => [g.pu, g.wu, g.dw, g.ch]),
    GUP: rowsOf(GRIDS, { ph: 0, py: 1, hy: 1, yb: 0 }, (g) => [g.ph, g.py, g.hy, g.yb]),
    GVAR: rowsOf(GRIDS, { vary: [0, 0, 0, 0] }, (g) => g.vary),
    GVB: rowsOf(GRIDS, { varyB: [0, 0, 0, 0] }, (g) => g.varyB),
    GSCALE: rowsOf(GRIDS, { scale: 1 }, (g) => g.scale),
    SOLID_NRM: SOLID_NRM.flat(),
    // (Exactly, in whole numbers, one level finer: n and R K, from the
    // building's origin; and one over n's length. See planeAt.)
    SOLID_PI: SOLID_PI.flat(),
    SOLID_INV: SOLIDS.flatMap((s) => s.planes.map(({ n }) => 1 / Math.hypot(...n))),
    SOLID_AT: SOLID_PI.map((pl, i) => [SOLID_PI.slice(0, i).flat().length, pl.length]),
    SOLID_YIELDS: YIELDS,
    SOLID_KEEP: SOLIDS.map((s) => s.keep ?? 0),
    WFIRST: SOLIDS.map((s) => s.wfirst ?? 0),
    // (The solids without relief: their indices.)
    BARE_ID: BARE.map((s) => SOLIDS.indexOf(s)),
  };
  // (planeAt's whole numbers stay under 2^31 in every cell of the table: n
  // times the point, from the building's origin one level finer, less R K;
  // cityPlaneAt's, at the city's level, R times smaller.)
  const FROM = [0, 1, 2].map((a) => R * (1 + Math.max(Math.abs(VOLUME.lo[a] - ORIGIN[a]), Math.abs(VOLUME.lo[a] + VOLUME.size[a] - 1 - ORIGIN[a]))));
  if (OPEN_ROWS.SOLID_PI.some((p) => p.slice(0, 3).reduce((t, x, a) => t + Math.abs(x) * FROM[a], 0) + Math.abs(p[3]) >= 2 ** 31)) throw new Error('arcology: a solid too fine for the openings\' whole numbers (planeAt): another slope (see slopes in hexahedron.js)');
  // (A table's GLSL declaration: its type, and each row's.)
  // The relief's tables likewise (see LEVELS, FACES, RIDGES and their
  // declarations in the shader): each level's measures (sb, sby, quant,
  // splits), least part and depths' shares (padded to ND with 2: never
  // drawn) and depths (padded with 0); each face's quanta and heights, caps
  // (FCAPS, from FCR: offset, c0, how many), ridges (dl, al, be, sg W), W(t)
  // at them, which ridges, and its normal's measures.
  const RELIEF_ROWS = (() => {
    const caps = [], at = [];
    for (const F of FACES) {
      at.push([caps.length, F.c0, F.cap.length]);
      F.cap.forEach((c) => caps.push(c));
    }
    return {
      LV: LEVELS.map((l) => [l.sb, l.sby, l.quant, l.splits]),
      LV_MIN: LEVELS.map((l) => l.min),
      CUM: LEVELS.flatMap((l) => [...l.cumulative, ...Array(ND - l.depths.length).fill(2)]),
      // (Each level's depths in twelfths of a cell: the city's in quarters,
      // the finer's in their own units, as the builder rounds them.)
      DEPTH12: LEVELS.flatMap((l, lv) => [...l.depths.map((d) => (lv ? twelfths(d / R) : 3 * quarters(d))), ...Array(ND - l.depths.length).fill(0)]),
      FQY: FACES.map((F) => [F.q2[0], F.q2[1], F.lo4, F.hi4]),
      FPLANE: FACES.map((F) => [F.plane.k, F.plane.sign, F.K, F.alpha]),
      FNY: FACES.map((F) => F.yk),
      FNN: FACES.map((F) => F.nn),
      FN: FACES.map((F) => F.n.map((x) => x / F.nl)),
      FHT: FACES.map((F) => [F.h.k, F.h.sign, F.t.k, F.t.sign]),
      FT: FACES.map((F) => F.tv),
      FSL: FACES.map((F) => [F.ms.k, F.ms.sign, F.gm, F.p]),
      // (Each ridge of each face (see F.edges): the other face's index, and
      // its notch's edge's measure.)
      FEG: FACES.flatMap((F) => F.edges.map((E) => FACES.indexOf(E.G))),
      EGL: FACES.flatMap((F) => F.edges.map((E) => E.gl)),
      EGN: FACES.flatMap((F) => F.edges.map((E) => E.gn)),
      FLEN: FACES.map((F) => F.len),
      // (Each face's mass's bounds, from the building's origin, in cells.)
      FLO: FACES.map((F) => F.solid.lo.map((x, a) => x - ORIGIN[a])),
      FHI: FACES.map((F) => F.solid.hi.map((x, a) => x - ORIGIN[a])),
      FCAPS: caps,
      FCR: at,
      FEDGE: FACES.flatMap((F) => F.edges.map((E) => [E.dl, E.al, E.be, E.sg * E.W])),
      FWT: FACES.flatMap((F) => F.edges.flatMap((E) => E.Wt.flat())),
      FER: FACES.flatMap((F) => F.er),
      FNS: FACES.map((F) => [F.nl, F.gm * F.mlen]),
      FNH: FACES.map((F) => [F.n[1], Math.hypot(F.n[0], F.n[2])]),
      // (A terrace's height for t twelfths deep, t 0 to 16, in twelfths: the
      // most whole number of them the face rises over t, worked out in whole
      // numbers: H |ny| <= t |n|, so H^2 ny^2 <= t^2 n . n.)
      FTH: FACES.flatMap((F) => Array.from({ length: 17 }, (_, t) => {
        const nn = dot(F.n, F.n), ny2 = F.n[1] * F.n[1];
        let H = Math.floor((t * Math.sqrt(nn)) / Math.abs(F.n[1]));
        while ((H + 1) * (H + 1) * ny2 <= t * t * nn) H++;
        while (H * H * ny2 > t * t * nn) H--;
        return H;
      })),
    };
  })();
  // (A table's GLSL declaration: its type, and each row's.)
  const table = (type, name, n, row, rows = OPEN_ROWS) => `const ${type} ${name}[${n}] = ${type}[${n}](${rows[name].map(row).join(', ')});`;
  const vrow = (type) => (r) => `${type}(${r.join(', ')})`;

  // The city's own pieces, in either language (js: true, or GLSL), written
  // once: where the middle city cell is (fromMiddle); where the halls may
  // have rooms (offBuilt, spaceRoom); each of the building's solids from its
  // planes (upright or along a slant: see PLANES), as solidN, and solid(k);
  // the plaza's air (see plaza), from the solids' bounds and the near cells'
  // lists (see NEAR); and the ground's cells (see groundCell). (The
  // JavaScript's made into functions: where the middle is and the rooms,
  // early, as the table's construction asks; the rest below. The point along
  // the slants, SL, as setPoint sets it.)
  function cityPieces(js) {
    // (Where the languages differ: what twin.writer writes, a loop's counter,
    // a city cell's id from its corner (divided by R, a vector or each part),
    // the solids' dispatch (a switch, or a list), which of the near cells the
    // cell is (a scan, or a lookup), and the point along a slant. Otherwise
    // the text is both's: in JavaScript float, abs, min and max are as GLSL
    // has them, points are arrays, and whole numbers are as twin.unsigned
    // makes them.)
    const { fn, decl, loop, num, vec3Arg, ivec3, vadd, vsub, D, NOTHING, RAY, X, slant, fade, faded } = twin.writer(js);
    const middle = [
      '// Where the middle city cell is from this one, in lattice units.',
      fn('ivec3', 'fromMiddle', ['ivec3 id']),
      `  return ${ivec3([`(id.x - ${MID}) * R`, `(id.y - ${ROW_ID}) * R`, `(id.z - ${MID}) * R`])};`,
      '}',
    ];
    // (Where the halls may have rooms at the city's level, and the light
    // wells may open: see spaceRoom and well.)
    const offBuilt = [
      "// (How far city cell o (counted from the middle one) is from the nearest",
      '// the building stands in (BUILT_CELLS), in cells either way: 0, one of',
      '// them; 1, next to one; 2, further. Cavities under the ground are only in',
      '// the first two: see spaceRoom. No light well opens in the first: see well.)',
      fn('int', 'offBuilt', ['ivec3 o']),
      '  ' + decl('int', 'd = 2', true),
      `  for (${js ? 'let' : 'int'} k = 0; k < NBUILT; k++) d = min(d, max(abs(BUILT_CELLS[k].x - o.x), abs(BUILT_CELLS[k].y - o.z)));`,
      '  return d;',
      '}',
    ];
    const room = [
      "// Where the halls may have rooms (see spaceRoom in halls.js): not in the",
      "// ground away from the building (Basil, 2026-10-28): at the city's level, in",
      "// the plaza's row and under it, only in the city cells by the building's",
      '// (offBuilt). Without rooms there, there are no light wells there either.',
      "// And in the plaza's row, none in the cells the building stands in: no well",
      "// opens there to carry a room's opening on up (see well), so a room there",
      '// would hang its floor\'s opening into the cell under it with nothing to',
      '// meet it: a pit closed by the plaza\'s floor, its air running on through it',
      '// (ledger B2).',
      fn('bool', 'spaceRoom', ['ivec3 id', 'uint seed']),
      `  if (seed != ${levelSeed(CITY)}u || id.y > ${ROW_ID}) return true;`,
      '  ' + decl('int', `d = offBuilt(${js ? 'fromMiddle(id).map((x) => x / R)' : 'fromMiddle(id) / R'})`),
      `  return d == 1 || (d == 0 && id.y < ${ROW_ID});`,
      '}',
    ];
    // (A plane, from its offset as a whole number and the rest: times one
    // over its length, its normal from the plane as stored.)
    const plane = (p, whole, rest) => `solidPlane((float(${whole}) + ${num(p.scale)} * ${rest}) * ${num(1 / p.len)}, ${vec3Arg(p.n.map((x) => num(x / p.len)))});`;
    const solids = SOLIDS.map((sd, j) => {
      const lines = planesOf(sd).flatMap((p) => {
        if (p.dir < 3) {
          const a = 'xyz'[p.dir];
          return [plane(p, `${p.scale} * L.${a} - (${p.K} - ${p.scale} * o.${a})`, `f.${a}`)];
        }
        const m = p.m, i = p.dir - 3;
        const k = `${p.K} - ${p.scale} * (${m[0]} * o.x + ${m[1]} * o.y + ${m[2]} * o.z)`;
        const { whole, rest } = slant(i, 'n');
        return [...whole, `fr = ${rest};`, plane(p, `${p.scale} * n - (${k})`, 'fr')];
      });
      return [fn('float', `solid${j}`, ['ivec3 L', 'vec3 f', 'ivec3 o']), ...[decl('int', 'n', true), decl('float', 'fr', true), 'solidPiece();', ...lines, 'return solidDone();'].map((l) => '  ' + l), '}'].join('\n');
    });
    const solid = js
      ? `const SOLID_FNS = [${SOLIDS.map((_, j) => `solid${j}`).join(', ')}];\nfunction solid(k, L, f, o) {\n  return SOLID_FNS[k](L, f, o);\n}`
      : `float solid(int k, ivec3 L, vec3 f, ivec3 o) {\n  switch (k) {\n${SOLIDS.map((_, j) => `    case ${j}: return solid${j}(L, f, o);`).join('\n')}\n  }\n  return 1e9;\n}`;
    const near = js
      ? [decl('int', 'n = NEAR_AT.get(o.map((x) => x / R).join()) ?? -1')]
      : [decl('int', 'n = -1', true), `${loop('j', 0, 'NNEAR')} if (NEAR_CELLS[j] == o / R) n = j; }`];
    // (How far the point is outside solid k's bounds along axis a: the whole
    // part apart, as everywhere.)
    const off = (a) => `max(float(SLO[k].${a} - o.${a} - L.${a}) - f.${a}, float(L.${a} + o.${a} - SHI[k].${a}) + f.${a})`;
    const span = (x, f, lo, hi, a) => twin.planes(js, 'air', [{ span: [x, f, lo, hi, a] }])[0];
    // (Where the plaza does not fade, its own lines: see PLAZA. In the shader,
    // the plaza's air is asked unshrunk (gO and gA 0), its solids as the level
    // fades them, grown; and the distance less gO, which map takes off the
    // whole level again, as the town's is: see townAir.)
    const [opened, openedFade, openedFaded] = [(...lines) => (UNFADED ? lines : []), (...lines) => (UNFADED ? fade(...lines) : []), (term) => (UNFADED ? faded(term) : '')];
    const farAxis = opened(
      '// Which way city cell o (counted from the middle one) is out past the',
      '// cells that hold anything but the plaza\'s air by more than one (see',
      '// NEAR_X0): 0, along x; 2, along z (x first); -1, it is not.',
      fn('int', 'farAxis', ['ivec3 o']),
      '  if (o.x < NEAR_X0 - 1 || o.x >= NEAR_X1 + 1) return 0;',
      '  if (o.z < NEAR_Z0 - 1 || o.z >= NEAR_Z1 + 1) return 2;',
      '  return -1;',
      '}',
    );
    // (Cell ids repeat every P cells (see wrapId), and the building with them:
    // a cell out past it along x answers the air between this building's
    // near cells and the next one's, from the one's far side to the other's
    // near side.)
    const PC = R * R;
    const plaza = [
      '// The air over the plaza, less the building: the distance to the nearest',
      '// solid (and, for a ray, where it strikes one, if before it leaves this',
      "// piece of air). The piece runs a cell past this one's sides each way (so",
      '// that it does not seem to close in at every one; narrower, rays far off',
      '// crossed so many pieces that they ran out of steps), and the solids asked',
      '// about are all that reach into it (see NEAR).',
      ...opened(
        '// (Where the plaza does not fade, a cell further out than one past the',
        '// cells that hold anything else (see farAxis) answers the plaza\'s air',
        '// alone, from the floor to over the sky\'s plane, as one piece: out from',
        "// the near cells' side, a cell back from its own, to the next building's",
        '// along that axis, and half the way to where ids repeat along the other.',
        '// Rays far off cross it in a step or two.)',
      ),
      fn('float', 'plaza', ['ivec3 L', 'vec3 f', 'ivec3 id']),
      ...[
        ...opened(decl('ivec3', 'o = fromMiddle(id)'), decl('int', `side = farAxis(${js ? 'o.map((x) => x / R)' : 'o / R'})`)),
        ...openedFade('float fo = gO, fa = gA;', 'gO = 0.0; gA = 0.0;'),
        'airPiece();',
        ...(UNFADED
          ? [
              'if (side < 0) {',
              '  ' + span('L.x', 'f.x', '-R', '2 * R', 0),
              '  ' + span('L.z', 'f.z', '-R', '2 * R', 2),
              '} else if (side == 0) {',
              '  ' + span('L.x', 'f.x', `o.x >= (NEAR_X1 + 1) * R ? NEAR_X1 * R - o.x : (NEAR_X1 - ${PC}) * R - o.x`, `o.x >= (NEAR_X1 + 1) * R ? (NEAR_X0 + ${PC}) * R - o.x : NEAR_X0 * R - o.x`, 0),
              '  ' + span('L.z', 'f.z', `-${PC / 2} * R`, `${PC / 2 + 1} * R`, 2),
              '} else {',
              '  ' + span('L.x', 'f.x', `-${PC / 2} * R`, `${PC / 2 + 1} * R`, 0),
              '  ' + span('L.z', 'f.z', `o.z >= (NEAR_Z1 + 1) * R ? NEAR_Z1 * R - o.z : (NEAR_Z1 - ${PC}) * R - o.z`, `o.z >= (NEAR_Z1 + 1) * R ? (NEAR_Z0 + ${PC}) * R - o.z : NEAR_Z0 * R - o.z`, 2),
              '}',
            ]
          : [span('L.x', 'f.x', '-R', '2 * R', 0), span('L.z', 'f.z', '-R', '2 * R', 2)]),
        ...(UNFADED
          ? ["// (From the floor to a little over the sky's plane, in every row: one", "// piece, so that how open it is over the floor does not stop at the", '// rows\' seam, as the occlusion would see it.)']
          : ['// (From the floor, in the bottom row; higher up, from a little below the', '// cell, into the air of the one under it.)']),
        UNFADED
          ? span('L.y', 'f.y', `G - R * (id.y - ${ROW_ID})`, `${ROWS} * R + M - R * (id.y - ${ROW_ID})`, 1)
          : span('L.y', 'f.y', `id.y == ${ROW_ID} ? G : -M`, 'R + M', 1),
        decl('float', `box = ${D}`),
        ...openedFade('gO = fo; gA = fa;'),
        ...opened(`if (side >= 0) return box${openedFaded(' - gO')};`),
        decl('float', `d = ${NOTHING}`, true),
        ...(UNFADED ? [] : [decl('ivec3', 'o = fromMiddle(id)')]),
        ...near,
        `if (n < 0) return box${openedFaded(' - gO')};`,
        loop('j', 'NEAR_START[n]', 'NEAR_START[n + 1]'),
        ...[
          decl('int', 'k = NEAR_BLOCKS[j]'),
          '// (A solid further off than one already found, or than a ray goes in',
          '// this piece, is not asked about.)',
          ...openedFade('// (Grown as it fades: see GROW.)'),
          decl('float', `far = max(max(${off('x')}, ${off('y')}), ${off('z')})`),
          `if (far >= d && (!${RAY} || far >= ${X}${openedFaded(` + GROW * (gO + gA * ${X})`)})) continue;`,
          'd = min(d, solid(k, L, f, o));',
        ].map((l) => '  ' + l),
        '}',
        `return max(box${openedFaded(' - gO')}, -d);`,
      ].map((l) => '  ' + l),
      '}',
    ];
    const ground = [
      '// The ground away from the building (Basil, 2026-10-28: no cavities in it',
      "// but very near the building): a level-(CITY + 1) cell of the plaza's row,",
      "// beyond the table's bounds across (see VOLUME), holds no halls. The floor",
      "// is on its cells' sides: under it, solid; over it, the plaza's air, which",
      "// is the city's own: this level adds none (so that the floor is the city's",
      '// surface alone, not a tie between two levels on one plane). (own: the',
      "// cell's place in its city cell.)",
      fn('bool', 'groundCell', ['ivec3 own', 'ivec3 up']),
      `  if (up.y != ${ROW_ID}) return false;`,
      '  ' + decl('ivec3', 'v = tableAt(own, up)'),
      '  return v.x < 0 || v.z < 0 || v.x >= VOL_SIZE.x || v.z >= VOL_SIZE.z;',
      '}',
      fn('float', 'groundAir', ['ivec3 L', 'vec3 f']),
      "  // (No nearer air than the cell's sides, past which another cell may have",
      "  // some: under the floor too, which is on cells' sides.)",
      '  ' + decl('float', 'e = min(min(min(float(R - L.x) - f.x, float(L.x) + f.x), min(float(R - L.y) - f.y, float(L.y) + f.y)), min(float(R - L.z) - f.z, float(L.z) + f.z))'),
      '  return max(e, 0.0);',
      '}',
    ];
    // (Where a level-(CITY + 1) cell is in the table, from its corner: the
    // table's lookup (see relief) and the ground's bounds (groundCell).)
    const table = [
      "// Where the level-(CITY + 1) cell is in the table (own: its place in its",
      "// city cell, whose id is up), from the table's lowest corner, in cells.",
      fn('ivec3', 'tableAt', ['ivec3 own', 'ivec3 up']),
      `  return ${vsub(vadd('fromMiddle(up)', 'own'), 'VOL_LO')};`,
      '}',
    ];
    const text = (lines) => (js ? twin.unsigned(twin.arrays(lines.join('\n'), ['L', 'f', 'o', 'v', 'id', 'own', 'up', 'VOL_LO', 'VOL_SIZE'])) : lines.join('\n'));
    return { middle: text(middle), offBuilt: text(offBuilt), room: text(room), solids: text([...solids, solid]), farAxis: text(farAxis), plaza: text(plaza), table: text(table), ground: text(ground) };
  }
  // The openings, in either language (js: true, or GLSL), written once from
  // their tables (OPEN_ROWS): which sides a cell's openings run on across
  // (runsOn, openLo, openHi), how far outside a solid the point is (planeAt
  // and solidAt, the whole part exactly), one face's openings (windowAir),
  // and a cell's (openings); and, at the city's level, how far inside the
  // solids without relief (cityPlaneAt, bareIn), where the city's pockets
  // stop.
  // (The JavaScript's, made into functions below; the cell's state, CELL,
  // as relief, reliefCell, facePocket and windowAir set it.)
  function openingsPieces(js) {
    // (Where the languages differ: what twin.writer writes; the cell's state
    // (gCellB and the rest, or CELL); the point along a slant; vectors (a
    // vec3, or an array: as a call's arguments, negated, of a table's row,
    // a dot product); the slots' arrays (declared, or empty); a ray's reach
    // and normal (inout, or an object, o for each slot, read back into rs
    // and ns); a whole number divided (idiv: truncated in both); and the
    // fade with distance, the shader's alone (the JavaScript's world is as
    // it is: see pieces.js). Otherwise the text is both's: in JavaScript
    // float, int, uint, ceil, min and max are as GLSL has them, vectors are
    // arrays, and whole numbers are as twin.unsigned makes them.)
    const { fn, decl, loop, D, RAY, fade, indent: ins, keep: keepX, arg3: arg, slant } = twin.writer(js);
    const su = slant('ht.z', 'u'), sw = slant('ht.x', 'w');
    const [CELLB, OPEN, CROSS, AXIS, IN, OUT] = js ? ['CELL.b', 'CELL.open', 'CELL.cross', 'CELL.axis', 'S.in', 'S.out'] : ['gCellB', 'gCarveOpen', 'gCarveCross', 'gAxis', 'gIn', 'gOut'];
    const ZERO = js ? '[0, 0, 0]' : 'vec3(0.0)', IN_N = js ? '[S.inx, S.iny, S.inz]' : 'gInN';
    const neg = (v) => (js ? `[-${v}[0], -${v}[1], -${v}[2]]` : `-${v}`);
    const dot = (v, w) => (js ? `(${[0, 1, 2].map((a) => `${v}[${a}] * ${w === 'gDir' ? `S.d${'xyz'[a]}` : `${w}[${a}]`}`).join(' + ')})` : `dot(${v}, ${w})`);
    const idiv = (a, b) => (js ? `int(${a} / ${b})` : `${a} / ${b}`);
    // (The ray's reach and normal kept, where it goes further.)
    const keep = (x, n) => (js ? `if (ray && ${x} > ray.reach) { ray.reach = ${x}; [ray.nx, ray.ny, ray.nz] = ${n}; }` : `if (${x} > reach) { reach = ${x}; nrm = ${n}; }`);
    // (A loop of one statement, without braces.)
    const each = (v, from, to) => loop(v, from, to).slice(0, -2);

    const cell = [
      fn('bool', 'runsOn', ['int a', 'uint side']) + ` return (${OPEN} & (side << uint(2 * a))) != 0u && (${AXIS} < 0 || ${AXIS} == a); }`,
      fn('int', 'openLo', ['int a']) + ' return runsOn(a, 2u) ? -R : 0; }',
      fn('int', 'openHi', ['int a']) + ' return runsOn(a, 1u) ? 2 * R : R; }',
    ];

    const windowAir = [
      "// Face j's openings where the point is: in each of its grids, the opening",
      "// of its square of the grid (GGRID along, GUP up), from GGRID's deep behind",
      "// the face to a unit past it, and its channel (GGRID's channel deep, all the",
      "// way up); or, varying (GVAR), its segment's opening; within the cell or a",
      '// cell past each side in gCarveOpen (as one piece or three: see runsOn); and',
      '// where the point is in',
      "// none, how far off its square's edges are (the other openings are beyond",
      "// them; its channel is one piece up the cell).",
      js ? 'function windowAir(j, L, f, d, ray) {' : 'float windowAir(int j, ivec3 L, vec3 f, float d, bool ray, inout float reach, inout vec3 nrm) {',
      ...ins([
        js ? 'const base = [CELL.b[0] * R, CELL.b[1] * R, CELL.b[2] * R];' : 'ivec3 base = gCellB * R;',
        decl('ivec4', 'ht = WHT[j]'),
        ...(js
          ? ['let u, w;', ...su.whole, ...sw.whole]
          : ['int u, w;']),
        decl('float', `fu = float(ht.w) * ${su.rest}, fw = float(ht.y) * ${sw.rest}`),
        'u = ht.w * u + WT[j].x * base.x + WT[j].z * base.z;',
        'w = ht.y * w + WH[j].x * base.x + WH[j].z * base.z;',
        decl('int', `y = base.y + L.y - ${GROUND * R}`),
        decl('float', 'len = WLEN[j], inv = 1.0 / len'),
        decl('int', 'K = WKA[j].x * R, a = WKA[j].y'),
        decl('int', 'outer = -fdiv(-K, a) + int(ceil(len))'),
        `${RAY} = false;`,
        decl('float', 'gw = 1e9, cap = 1e9', true),
        ...fade(
          '// (With distance an opening fades by getting shallower, as the relief',
          '// does (see facePocket): as its level does, or sooner, at its own size.)',
          'float fo = gO, fa = gA;',
          'gO = 0.0; gA = 0.0;',
        ),
        decl('int', `pieces = ${CROSS} ? 3 : 1`),
        loop('k', 'WGR[j].x', 'WGR[j].x + WGR[j].y'),
        ...ins([
          decl('ivec4', 'g = GGRID[k], gu = GUP[k], gv = GVAR[k], gb = GVB[k]'),
          decl('int', 'cy = fdiv(y - gu.w - (f.y < 0.0 ? 1 : 0), gu.y), y0 = gu.w + cy * gu.y'),
          "// (Segments' rows are shifted along, each by its own whole number of cuts.)",
          decl('int', `sh = gv.x == 1 ? fdiv(gv.z * int(hashCell(${js ? '[cy, k, 0]' : 'ivec3(cy, k, 0)'}, SEGMENT_SALT ^ 1u) % uint(${idiv('gv.y', 'gv.z')})) * g.x, gv.y) : 0`),
          decl('int', 'cu = fdiv(u - gu.x - sh - (fu < 0.0 ? 1 : 0), g.x), u0 = gu.x + sh + cu * g.x'),
          'cap = min(cap, min(min(float(u - u0) + fu, float(u0 + g.x - u) - fu) * inv, min(float(y - y0) + f.y, float(y0 + gu.y - y) - f.y)));',
          "// (A segment's opening: where along, how wide and deep, in its units",
          '// (gv.y to the block).)',
          decl('int', 'vo = 0, vw = 0, vd = 0, jb = 0, jt = 0', true),
          'if (gv.x == 1) {',
          ...ins([
            '// (The segment of its block the point is in, between the block\'s',
            '// cuts, sorted; its opening inset from both ends, or none.)',
            decl('uint', `h = hashCell(${js ? '[cu, cy, k]' : 'ivec3(cu, cy, k)'}, SEGMENT_SALT)`),
            decl('int', `n = ${idiv('gv.y', 'gv.z')} - 1`),
            decl('int', 'c1 = gv.z * (1 + int(h % uint(n))), c2 = gv.z * (1 + int((h >> 10u) % uint(n))), c3 = gv.z * (1 + int((h >> 20u) % uint(n)))', true),
            `${decl('int', 't = min(c1, c2)', true)} c2 = max(c1, c2); c1 = t;`,
            't = min(c2, c3); c3 = max(c2, c3); c2 = t;',
            't = min(c1, c2); c2 = max(c1, c2); c1 = t;',
            decl('float', 'p = float(u - u0) + fu'),
            decl('int', 'A = 0, B = c1, i = 0', true),
            'if (p >= float(fdiv(c1 * g.x, gv.y))) { A = c1; B = c2; i = 1; }',
            'if (p >= float(fdiv(c2 * g.x, gv.y))) { A = c2; B = c3; i = 2; }',
            'if (p >= float(fdiv(c3 * g.x, gv.y))) { A = c3; B = gv.y; i = 3; }',
            'cap = min(cap, min(p - float(fdiv(A * g.x, gv.y)), float(fdiv(B * g.x, gv.y)) - p) * inv);',
            decl('uint', `hs = hashCell(${js ? '[cu, 4 * cy + i, k]' : 'ivec3(cu, 4 * cy + i, k)'}, SEGMENT_SALT ^ 2u)`),
            'vo = A + gv.w;',
            'vw = B - A - 2 * gv.w;',
            'vd = int(hs % 100u) < gb.z ? 0 : gb.x + int((hs >> 8u) % uint(gb.y - gb.x + 1));',
            'if (gb.w > 0) {',
            ...ins([
              '// (J is not known when compiled: were it, (hv >> 16u) % J would meet',
              "// ledger B20's compiler fault. Keep it so, or the shift elsewhere.)",
              decl('uint', `hv = hashCell(${js ? '[cu, 4 * cy + i, k]' : 'ivec3(cu, 4 * cy + i, k)'}, SEGMENT_SALT ^ 3u), J = uint(gb.w + 1)`),
              'jb = int(hv % J); jt = int((hv >> 8u) % J);',
              decl('int', 'jl = int((hv >> 16u) % J), jr = int((hv >> 24u) % J)'),
              'vo += jl; vw -= jl + jr;',
            ]),
            '}',
          ]),
          '}',
          "// (The opening, then its channel, if any; a segment's, if any.)",
          `${loop('c', 0, '(gv.x == 1 ? (vd > 0 ? 1 : 0) : g.w > 0 ? 2 : 1)')}`,
          ...ins([
            js ? 'let ua, ub, ya, yb, back;' : 'int ua, ub, ya, yb, back;',
            'if (gv.x == 1) {',
            ...ins([
              'ua = u0 + fdiv(vo * g.x, gv.y);',
              'ub = u0 + fdiv((vo + vw) * g.x, gv.y);',
              'back = fdiv(K, a) - fdiv(vd * g.x, gv.y);',
              'ya = y0 + jb;',
              'yb = y0 + gu.z - jt;',
            ]),
            '} else {',
            ...ins([
              'ua = u0;',
              'ub = u0 + g.y;',
              'back = fdiv(K, a) - (c == 0 ? g.z : g.w);',
              `ya = c == 0 ? y0 : -${FAR};`,
              `yb = c == 0 ? y0 + gu.z : ${FAR};`,
            ]),
            '}',
            'if (gv.x == 1 && ub - ua < fdiv(2 * g.x, gv.y)) continue;',
            ...fade(
              'float fz = (float(K) / float(a) - float(back)) * inv;',
              "// (Its fade: as its level's, or at its own size, sooner (GSCALE: 1 for",
              '// as the level); for a ray, going no slower than it may in the step.)',
              'float own = (gScale / GSCALE[k] - 1.0 / LOD_HI) * LOD_K;',
              'float fp = clamp(own, 0.0, 1.0), fq = own < 1.0 ? LOD_K * gScaleRate / GSCALE[k] : 0.0;',
            ),
            js ? 'const tn = [WT[j][0] * inv, WT[j][1] * inv, WT[j][2] * inv], hn = [WH[j][0] * inv, WH[j][1] * inv, WH[j][2] * inv];' : 'vec3 tn = vec3(WT[j]) * inv, hn = vec3(WH[j]) * inv;',
            loop('p', 0, 'pieces'),
            ...ins([
              `${AXIS} = pieces == 1 ? -1 : p;`,
              loop('pass', 0, 2),
              ...ins([
                'airPiece();',
                `airPlane((float(ua - u) - fu) * inv, ${arg('tn', '-')});`,
                `airPlane((float(u - ub) + fu) * inv, ${arg('tn')});`,
                ...fade('gA = fq * fz;'),
                `airPlane((float(back - w) - fw) * inv${js ? '' : ' + fp * fz'}, ${arg('hn', '-')});`,
                ...fade('gA = 0.0;'),
                `airPlane((float(w - outer) + fw) * inv, ${arg('hn')});`,
                ...twin.planes(js, 'air', [
                  { span: ['L.y', 'f.y', `max(ya + ${GROUND * R} - base.y, openLo(1))`, `min(yb + ${GROUND * R} - base.y, openHi(1))`, 1] },
                  { span: ['L.x', 'f.x', 'openLo(0)', 'openHi(0)', 0] },
                  { span: ['L.z', 'f.z', 'openLo(2)', 'openHi(2)', 2] },
                ]),
                'if (pass == 0) {',
                ...ins([decl('float', `gd = ${D}`), 'gw = min(gw, gd);', `if (!ray || gd${js ? '' : ' + gO'} > 0.0) break;`, `${RAY} = true;`]),
                '} else {',
                ...ins([`${RAY} = false;`, keepX]),
                '}',
              ]),
              '}',
            ]),
            '}',
          ]),
          '}',
        ]),
        '}',
        `${AXIS} = -1;`,
        ...fade('gO = fo; gA = fa;'),
        'return min(min(d, gw), max(cap, 0.0));',
      ]),
      '}',
    ];
    // How far outside plane k of the solids the point is, one level finer
    // (base: its cell's corner from the building's origin, in that level's
    // units): the whole part in whole numbers, the rest (f) in floats, as
    // the solids are asked at the city's level (see cityPieces); and how far
    // outside solid i (the most of its planes').
    // (Written for either level: K is R K one level finer (planeAt), and R K
    // / R at the city's (cityPlaneAt: exact, K being whole).)
    const planeOf = (name, K) => [
      fn('float', name, ['int k', 'ivec3 L', 'vec3 f', 'ivec3 base']),
      '  ' + decl('ivec4', 'p = SOLID_PI[k]'),
      `  return (float(p.x * (base.x + L.x) + p.y * (base.y + L.y) + p.z * (base.z + L.z) - ${K}) + ${js ? '(p.x * f.x + p.y * f.y + p.z * f.z)' : 'dot(vec3(p.xyz), f)'}) * SOLID_INV[k];`,
      '}',
    ];
    const planeAt = [
      ...planeOf('planeAt', 'p.w'),
      fn('float', 'solidAt', ['int i', 'ivec3 L', 'vec3 f', 'ivec3 base']),
      '  ' + decl('float', 's = -1e9', true),
      `  ${each('k', 'SOLID_AT[i].x', 'SOLID_AT[i].x + SOLID_AT[i].y')} s = max(s, planeAt(k, L, f, base));`,
      '  return s;',
      '}',
    ];

    const openings = [
      ...planeAt,
      '// The openings in a plain or skin cell (see VOLUME in the JS): of each',
      '// solid in its entry (WIN_AT, in m.z), those of each face in its mask,',
      '// stopped at the other solids in CLIP outside it (at another with openings',
      '// here, only where that is not open itself: so that two solids\' openings',
      '// meeting overlap, and leave no sheet between them); for a ray, the furthest',
      '// it runs in them (reach, nrm). A ray in a solid\'s openings stops at the',
      '// first of another\'s way that is outside it: where it goes in, or else where',
      '// it leaves the solid (sooner than it might, in another\'s openings: they',
      '// carry it on from there). (They run on as gCarveOpen and gCarveCross say:',
      '// set from m.w for them.)',
      js ? 'function openings(L, f, m, ray) {' : 'float openings(ivec3 L, vec3 f, uvec4 m, bool ray, inout float reach, inout vec3 nrm) {',
      ...ins([
        js ? 'const base = [CELL.b[0] * R, CELL.b[1] * R, CELL.b[2] * R];' : 'ivec3 base = gCellB * R;',
        decl('float', `a = 1e9${js ? '' : ', fo = gO, fa = gA'}`, true),
        "// (Each solid's openings as they are, first.)",
        ...(js ? [`const ms = [], bs = [], rs = [], ns = [];`] : [`int ms[${WIN_AT.length}];`, `float bs[${WIN_AT.length}], rs[${WIN_AT.length}];`, `vec3 ns[${WIN_AT.length}];`]),
        loop('s', 0, WIN_AT.length),
        ...ins([
          decl('uint', `w = (m.z >> uint(s * WIN_BITS)) & ${(1 << WIN_BITS) - 1}u`),
          `ms[s] = int(w & ${(1 << SOLID_BITS) - 1}u) - 1;`,
          `bs[s] = 1e9; rs[s] = -1.0; ns[s] = ${ZERO};`,
          ...(js ? ['const o = { reach: -1, nx: 0, ny: 0, nz: 0 };'] : []),
          'if (ms[s] >= 0)',
          `  ${js ? 'for (let' : 'for (uint'} k = w >> uint(SOLID_BITS); k != 0u; k &= k - 1u) bs[s] = windowAir(WFIRST[ms[s]] + lowBit(k), L, f, bs[s], ${js ? 'ray && o' : 'ray, rs[s], ns[s]'});`,
          ...(js ? ['rs[s] = o.reach; ns[s] = [o.nx, o.ny, o.nz];'] : []),
        ]),
        '}',
        loop('s', 0, WIN_AT.length),
        ...ins([
          decl('int', 'me = ms[s]'),
          'if (me < 0) continue;',
          decl('float', 'b = bs[s], r = rs[s]', true),
          decl('vec3', 'rn = ns[s]', true),
          decl('float', 'own = solidAt(me, L, f, base)'),
          decl('bool', 'rays = ray && r >= 0.0'),
          '// (Where the ray leaves the solid, and that plane\'s normal.)',
          decl('float', 'oIn = -1e30, oOut = 1e30', true),
          decl('vec3', `oN = ${ZERO}`, true),
          'if (rays) {',
          ...ins([
            ...fade('gO = 0.0; gA = 0.0;'),
            loop('k', 'SOLID_AT[me].x', 'SOLID_AT[me].x + SOLID_AT[me].y'),
            ...ins([
              decl('float', `rd = ${dot('SOLID_NRM[k]', 'gDir')}, g = planeAt(k, L, f, base)`),
              `if (rd > 0.0 && -g / rd < oOut) { oOut = -g / rd; oN = SOLID_NRM[k]; }`,
              'else if (rd < 0.0) oIn = max(oIn, g / -rd);',
              'else if (rd == 0.0 && g > 0.0) oOut = -1e30;',
            ]),
            '}',
          ]),
          '}',
          `${js ? 'for (let' : 'for (uint'} c = m.y & ${(1 << CROSS_AT) - 1}u; c != 0u; c >>= uint(SOLID_BITS)) {`,
          ...ins([
            decl('int', `i = int(c & ${(1 << SOLID_BITS) - 1}u) - 1`),
            'if (i == me) continue;',
            decl('bool', 'through = ((SOLID_YIELDS[i] >> uint(me)) & 1u) != 0u'),
            decl('float', 'inside = SOLID_KEEP[i] * float(R) - solidAt(i, L, f, base), ri = -1.0', true),
            decl('vec3', `rin = ${ZERO}`, true),
            `${each('t', 0, WIN_AT.length)} if (ms[t] == i) {`,
            '  inside = min(inside, bs[t]);',
            '  if (rs[t] > ri) { ri = rs[t]; rin = ns[t]; }',
            '}',
            'b = max(b, through ? min(inside, own) : inside);',
            'if (rays) {',
            ...ins([
              'solidBegin();',
              `${each('k', 'SOLID_AT[i].x', 'SOLID_AT[i].x + SOLID_AT[i].y')} solidFace(planeAt(k, L, f, base) - SOLID_KEEP[i] * float(R), ${arg('SOLID_NRM[k]')});`,
              decl('float', `x = max(${IN}, 0.0)`, true),
              decl('vec3', `n = ${IN_N}`, true),
              `if (through && x >= oIn && x < oOut) { x = oOut; n = ${neg('oN')}; }`,
              '// (Inside it here: air only in its own openings, as the distance',
              '// says, and as far as the ray stays in them.)',
              'else if (x == 0.0 && ri >= 0.0) { x = ri; n = rin; }',
              `if (x < ${OUT} && x < r) { r = x > 0.0 ? x : -1.0; rn = n; }`,
            ]),
            '}',
          ]),
          '}',
          ...fade('gO = fo; gA = fa;'),
          'a = min(a, b);',
          keep('r', 'rn'),
        ]),
        '}',
        'return a;',
      ]),
      '}',
    ];
    // (In JavaScript, vectors are arrays, and whole numbers as it has them.)
    const text = (lines) => (js ? twin.unsigned(twin.arrays(lines.join('\n'), ['L', 'f', 'm', 'base', 'ht', 'g', 'gu', 'gv', 'gb', 'p'])) : lines.join('\n'));
    // How far inside the solids without relief (pillars, the column) the
    // point is, at the city's level (in its lattice units, the cells one
    // level finer; base: its cell's corner from the building's origin;
    // outside, less than 0): the city's pockets stop at their faces. For a ray (ray), also where it strikes one, if sooner
    // than it goes in its air (gX, set by the caller). Each plane as the
    // openings ask it one level finer (see planeAt), its whole part exact.
    const bare = [
      ...planeOf('cityPlaneAt', idiv('p.w', 'R')),
      fn('float', 'bareIn', ['ivec3 L', 'vec3 f', 'ivec3 base', 'bool ray']),
      ...ins([
        decl('bool', `r = ${RAY}`),
        `${RAY} = ray;`,
        decl('float', 'd = -1e9', true),
        loop('i', 0, 'NBARE'),
        ...ins([
          decl('int', 'b = BARE_ID[i]'),
          'solidPiece();',
          `${each('k', 'SOLID_AT[b].x', 'SOLID_AT[b].x + SOLID_AT[b].y')} solidPlane(cityPlaneAt(k, L, f, base), ${arg('SOLID_NRM[k]')});`,
          'd = max(d, -solidDone());',
        ]),
        '}',
        `${RAY} = r;`,
        'return d;',
      ]),
      '}',
    ];
    return { cell: text(cell), windowAir: text(windowAir), openings: text(openings), bare: text(bare) };
  }
  // The town on the roof band's top, in either language (js: true, or GLSL),
  // written once: a box standing in it as a solid (boxSolid), and its air in
  // a cell (townAir). (The JavaScript's, made into functions below; the
  // cell's corner, CELL.b, as relief sets it; a ray aimed already, by
  // reliefCell, as the shader's comes with its reach and normal started.)
  // (The table's cell's corner, as each language keeps it: see relief.)
  const cellB = (js) => (js ? 'CELL.b' : 'gCellB');
  function townPieces(js) {
    // (Where the languages differ: what twin.writer writes; a vector (the
    // point, an axis's normal, a box's lot: a vec3, or an array); a box of
    // the town (out lo and hi, or an array: see townShape in town.js); the
    // ray's reach and normal (inout, or the ray's own object); the corner's
    // root a half (H2 in JavaScript, as twin.planes has it); and the fade
    // with distance, the shader's alone. Otherwise the text is both's: in
    // JavaScript float, min and max are as GLSL has them, vectors are
    // arrays, and whole numbers are as twin.unsigned makes them.)
    const { fn, decl, loop, D, X, RAY, ivec3: iv, fade, indent: ins, keep, axis: E, num } = twin.writer(js);
    const CB = cellB(js);
    // The point is its whole part L and the small rest f (units in the
    // cell), kept apart: where a distance is to a whole number (a side, a
    // lot's edge, a box's face), it is that number minus L, as a float, and
    // f, so that it is as fine as f is however large L is, as Position.levels
    // has it (ledger B40); a box's corners are given from L.
    // Set back from the band's edge (TOWN_EDGES; none, and nothing written,
    // where the town is not): for each face i, townAir works out once, for
    // the cell, k_i (K in units from L: n . f <= k_i on the band's side) and
    // e_i (the point's distance outside the line `by` units in); boxSolid
    // then drops a box unless its corner furthest in is past the line by a
    // square `least` units a side (k_i - n . that corner at least T, all
    // whole numbers), and cuts the rest at the line. A box's distance is
    // still the most of its planes' (exact inside, a lower bound outside: it
    // never overstates), and for a ray the planes are where it strikes.
    // (n . (x, z) for whole numbers n, as whole numbers (c: as written), or
    // as floats (num).)
    const dotN = ([a, b], [x, z], c = String) => [[a, x], [b, z]].filter(([k]) => k).map(([k, v], j) => (j && k < 0 ? ` - ${c(-k)} * ${v}` : `${j ? ' + ' : ''}${c(k)} * ${v}`)).join('');
    const EDGE_ARGS = TOWN_EDGES.map((_, i) => `, e${i}, k${i}`).join('');
    const edgeAt = TOWN_EDGES.flatMap(({ n, K, inv }, i) => [
      decl('int', `k${i} = R * (${K} - (${dotN(n, [`${CB}.x`, `${CB}.z`])})) - (${dotN(n, ['L.x', 'L.z'])})`),
      decl('float', `e${i} = (float(-k${i}) + (${dotN(n, ['f.x', 'f.z'], num)})) * ${num(inv)} + ${num(def.town.setback.by)}`),
    ]);
    const edgeStands = TOWN_EDGES.map(({ n, T }, i) => `k${i} - (${dotN(n, [`int(${n[0] > 0 ? 'lo' : 'hi'}.x)`, `int(${n[1] > 0 ? 'lo' : 'hi'}.z)`])}) < ${T}`);
    // (Box k of lot r, if it has one, then what to do with it, given its
    // corners from L.)
    const shape = (then) => (js ? `{ const b = townShape(h, h2, r, dens, k); if (b) ${then('[b[0] - L.x, b[1] - L.y, b[2] - L.z]', '[b[3] - L.x, b[4] - L.y, b[5] - L.z]')} }` : `if (townShape(h, h2, r, dens, k, lo, hi)) ${then('lo - vec3(L)', 'hi - vec3(L)')}`);
    const lotHash = (n, salt) => `hashCell(${iv([`${CB}.x * 16 + ${n} - l0`, `${CB}.z`, salt])}, TOWN_SALT)`;
    const box = [
      '// A box of the town as a solid: its distance at the point, and for a ray',
      '// where it strikes. Its corners lo and hi and the point f are all from the',
      "// point's whole part L (so f is the point's own rest: see townAir).",
      fn('float', 'boxSolid', ['vec3 lo', 'vec3 hi', 'vec3 f', ...TOWN_EDGES.flatMap((_, i) => [`float e${i}`, `int k${i}`])]),
      ...(TOWN_EDGES.length ? [`  if (${edgeStands.join(' || ')}) return 1e9;`] : []),
      '  solidPiece();',
      ...['x', 'y', 'z'].map((c, a) => `  solidPlane(lo.${c} - f.${c}, ${E(a, '-')}); solidPlane(f.${c} - hi.${c}, ${E(a)});`),
      ...TOWN_EDGES.map(({ n, inv }, i) => `  solidPlane(e${i}, ${js ? `${num(n[0] * inv)}, 0, ${num(n[1] * inv)}` : `vec3(${num(n[0] * inv)}, 0.0, ${num(n[1] * inv)})`});`),
      '  return solidDone();',
      '}',
    ];
    const air = [
      "// The town's air in its cell (w its first number): over the floor (the",
      "// cell's bottom), to its top, cut at the sides it does not run on across (a",
      '// corner too, aslant, where its two sides run on and the cell across it does',
      "// not), with each lot's boxes standing in it. Its distance asks only the",
      "// point's own lot (the others' boxes are TOWN_MARGIN inside theirs); a ray,",
      '// every lot it could reach before it leaves. As the openings, worked out',
      '// unshrunk (gO, gA 0: the caller takes gO off again), fading instead by its',
      "// floor rising to the slab's top with distance, as the level fades (so that",
      '// a capped distance still says whether the point is in its air).',
      js ? 'function townAir(L, f, w, ray) {' : 'float townAir(ivec3 L, vec3 f, uint w, bool ray, inout float reach, inout vec3 nrm) {',
      ...ins([
        ...edgeAt,
        decl('uint', 'open = (w >> uint(OPEN_AT)) & 63u, corner = (w >> uint(TOWN_CORNER_AT)) & 15u'),
        decl('bool', `r0 = ${RAY}`),
        decl('float', `t = 1e9${js ? '' : ', fo = gO, fa = gA'}`, true),
        ...fade(
          'gO = 0.0; gA = 0.0;',
          'float own = (gScale - 1.0 / LOD_HI) * LOD_K;',
          'float fp = clamp(own, 0.0, 1.0), fq = own < 1.0 ? LOD_K * gScaleRate : 0.0;',
        ),
        loop('pass', 0, 2),
        ...ins([
          `${RAY} = pass == 1;`,
          'airPiece();',
          ...fade('gA = fq * float(TOWN_H);'),
          `airPlane(${js ? '' : 'fp * float(TOWN_H) '}- float(L.y) - f.y, ${E(1, '-')});`,
          ...fade('gA = 0.0;'),
          `airPlane(float(L.y - R) + f.y, ${E(1)});`,
          `airPlane(float(L.x - R) + f.x - ((open & 1u) != 0u ? TOWN_MARGIN : 0.0), ${E(0)});`,
          `airPlane(-float(L.x) - f.x - ((open & 2u) != 0u ? TOWN_MARGIN : 0.0), ${E(0, '-')});`,
          `airPlane(float(L.z - R) + f.z - ((open & 16u) != 0u ? TOWN_MARGIN : 0.0), ${E(2)});`,
          `airPlane(-float(L.z) - f.z - ((open & 32u) != 0u ? TOWN_MARGIN : 0.0), ${E(2, '-')});`,
          loop('c', 0, 4),
          ...ins([
            decl('float', 'sx = c < 2 ? 1.0 : -1.0, sz = (c & 1) == 0 ? 1.0 : -1.0'),
            'if ((open & (sx > 0.0 ? 1u : 2u)) != 0u && (open & (sz > 0.0 ? 16u : 32u)) != 0u && (corner & (1u << uint(c))) == 0u)',
            `  airPlane((sx * (float(sx > 0.0 ? L.x - R : L.x) + f.x) + sz * (float(sz > 0.0 ? L.z - R : L.z) + f.z)) * ${js ? 'H2' : '0.70710678'}, ${js ? 'sx * H2, 0, sz * H2' : 'vec3(sx, 0.0, sz) * 0.70710678'});`,
          ]),
          '}',
          decl('float', `box = ${D}`),
          decl('uint', `hc = hashCell(${iv([`fdiv(${CB}.x, 2)`, `fdiv(${CB}.z, 2)`, '9'])}, TOWN_SALT), hl = hashCell(${iv([`${CB}.x`, `${CB}.z`, '11'])}, TOWN_SALT)`),
          decl('uint', `dens = ${TOWN_DENSITY.map((d, i) => (i < TOWN_DENSITY.length - 1 ? `hc % ${TOWN_DENSITY.length}u == ${i}u ? ${d}u : ` : `${d}u`)).join('')}`),
          decl('int', `plan = TOWN_PICK[hl % ${TOWN_PICK.length}u], l0 = TOWN_PLAN_AT[plan], l1 = TOWN_PLAN_AT[plan + 1]`),
          ...(js ? [] : ['vec3 lo, hi;']),
          "// (One loop over the lots for both passes: for the distance, the point's",
          "// own, the first that holds it (a lot at the cell's far side holds the side",
          '// too: the point can be on it), its boxes no further than its edges; for a',
          '// ray, every lot it could reach before it leaves.)',
          decl('int', 'n = l1 - 1', true),
          `if (pass == 0) for (${js ? 'let' : 'int'} l = l0; l < l1; l++) if ((float(L.x - TOWN_LOT[l].z) + f.x < 0.0 || TOWN_LOT[l].z == R) && (float(L.z - TOWN_LOT[l].w) + f.z < 0.0 || TOWN_LOT[l].w == R)) { n = l; break; }`,
          decl('float', 'd = 1e9', true),
          `for (${js ? 'let' : 'int'} l = pass == 0 ? n : l0; l < (pass == 0 ? n + 1 : l1); l++) {`,
          ...ins([
            decl('ivec4', 'r = TOWN_LOT[l]'),
            'if (pass == 1) {',
            ...ins([
              js
                ? 'const off = [max(float(r.x - L.x) - f.x, float(L.x - r.z) + f.x), max(float(-L.y) - f.y, float(L.y - TOWN_H) + f.y), max(float(r.y - L.z) - f.z, float(L.z - r.w) + f.z)];'
                : 'vec3 off = max(vec3(ivec3(r.x, 0, r.y) - L) - f, f - vec3(ivec3(r.z, TOWN_H, r.w) - L));',
              `if (max(max(off.x, off.y), off.z) >= ${X}) continue;`,
            ]),
            '}',
            decl('uint', `h = ${lotHash('l', '7')}, h2 = ${lotHash('l', '8')}`),
            'if (pass == 0) d = min(min(float(L.x - r.x) + f.x, float(r.z - L.x) - f.x), min(float(L.z - r.y) + f.z, float(r.w - L.z) - f.z)) + TOWN_MARGIN;',
            `for (${js ? 'let' : 'int'} k = 0; k < TOWN_SHAPES; k++)`,
            `  ${shape((lo, hi) => `d = min(d, boxSolid(${lo}, ${hi}, f${EDGE_ARGS}));`)}`,
          ]),
          '}',
          'if (pass == 0) {',
          ...ins(['t = max(box, -d);', 'if (!ray || t > 0.0) break;']),
          '} else {',
          ...ins([keep]),
          '}',
        ]),
        '}',
        `${RAY} = r0;`,
        ...fade('gO = fo; gA = fa;'),
        'return t;',
      ]),
      '}',
    ];
    const text = (lines) => (js ? twin.unsigned(twin.arrays(lines.join('\n'), ['lo', 'hi', 'off', 'r', 'CELL.b', 'L', 'f'])) : lines.join('\n'));
    return { box: text(box), air: text(air) };
  }
  // The relief, in either language (js: true, or GLSL), written once from
  // its tables (RELIEF_ROWS, and the ridges' rows, RIDGE_ROWS): its
  // whole-number decisions (the rectangle of a face the point is in, and its
  // depth's index: rectangle; a face's caps, capsAt, capAt, and a level's
  // depths, depthOf; the row of a ridge a height is in, ridgeRow, looked up
  // in the table, as the builder's ridgeRow made it; whether a cut comes
  // near a ridge, nearRidge, and is no deeper than the ridge's there,
  // underRidge; heights in twelfths, h12, terraces' heights and bands,
  // terraceH, bandOf; a rectangle's depth, rectDepth); where the point is on
  // a face and the backs of cuts (faceAt, depthN, depthOut, heights,
  // terraceOf, cutOf); a notch's box (notchBox); a face's pockets and
  // notches (facePocket); the faces' asked in turn (carve); and which faces
  // the city's pockets may reach (cityFaces). (The JavaScript's, made into
  // functions below; what the shader keeps in globals (gU0, gRY0 and the
  // rest), in RS.)
  function reliefPieces(js) {
    // (Where the languages differ: what twin.writer writes; the globals (or
    // RS); a vector (ivec3, or an array, also as an out parameter, set part
    // by part, and copied where GLSL copies); the ridges' rows (a texture,
    // or the table's array); a whole number multiplied as GLSL's int does
    // (Math.imul) and divided (truncated). Otherwise the text is both's: in
    // JavaScript float, int, uint, abs, floor, round, clamp, min and max are
    // as GLSL has them, vectors are arrays, and whole numbers are as
    // twin.unsigned makes them.)
    // (S is the level's scale here, as in the shader: the pieces' state is PS.)
    const { fn, decl, loop, ivec3: iv, indent: ins, struct, fade, faded, axis, arg3, slant, ivec2, vadd, vsub, D, RAY, keep } = twin.writer(js, 'PS');
    const g = (name) => (js ? `RS.${name}` : `g${name}`);
    const idiv = (a, b) => (js ? `int(${a} / ${b})` : `${a} / ${b}`);
    // (A vector b set to the parts xs: as GLSL assigns one, part by part in
    // JavaScript, where an out parameter is the caller's array.)
    const set3 = (b, xs) => (js ? xs.map((x, a) => `${b}[${a}] = ${x};`).join(' ') : `${b} = ivec3(${xs.join(', ')});`);
    // (A rectangle: rows of sby, each shifted along by its own whole number
    // of quanta at the city's level (one level finer, tiled afresh in each
    // city rectangle: no shift, so that the tiles align with its edges),
    // split splits times across the longer side more likely than the shorter
    // (in proportion), never leaving a part under min quanta: no thin
    // slices.)
    const ivec3Var = (name, from) => (js ? `const ${name} = ${from ? `[${from}[0], ${from}[1], ${from}[2]]` : '[0, 0, 0]'};` : `ivec3 ${name}${from ? ` = ${from}` : ''};`);
    const rect = [
      "// The rectangle of face k at level lv that the point is in (u along the",
      '// face, in its own measure, y its true height, each a whole',
      "// number and the rest), and its depth's index. One level finer, tiled afresh",
      '// in each city rectangle (tile, from its corner; no rows shifted).',
      ...(js ? [] : ['int gU0, gU1, gY0, gY1, gDepth;']),
      fn('void', 'rectangle', ['int lv', 'int k', 'int u', 'float fu', 'int y', 'float fy', 'uint tile']),
      ...ins([
        decl('ivec4', 'lvp = LV[lv]'),
        decl('int', `q = lv == 0 ? FQY[k].x : FQY[k].y, n = ${idiv('lvp.x', 'lvp.z')}, su = n * q`),
        decl('uint', 'salt = uint(lv * 0x5bd1e995) ^ tile'),
        decl('int', 'row = fdiv(y - (fy < 0.0 ? 1 : 0), lvp.y)'),
        decl('int', `shift = lv == 0 ? q * int(hashCell(${iv(['row', 'k', 'lv'])}, ROW_SALT ^ salt) % uint(n)) : 0`),
        decl('int', 'col = fdiv(u - (fu < 0.0 ? 1 : 0) - shift, su)'),
        decl('int', 'u0 = col * su + shift, u1 = u0 + su, y0 = row * lvp.y, y1 = y0 + lvp.y', true),
        decl('uint', `h = hashCell(${iv(['col', 'row', 'k'])}, POCKET_SALT ^ salt)`, true),
        decl('int', 'm = LV_MIN[lv]'),
        loop('i', 0, 'lvp.w'),
        ...ins([
          decl('int', `nu = ${idiv('(u1 - u0)', 'q')}, ny = ${idiv('(y1 - y0)', 'lvp.z')}`),
          decl('bool', 'cu = nu >= 2 * m, cy = ny >= 2 * m'),
          'if (cu || cy) {',
          ...ins([
            decl('bool', 'alongU = cu && (!cy || (h & 0xffu) * uint(nu + ny) < 256u * uint(nu))'),
            decl('int', 's = m + int((h >> 8) % uint((alongU ? nu : ny) - 2 * m + 1))'),
            'if (alongU) { if (beyond(u, fu, u0 + s * q)) u0 += s * q; else u1 = u0 + s * q; }',
            'else { if (beyond(y, fy, y0 + s * lvp.z)) y0 += s * lvp.z; else y1 = y0 + s * lvp.z; }',
          ]),
          '}',
          `h = hashCell(${iv(['u0', 'y0', `${js ? 'Math.imul(u1, 4099)' : 'u1 * 4099'} + y1`])}, (POCKET_SALT ^ salt) ^ uint(k));`,
        ]),
        '}',
        decl('float', `t = h01(hashCell(${iv(['u0', 'y0', 'k'])}, DEPTH_SALT ^ salt))`),
        decl('int', 'j = 0', true),
        `${loop('i', 0, 'ND - 1').slice(0, -2)} if (t >= CUM[lv * ND + i]) j = i + 1;`,
        `${g('U0')} = u0; ${g('U1')} = u1; ${g('Y0')} = y0; ${g('Y1')} = y1; ${g('Depth')} = j;`,
      ]),
      '}',
    ];
    const one = (head, body) => `${head} ${body} }`;
    // Depth profiles (relief-v5.md, terraces.md). A cut's depth behind its
    // face varies with height: a terrace's ramps up from nothing at the edge
    // of its band to all of it at its wall's foot, and is nothing elsewhere in
    // its rows; one level finer, a cut adds to the city's terrace under it.
    // Near a ridge a cut must be, at every height, no deeper than the ridge's
    // own cut there (then the two are one cut from past the ridge, inside the
    // ridge's pair: the pair argument holds slice by slice). Heights here are
    // in twelfths of a cell (h12), on which all rows and terraces' heights
    // lie; depths in twelfths; so every test is exact.
    // - nearRidge: whether a cut t deep over [u0, u1] x [y0, y1] (level lv's
    //   measure and units) comes within W(t) of face k's e-th ridge at either
    //   height.
    // - terraceH: a terrace's height for t twelfths, in twelfths, rounded
    //   down, exactly (FTH; see terraceOf).
    // - bandOf: a city terrace of face k, t twelfths deep over rows a to b
    //   (h12): its band [lo, hi] and the height its wall stands at (anchor).
    //   On a face all terraces' ramps have one slope, so one is no deeper
    //   than another over a height range where both are in their bands iff
    //   its anchor is nearer the band's end it ramps from (the upper's: its
    //   top; the lower's: its bottom).
    // - underRidge: whether a cut of face k at level lv over heights s to e2
    //   (h12) is, at its e-th ridge, no deeper than the ridge's: city, its
    //   city terrace's band (if hasCity); one level finer, its own part, fb
    //   twelfths over heights flo to fhi (if hasFine); the ridge's own part
    //   one level finer is behind its terrace's wall in its band, else behind
    //   the face, as cutOf. At most RIDGE_SPAN rows (see check).
    // - rectDepth: a face's rectangle at level lv (drawn depth index j; one
    //   level finer on the city's rectangle, rows cy0 to cy1 in cells, fl
    //   twelfths deep): the deepest of its level's depths, from its own down,
    //   no deeper than the slice allows and, at each ridge it comes within
    //   W(t) of, than the ridge's cut at every height. In twelfths: fl if
    //   none. (Its own part one level finer: in the city terrace's band, from
    //   its floor or to its ceiling; else all its rows.)
    const decide = [
      "// (Written in both languages from one text: see reliefPieces' notes.)",
      "// (Face k's caps at height i, twelfths of a cell.)",
      one(fn('int', 'capsAt', ['int k', 'int i']), `${decl('ivec3', 'c = FCR[k]')} return FCAPS[c.x + clamp(i - c.y, 0, c.z - 1)];`),
      one(fn('int', 'capAt', ['int k', 'int i0', 'int i1']), 'return min(capsAt(k, i0), capsAt(k, i1));'),
      one(fn('int', 'depthOf', ['int lv', 'int j']), 'return DEPTH12[lv * ND + j];'),
      '// The row of ridge r at level lv that height y (level units) is in (see',
      "// ridgeRow, which builds RIDGE_ROWS): gRY0, gRY1, its depth gRT and the",
      "// city's row's gRTC, and the city's row's heights gRCY0, gRCY1 (level units).",
      ...(js ? [] : ['int gRY0, gRY1, gRT, gRTC, gRCY0, gRCY1;']),
      js
        ? 'function ridgeAt(r, lv, y) { const i = 4 * ((2 * r + lv) * RR_W + clamp(y - RR_FROM[lv], 0, RR_N[lv] - 1)); return RR_DATA.subarray(i, i + 4); }'
        : 'ivec4 ridgeAt(int r, int lv, int y) { return texelFetch(uRidgeRows, ivec2(clamp(y - RR_FROM[lv], 0, RR_N[lv] - 1), 2 * r + lv), 0); }',
      fn('void', 'ridgeRow', ['int r', 'int lv', 'int y']),
      ...ins([
        decl('ivec4', 'w = ridgeAt(r, lv, y)'),
        `${g('RY0')} = w.x; ${g('RY1')} = w.y; ${g('RT')} = w.z; ${g('RTC')} = w.w;`,
        `${g('RCY0')} = w.x; ${g('RCY1')} = w.y;`,
        'if (lv == 1) {',
        ...ins([decl('ivec4', 'c = ridgeAt(r, 0, fdiv(y, R))'), `${g('RCY0')} = R * c.x; ${g('RCY1')} = R * c.y;`]),
        '}',
      ]),
      '}',
      fn('bool', 'nearRidge', ['int k', 'int e', 'int lv', 'int u0', 'int u1', 'int y0', 'int y1', 'int t']),
      ...ins([
        decl('ivec4', 'E = FEDGE[k * 2 + e]'),
        decl('int', 'S = lv == 0 ? 1 : R, sg = E.w > 0 ? 1 : -1, sd = E.x > 0 ? 1 : -1, u = sg > 0 ? u0 : u1'),
        decl('int', 'W = FWT[((k * 2 + e) * 2 + lv) * 17 + t] * abs(E.x)'),
        'return sg * sd * (u * E.x - E.y * y0 - S * E.z) < W || sg * sd * (u * E.x - E.y * y1 - S * E.z) < W;',
      ]),
      '}',
      "// Depth profiles: see reliefPieces' notes.",
      one(fn('int', 'h12', ['int lv', 'int y']), `return lv == 0 ? 12 * y : ${idiv('y', '2')};`),
      one(fn('int', 'terraceH', ['int k', 'int t']), 'return FTH[k * 17 + t];'),
      "// (A city terrace's band and anchor: lo, hi, at; false if not cut.)",
      fn('bool', 'bandOf', ['int k', 'int a', 'int b', 'int t', 'out ivec3 B']),
      ...ins([
        set3('B', ['0', '0', '0']).replace('ivec3(0, 0, 0)', 'ivec3(0)'),
        'if (t <= 0) return false;',
        decl('int', 'H = terraceH(k, t)'),
        js ? 'if (FNH[k].x > 0.0) { B[0] = b - H; B[1] = b; B[2] = b; } else { B[0] = a; B[1] = a + H; B[2] = a; }' : 'B = FNH[k].x > 0.0 ? ivec3(b - H, b, b) : ivec3(a, a + H, a);',
        'return true;',
      ]),
      '}',
      fn('bool', 'underRidge', ['int k', 'int e', 'int lv', 'int s', 'int e2', 'bool hasCity', 'ivec3 city', 'bool hasFine', 'int fb', 'int flo', 'int fhi']),
      ...ins([
        decl('int', 'r = FER[k * 2 + e], y = s', true),
        decl('bool', 'up = FNH[k].x > 0.0'),
        loop('i', 0, RIDGE_SPAN),
        ...ins([
          'if (y >= e2) break;',
          'ridgeRow(r, lv, lv == 0 ? fdiv(y, 12) : 2 * y);',
          decl('int', `ra = h12(lv, ${g('RY0')}), rb = h12(lv, ${g('RY1')}), a = max(s, ra), b = min(e2, rb)`),
          ivec3Var('RB'),
          decl('bool', `rok = bandOf(k, h12(lv, ${g('RCY0')}), h12(lv, ${g('RCY1')}), ${g('RTC')}, RB)`),
          'if (hasCity) {',
          ...ins([
            decl('int', 'lo = max(a, city.x), hi = min(b, city.y)'),
            'if (lo < hi && !(rok && RB.x <= lo && hi <= RB.y && (up ? RB.z >= city.z : RB.z <= city.z))) return false;',
          ]),
          '}',
          'if (hasFine) {',
          ...ins([
            decl('int', 'lo = max(a, flo), hi = min(b, fhi)'),
            'if (lo < hi) {',
            ...ins([
              decl('bool', 'inb = rok && (up ? rb >= RB.x : ra <= RB.y)'),
              decl('int', 'alo = inb && up ? max(ra, RB.x) : ra, ahi = inb && !up ? min(rb, RB.y) : rb'),
              `if (!(fb <= ${g('RT')} - ${g('RTC')} && alo <= lo && hi <= ahi)) return false;`,
            ]),
            '}',
          ]),
          '}',
          'y = rb;',
        ]),
        '}',
        'return true;',
      ]),
      '}',
      fn('int', 'rectDepth', ['int k', 'int lv', 'int u0', 'int u1', 'int y0', 'int y1', 'int j', 'int fl', 'int cy0', 'int cy1']),
      ...ins([
        decl('int', 's = h12(lv, y0), e2 = h12(lv, y1)'),
        ivec3Var('cityB'),
        decl('bool', 'hasCB = lv == 1 && bandOf(k, 12 * cy0, 12 * cy1, fl, cityB)'),
        decl('bool', 'up = FNH[k].x > 0.0'),
        `for (${js ? 'let' : 'int'} jj = ND - 1; jj > 0; jj--) {`,
        ...ins([
          'if (jj > j) continue;',
          decl('int', 't = fl + depthOf(lv, jj)'),
          'if (t > capAt(k, s, e2)) continue;',
          ivec3Var('city', 'cityB'),
          decl('bool', 'hasCity = hasCB, hasFine = lv == 1', true),
          'if (lv == 0) hasCity = bandOf(k, s, e2, t, city);',
          decl('bool', 'inb = hasCB && (up ? e2 >= cityB.x : s <= cityB.y)'),
          decl('int', 'flo = inb && up ? max(s, cityB.x) : s, fhi = inb && !up ? min(e2, cityB.y) : e2'),
          decl('bool', 'ok = true', true),
          loop('e', 0, 2).slice(0, -2),
          '  if (ok && nearRidge(k, e, lv, u0, u1, y0, y1, t) && !underRidge(k, e, lv, s, e2, hasCity, city, hasFine, t - fl, flo, fhi)) ok = false;',
          'if (ok) return t;',
        ]),
        '}',
        'return fl;',
      ]),
      '}',
    ];
    // Where the point is on a face, and the backs of cuts (6d-4).
    // (Where the languages differ, beyond the above: the point along a
    // slant (slantAt, or SL: GLSL's out parameter as a statement), an axis's
    // normal and a vector as a call's arguments, and the fade with distance
    // (gCfz), the shader's alone.)
    // (n the whole part of slant k, target factor times the rest.)
    const along = (target, factor, k, n) => {
      const { whole, rest } = slant(k, n);
      return [...whole, `${target} = ${factor} * ${rest};`];
    };
    // - faceAt: where the point is on face k at level scale S (base: its
    //   cell's corner from the building's origin, in this level's units):
    //   along it (u, fu), its true height (y, fy: whole units and the rest,
    //   at least 0; and Y, the same times p, as a whole number and the rest:
    //   Yi, Yf), and how deep (n . X, as a whole number and the rest: ni,
    //   nf). In the shader's globals gP*; in JavaScript RS.P*.
    // - depthN: a face's depth plane x deep, in whole numbers of its measure
    //   (n . X), rounded in, so never deeper.
    // - depthOut: a unit past face k (from faceAt's ni, nf): where a cut's air
    //   ends outward.
    const face = [
      "// Where the point is on face k (see faceAt's note in reliefPieces).",
      ...(js ? [] : ['int gPu, gPy, gPYi, gPni;', 'float gPfu, gPfy, gPYf, gPnf;']),
      fn('void', 'faceAt', ['int k', 'int S', 'ivec3 base']),
      ...ins([
        decl('ivec4', 'ht = FHT[k], sl = FSL[k], pl = FPLANE[k]'),
        js ? 'let u, sn, nn;' : 'int u, sn, nn;',
        ...along(g('Pfu'), 'float(ht.w)', 'ht.z', 'u'),
        `${g('Pu')} = ht.w * u + FT[k].x * base.x + FT[k].z * base.z;`,
        decl('ivec3', 'ms = SLANT[sl.x], mn = SLANT[pl.x]'),
        ...slant('sl.x', 'sn').whole,
        decl('float', `sf = float(sl.y) * ${slant('sl.x', 'sn').rest}`),
        `${g('PYi')} = sl.z * (sl.y * sn + sl.y * (ms.x * base.x + ms.y * base.y + ms.z * base.z)) + FNY[k] * pl.z * S;`,
        `${g('PYf')} = float(sl.z) * sf;`,
        `${g('Py')} = fdiv(${g('PYi')} + int(floor(${g('PYf')})), sl.w);`,
        `${g('Pfy')} = (float(${g('PYi')} - ${g('Py')} * sl.w) + ${g('PYf')}) / float(sl.w);`,
        ...along(g('Pnf'), 'float(pl.y)', 'pl.x', 'nn'),
        `${g('Pni')} = pl.y * (nn + mn.x * base.x + mn.y * base.y + mn.z * base.z);`,
      ]),
      '}',
      '',
      "// A face's depth plane x deep (quarters, twelfths) at level scale S, in whole",
      "// numbers of n . X (see depthN's note in reliefPieces).",
      fn('int', 'depthN', ['int k', 'int S', 'ivec2 x']),
      ...ins([
        '// (floor(p |n| / 12) for p twelfths, exactly: the most dn with 144 dn^2 <= q.)',
        decl('int', 'p = (3 * x.x + x.y) * S, q = p * p * FNN[k]'),
        decl('int', 'dn = int(floor(sqrt(float(q)) / 12.0))', true),
        'if (144 * (dn + 1) * (dn + 1) <= q) dn++;',
        'if (dn > 0 && 144 * dn * dn > q) dn--;',
        'return dn;',
      ]),
      '}',
      '// Its out-plane: about a unit past the face (ceil |n| in n . X).',
      fn('void', 'depthOut', ['int k', 'int S', 'int ni', 'float nf']),
      ...ins([
        decl('float', 'nl = FNS[k].x'),
        `airPlane((float(ni - FPLANE[k].z * S - int(ceil(nl))) + nf) / nl, ${arg3('FN[k]')});`,
      ]),
      '}',
    ];
    // - heights: the true heights lo4 to hi4 (4 y at the city's level; one
    //   level finer, in its units), and one level finer the cell or a cell
    //   past each side in CELL.open (see runsOn). At the city's level from 4y
    //   along the FOUR slant, its whole part first: the true height's own
    //   numbers (see the test 'the relief's heights at the city's level').
    const heights = [
      fn('void', 'heights', ['int lv', 'ivec3 L', 'vec3 f', 'ivec3 base', 'int lo4', 'int hi4']),
      ...ins([
        'if (lv == 1) {',
        ...ins(twin.planes(js, 'air', [
          { span: ['L.y', 'f.y', `max(${idiv('lo4 * R', '4')} - base.y, openLo(1))`, `min(${idiv('hi4 * R', '4')} - base.y, openHi(1))`, 1] },
          { span: ['L.x', 'f.x', 'openLo(0)', 'openHi(0)', 0] },
          { span: ['L.z', 'f.z', 'openLo(2)', 'openHi(2)', 2] },
        ])),
        '} else {',
        ...ins([
          js ? 'let n4;' : 'int n4;',
          ...slant('FOUR', 'n4').whole,
          decl('float', `f4 = ${slant('FOUR', 'n4').rest}`),
          'n4 += 4 * base.y;',
          `airPlane((float(lo4 - n4) - f4) * 0.25, ${axis(1, '-')});`,
          `airPlane((float(n4 - hi4) + f4) * 0.25, ${axis(1)});`,
        ]),
        '}',
      ]),
      '}',
    ];
    // - terraceOf: a city cut t twelfths deep over rows y0 to y1 (level
    //   units, scale S) is a terrace (.claude/design/terraces.md): the solid
    //   between the slope and a vertical wall H tall, the wall standing where
    //   the slope is at the storey's inner height: the upper's faces lean
    //   back, so it is at the top of the rows (a floor at yb, open above);
    //   the lower's lean out, so it is at the bottom (a ceiling at yb). One
    //   level finer, a pocket in a terrace is cut behind its wall (back
    //   units, horizontally) between its floor and top. (H on the grid of the
    //   finer rows, rounded down: so that no finer pocket's row ends just
    //   short of, or on, its floor; see the in-band test in cutOf.) Its
    //   floor's (or ceiling's) height is kept as the wall's inner height, a
    //   whole number, and how far above or below that it is (yb): held as one
    //   number in single precision, the shader's compiler folded the point's
    //   height into it and lost the rest, and the floor came out in steps
    //   (ledger B41).
    // - cutOf: the back of a cut of level lv t twelfths deep over rows y0 to
    //   y1, on a city cut fl deep whose rows are cy0 to cy1 (level units): a
    //   terrace at the city's level; one level finer, behind the city
    //   terrace's wall where its rows reach into the terrace's band, or to its
    //   floor (behind the wall by as much as makes it t - fl twelfths deeper,
    //   along the face's normal), else behind the face (depthN). (Where the
    //   rows reach the band or the floor, a finer pocket is cut only above the
    //   floor, behind the wall, and one that only reaches the floor is not cut
    //   at all; else, cut into the slope below the floor, its air would meet
    //   the terrace's in a plane, with nothing between them but that plane: a
    //   sheet.) In the shader's globals gC*; in JavaScript RS.C*.
    const cut = [
      "// The back of a cut (see cutOf's note): a terrace (gCter: its wall's",
      '// inner height gCyin, its floor or ceiling gCyb from that, behind its wall',
      '// by gCback) or behind the face (gCdn); and how deep it fades from (gCfz).',
      ...(js ? [] : ['bool gCter;', 'int gCyin, gCdn;', 'float gCyb, gCback, gCfz;']),
      fn('void', 'terraceOf', ['int k', 'int S', 'int y0', 'int y1', 'int t']),
      ...ins([
        decl('float', 'H = float(terraceH(k, t)) * float(S) / 12.0'),
        decl('bool', 'up = FNH[k].x > 0.0'),
        `${g('Cter')} = true; ${g('Cyin')} = up ? y1 : y0; ${g('Cyb')} = up ? -H : H; ${g('Cback')} = 0.0;${faded(' gCfz = 0.0;')}`,
      ]),
      '}',
      fn('void', 'cutOf', ['int k', 'int lv', 'int S', 'int y0', 'int y1', 'int t', 'int fl', 'int cy0', 'int cy1']),
      ...ins([
        'if (lv == 0) { terraceOf(k, S, y0, y1, t); return; }',
        'if (fl > 0) {',
        ...ins([
          'terraceOf(k, S, cy0, cy1, fl);',
          `if (FNH[k].x > 0.0 ? float(y1 - ${g('Cyin')}) >= ${g('Cyb')} : float(y0 - ${g('Cyin')}) <= ${g('Cyb')}) { ${g('Cback')} = float(t - fl) / 12.0 * float(S) * FNS[k].x / FNH[k].y;${faded(' gCfz = gCback;')} return; }`,
        ]),
        '}',
        decl('int', 'x = t - fl'),
        `${g('Cter')} = false;`,
        `${g('Cdn')} = depthN(k, S, ${ivec2([idiv('x', '3'), `x - 3 * (${idiv('x', '3')})`])});`,
        ...fade('gCfz = float(gCdn) / FNS[k].x;'),
      ]),
      '}',
    ];
    // A notch (6d-5a). (Where the languages differ, beyond the above: the
    // box (a struct, or an object; no box: on false, or an object saying
    // so), and its fading depth (fz), the shader's alone.)
    // - notchBox: face k's notch at its e-th ridge at level lv, where the
    //   point is (from faceAt: py, pu, pfu, pYi, pYf): past the widest a
    //   notch can be, only how far past it the point is; and within it no
    //   more than how far back from it, so that the distance runs on unbroken
    //   across it (Cap). One level finer, only its own part: the city's row
    //   is the city's. Its edge is W in from the ridge, along it: past it,
    //   only how far past it the point is; on the ridge's side, the box (S),
    //   from past the ridge (a unit past the other face, g) to its edge
    //   (sv), within the row, cut as cutOf says; and how far back from its
    //   edge, so the distance runs on unbroken across it, as across a
    //   rectangle's. The caller builds its air (see facePocket), and takes
    //   its cap with the pocket's.
    const BOX = struct('Box', [['bool', ['on']], ['int', ['A', 'sa', 'B', 'sb', 'y0', 'y1', 'dn', 'g']], ['float', ['fz']], ['int', ['e']], ['float', ['sv']], ['bool', ['ter']], ['int', ['yin']], ['float', ['yb', 'back']]]);
    const box = [BOX.decl];
    const notch = [
      "// Face k's notch at its e-th ridge, at level lv, for the point (see faceAt):",
      `// the box, if the point is on the ridge's side of its edge (${g('EdgeBox')});`,
      "// and how far off its row's ends, or past its edge, the point is (gCap: so",
      "// the distance runs on unbroken across the edge, as across a rectangle's).",
      "// See notchBox's note in reliefPieces.",
      ...(js ? [] : ['float gCap;', 'Box gEdgeBox;']),
      fn('void', 'notchBox', ['int k', 'int e', 'int lv', 'int py', 'int pu', 'float pfu', 'int pYi', 'float pYf']),
      ...ins([
        decl('int', 'S = lv == 0 ? 1 : R'),
        js ? 'RS.EdgeBox = { on: false };' : 'gEdgeBox.on = false;',
        decl('ivec4', 'E = FEDGE[k * 2 + e]'),
        decl('int', 'sg = E.w > 0 ? 1 : -1, sd = E.x > 0 ? 1 : -1, wi = ((k * 2 + e) * 2 + lv) * 17'),
        decl('int', 'Z = sg * sd * (pu * E.x - E.y * pYi - S * E.z)'),
        decl('float', 'fz0 = float(sg * sd) * (float(E.x) * pfu - float(E.y) * pYf), nz = float(abs(E.x)) * EGL[k * 2 + e]'),
        "// (Past the widest a notch can be, only how far past it; see notchBox's note.)",
        decl('float', 'widest = (float(Z - FWT[wi + 16] * abs(E.x)) + fz0) / nz'),
        `if (widest > 0.0) { ${g('Cap')} = widest; return; }`,
        'ridgeRow(FER[k * 2 + e], lv, py);',
        `${g('Cap')} = min(min(float(pYi - ${g('RY0')}) + pYf, float(${g('RY1')} - pYi) - pYf), -widest);`,
        `if (${g('RT')} == 0 || (lv == 1 && ${g('RT')} == ${g('RTC')})) return;`,
        decl('float', `edge = (float(Z - FWT[wi + ${g('RT')}] * abs(E.x)) + fz0) / nz`),
        `if (edge > 0.0) { ${g('Cap')} = min(${g('Cap')}, edge); return; }`,
        `${g('Cap')} = min(${g('Cap')}, -edge);`,
        `cutOf(k, lv, S, ${g('RY0')}, ${g('RY1')}, ${g('RT')}, lv == 1 ? ${g('RTC')} : 0, ${g('RCY0')}, ${g('RCY1')});`,
        `${g('EdgeBox')} = ${BOX.make({ on: 'true', A: '0', sa: '0', B: '0', sb: '0', y0: g('RY0'), y1: g('RY1'), dn: g('Cdn'), g: 'FEG[k * 2 + e]', fz: js ? '0' : 'lv == 1 ? gCfz : 0.0', e: 'e', sv: 'edge', ter: g('Cter'), yin: g('Cyin'), yb: g('Cyb'), back: g('Cback') })};`,
      ]),
      '}',
    ];
    // A face's cuts where the point is (6d-5b): the pocket's box and the
    // notches' (see notchBox), each united with d, in one loop over the boxes
    // there are, by their bits (pocket, notch 0, notch 1; a ray kept where
    // it goes further: '>' on ties); and where the point is in none, how far
    // off their edges are at least (the caps, taken together). (Where the
    // languages differ, beyond the above: the boxes (structs, or objects:
    // copied, or shared, as nothing changes one once made); the point's
    // cell's pieces and the ray's state (gCarveCross, gAxis, gRay: CELL and
    // PS); vectors as a call's arguments; and the fade with distance (fo, fa,
    // fr, fg, fz's terms, gO), the shader's alone: left out of the
    // JavaScript, not made nothing (-0 + 0 would turn -0 to 0).)
    // (Each plane as the shader forms it: the whole numbers first, then the
    // rest, so that where two cuts meet, their planes meet exactly.)
    const [CROSS, AXIS] = js ? ['CELL.cross', 'CELL.axis'] : ['gCarveCross', 'gAxis'];
    // (A vector times s, as a call's arguments.)
    const scaled = (s, v) => (js ? [0, 1, 2].map((a) => `${s} * ${v}[${a}]`).join(', ') : `${s} * ${v}`);
    const face_ = [
      "// Face k's cuts where the point is, at level lv (see facePocket's note),",
      "// united with d; and where it is in none, how far off their edges are at",
      '// least. For a ray, how far it can go in them (reach, and the surface there).',
      js ? 'function facePocket(lv, k, L, f, base, d, ray) {' : 'float facePocket(int lv, int k, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {',
      ...ins([
        decl('int', 'S = lv == 0 ? 1 : R'),
        'faceAt(k, S, base);',
        decl('int', `pu = ${g('Pu')}, pYi = ${g('PYi')}, pni = ${g('Pni')}, py = ${g('Py')}`),
        decl('float', `pfu = ${g('Pfu')}, pYf = ${g('PYf')}, pnf = ${g('Pnf')}, pfy = ${g('Pfy')}`),
        "// The city's rectangle (from one level finer: the point's place in the city's measure), and its depth.",
        decl('int', 'ru = pu, ry = py', true),
        decl('float', 'rfu = pfu, rfy = pfy', true),
        'if (lv == 1) {',
        ...ins([
          'ru = fdiv(pu + (pfu < 0.0 ? -1 : 0), R);',
          'rfu = (float(pu - R * ru) + pfu) / float(R);',
          'ry = fdiv(py, R);',
          'rfy = (float(py - R * ry) + pfy) / float(R);',
        ]),
        '}',
        '// (Each level in turn, in one loop, so that the compiler makes one copy:',
        '// one level finer, tiled afresh from the city rectangle\'s corner, on its floor.)',
        decl('int', 'u0 = 0, u1 = 0, y0 = 0, y1 = 0, o0 = 0, o1 = 0, tc = 0, t = 0, fl = 0, cy0 = 0, cy1 = 0', true),
        decl('uint', 'tile = 0u', true),
        `for (${js ? 'let' : 'int'} l = 0; l <= lv; l++) {`,
        ...ins([
          'rectangle(l, k, ru, rfu, ry, rfy, tile);',
          `u0 = ${g('U0')} + o0; u1 = ${g('U1')} + o0; y0 = ${g('Y0')} + o1; y1 = ${g('Y1')} + o1;`,
          'fl = t;',
          `t = rectDepth(k, l, u0, u1, y0, y1, ${g('Depth')}, fl, cy0, cy1);`,
          'if (l == 0) {',
          ...ins([
            'tc = t; cy0 = y0; cy1 = y1;',
            'o0 = R * u0; o1 = R * y0;',
            'ru = pu - o0; rfu = pfu; ry = py - o1; rfy = pfy;',
            `tile = hashCell(${iv(['u0', 'y0', 'k'])}, TILE_SALT);`,
          ]),
          '}',
        ]),
        '}',
        decl('float', 'inv = 1.0 / FLEN[k]'),
        decl('float', 'cap = min(min(float(pu - u0) + pfu, float(u1 - pu) - pfu) * inv, min(float(pYi - y0) + pYf, float(y1 - pYi) - pYf))', true),
        "// (fz: how deep the box fades from with distance (the shader's): one",
        "// level finer, only the finer part, from the city's floor (as it is cut,",
        "// in the city's measure), in the level's units.)",
        'cutOf(k, lv, S, y0, y1, t, fl, R * cy0, R * cy1);',
        ...(js
          ? [`const bp = ${BOX.make({ on: 't > fl', A: 'u0', sa: '-1', B: 'u1', sb: '1', y0: 'y0', y1: 'y1', dn: g('Cdn'), g: 'k', fz: '0', e: '-1', sv: '0.0', ter: g('Cter'), yin: g('Cyin'), yb: g('Cyb'), back: g('Cback') })};`, 'let bs1 = {}, bs2 = {};']
          : [`Box bp = ${BOX.make({ on: 't > fl', A: 'u0', sa: '-1', B: 'u1', sb: '1', y0: 'y0', y1: 'y1', dn: 'gCdn', g: 'k', fz: 'lv == 0 ? 0.0 : gCfz', e: '-1', sv: '0.0', ter: 'gCter', yin: 'gCyin', yb: 'gCyb', back: 'gCback' })}, bs1, bs2;`]),
        'bs1.on = false; bs2.on = false;',
        decl('int', 'n1 = 0, n2 = 0', true),
        decl('float', 'f1 = 0.0, f2 = 0.0', true),
        `for (${js ? 'let' : 'uint'} m = 3u; m != 0u; m &= m - 1u) {`,
        ...ins([
          decl('int', 'e = lowBit(m)'),
          'notchBox(k, e, lv, py, pu, pfu, pYi, pYf);',
          `cap = min(cap, ${g('Cap')});`,
          `if (${g('EdgeBox')}.on) faceAt(FEG[k * 2 + e], S, base);`,
          `if (e == 0) { bs1 = ${g('EdgeBox')}; n1 = ${g('Pni')}; f1 = ${g('Pnf')}; }`,
          `else { bs2 = ${g('EdgeBox')}; n2 = ${g('Pni')}; f2 = ${g('Pnf')}; }`,
        ]),
        '}',
        js ? 'const tn = [FT[k][0] * inv, FT[k][1] * inv, FT[k][2] * inv];' : 'vec3 tn = vec3(FT[k]) * inv;',
        decl('int', `pieces = lv == 1 && ${CROSS} ? 3 : 1`),
        '// (Over the boxes there are, by their bits, so that the compiler cannot',
        '// copy the loop out once per box.)',
        decl('uint', 'boxes = (bp.on ? 1u : 0u) | (bs1.on ? 2u : 0u) | (bs2.on ? 4u : 0u)'),
        ...fade(
          '// With distance (see the march), the relief one level finer fades by',
          "// getting shallower: each box's floor rises by fr of its fading depth,",
          '// growing by fg of it for each unit the ray goes; its walls stay. (Not by',
          "// the uniform shrinking of the rest of the level's air, which would fill in",
          '// shallow relief long before deep, and leave slivers where boxes meet:',
          '// cell() takes that out again for map.)',
          "// (The city's own cuts keep the uniform shrinking: their face is the",
          "// plaza's air's, which shrinks so; and by the time the city fades they",
          '// are under a pixel.)',
          'float fo = gO, fa = gA, fr = lv == 1 ? gO / (CLOSE * float(R)) : 0.0, fg = lv == 1 ? gA / (CLOSE * float(R)) : 0.0;',
          'if (lv == 1) { gO = 0.0; gA = 0.0; }',
        ),
        `for (${js ? 'let' : 'uint'} m = boxes; m != 0u; m &= m - 1u) {`,
        ...ins([
          decl('int', 'b = lowBit(m)'),
          decl('Box', 'x = bs2', true),
          'if (b == 0) x = bp; else if (b == 1) x = bs1;',
          decl('int', 'gn = b == 0 ? pni : b == 1 ? n1 : n2'),
          decl('float', 'gf = b == 0 ? pnf : b == 1 ? f1 : f2'),
          loop('a', 0, 'pieces'),
          ...ins([
            `${AXIS} = pieces == 1 ? -1 : a;`,
            `${RAY} = false;`,
            decl('float', 'gd = 1e9', true),
            loop('pass', 0, 2),
            ...ins([
              'airPiece();',
              `if (x.e >= 0) airPlane(x.sv, ${arg3('EGN[k * 2 + x.e]')});`,
              'else {',
              ...ins([
                `airPlane(float(x.sa) * (float(pu - x.A) + pfu) * inv, ${scaled('float(x.sa)', 'tn')});`,
                `airPlane(float(x.sb) * (float(pu - x.B) + pfu) * inv, ${scaled('float(x.sb)', 'tn')});`,
              ]),
              '}',
              `airPlane(float(x.y0 - pYi) - pYf, ${axis(1, '-')});`,
              `airPlane(float(pYi - x.y1) + pYf, ${axis(1)});`,
              ...fade('gA = fg * x.fz;'),
              'if (x.ter) {',
              ...ins([
                decl('vec2', 'nh = FNH[k]'),
                decl('bool', 'up = nh.x > 0.0'),
                `airPlane(up ? float(x.yin - pYi) + x.yb - pYf : float(pYi - x.yin) + pYf - x.yb, ${js ? '...(up ? [-0, -1, -0] : [0, 1, 0])' : 'up ? -EY : EY'});`,
                ...(js ? ['const wn = normalize([FN[k][0], 0.0, FN[k][2]]);'] : []),
                `airPlane((float(FPLANE[k].z * S - pni) + nh.x * (float(pYi - x.yin) + pYf) - x.back * nh.y - pnf) / nh.y${js ? '' : ' + fr * x.fz'}, ${js ? arg3('wn', '-') : '-normalize(vec3(FN[k].x, 0.0, FN[k].z))'});`,
              ]),
              `} else airPlane((float(FPLANE[k].z * S - x.dn - pni) - pnf) / FNS[k].x${js ? '' : ' + fr * x.fz'}, ${arg3('FN[k]', '-')});`,
              ...fade('gA = 0.0;'),
              'depthOut(k, S, pni, pnf);',
              'if (x.g != k) depthOut(x.g, S, gn, gf);',
              'heights(lv, L, f, base, FQY[k].z, FQY[k].w);',
              'if (pass == 0) {',
              ...ins([`gd = ${D};`, `if (!ray || gd${js ? '' : ' + gO'} > 0.0) break;`, `${RAY} = true;`]),
              '} else {',
              ...ins([`${RAY} = false;`, keep]),
              '}',
            ]),
            '}',
            'd = min(d, gd);',
          ]),
          '}',
        ]),
        '}',
        `${AXIS} = -1;`,
        ...fade('gO = fo; gA = fa;'),
        'return min(d, max(cap, 0.0));',
      ]),
      '}',
    ];
    // - carve: the pockets and notches at level lv of the faces with a bit in
    //   faces, each in turn (lowest first), united with d. The shader asks
    //   for them from one place (see cell).
    const carve = [
      '// The pockets and notches at level lv of the faces with a bit in faces',
      "// (base: the point's cell's corner from the building's origin, in the",
      "// level's units). Asked after from one place (see cell): what asks for them",
      "// leaves the level (or -1), the faces, the base and the cell's own bound in",
      "// the carve's state (the shader's gCarve globals, the JavaScript's CELL).",
      ...(js ? [] : ['int gCarve;', 'uint gCarveFaces;', 'ivec3 gCarveBase;', 'float gCarveE;']),
      js ? 'function carve(lv, L, f, base, faces, d, ray) {' : 'float carve(int lv, ivec3 L, vec3 f, ivec3 base, uint faces, float d, bool ray, inout float reach, inout vec3 nrm) {',
      '  // (Over the bits set, so that the compiler makes one copy, not one for',
      '  // every face.)',
      `  for (${js ? 'let' : 'uint'} m = faces; m != 0u; m &= m - 1u) d = facePocket(lv, lowBit(m), L, f, base, d, ${js ? 'ray' : 'ray, reach, nrm'});`,
      '  return d;',
      '}',
    ];
    // - cityFaces: which faces the city's pockets may reach the point from
    //   (from BAND_OUT, a cell, past the face's plane to BAND_IN behind it;
    //   the mass's box, two cells past it, a looser gate before that), as a
    //   mask of bits for carve; and how far off the rest are at least (Far).
    const cityFaces = [
      "// Which faces the city's pockets may reach the point from (o",
      "// its cell's corner from the middle cell's: from a cell past each to",
      `// BAND_IN in); and, in ${g('Far')}, how far off the rest are at least.`,
      ...(js ? [] : ['float gFar;']),
      fn('uint', 'cityFaces', ['ivec3 L', 'vec3 f', 'ivec3 o']),
      ...ins([
        decl('ivec3', `base = ${vsub('o', 'ORIGIN')}`),
        `${g('Far')} = 1e9;`,
        decl('uint', 'near = 0u', true),
        loop('k', 0, 'NF'),
        ...ins([
          js ? 'const off = [0, 1, 2].map((a) => max(float(FLO[k][a] - base[a] - L[a]) - 2.0 - f[a], float(base[a] + L[a] - FHI[k][a]) - 2.0 + f[a]));' : 'vec3 off = max(vec3(FLO[k] - base - L) - 2.0 - f, vec3(base + L - FHI[k]) - 2.0 + f);',
          decl('float', 'away = max(max(off.x, off.y), off.z)'),
          `if (away > 0.0) { ${g('Far')} = min(${g('Far')}, away); continue; }`,
          decl('ivec4', 'pl = FPLANE[k]'),
          decl('ivec3', 'm = SLANT[pl.x]'),
          js ? 'let n;' : 'int n;',
          ...slant('pl.x', 'n').whole,
          decl('float', `fr = float(pl.y) * ${slant('pl.x', 'n').rest}`),
          decl('float', 's = (float(pl.y * n + pl.y * (m.x * base.x + m.y * base.y + m.z * base.z) - pl.z) + fr) / FNS[k].x'),
          `if (s < -BAND_IN) { ${g('Far')} = min(${g('Far')}, -s - BAND_IN); continue; }`,
          `if (s > BAND_OUT) { ${g('Far')} = min(${g('Far')}, s - BAND_OUT); continue; }`,
          'near |= 1u << uint(k);',
        ]),
        '}',
        'return near;',
      ]),
      '}',
    ];
    const text = (lines, names = ['lvp', 'c', 'w', 'E', 'city', 'cityB', 'RB']) => (js ? twin.unsigned(twin.arrays(lines.join('\n'), names)) : lines.join('\n'));
    const onFace = ['ht', 'sl', 'pl', 'ms', 'mn', 'base', 'x', 'L', 'f'];
    return { rect: text(rect), decide: text(decide), face: text(face, onFace), heights: text(heights, onFace), cut: text(cut, onFace), box: text(box), notch: text(notch), pocket: text(face_, ['nh']), carve: text(carve), cityFaces: text(cityFaces, ['off', 'base', 'm', 'pl']) };
  }
  // The cell's small pieces, in either language (js: true, or GLSL),
  // written once (6d-6a, 6d-6d, 6d-6e):
  // - relief: what the table says of a cell;
  // - well: the light well under the plaza (in JavaScript also wellOf, for
  //   the checks: whether there is one, its hash and half width, from the
  //   same gate);
  // - bareNear: whether a point is near a solid without relief;
  // - reliefCell: a table's cell. Deep: the halls cut off at the sides they
  //   may not run on across (both passes: the distance, then a ray, kept
  //   where it goes less far: '<'). Skin or plain: its openings (where it
  //   has some), and a plain cell's town, its bound; a skin cell's pockets
  //   asked after once the cell is done (see cell, cellAir). (Shader only:
  //   gRay's second job (whether the cell is asked with a ray: saved and
  //   restored), gSkin, and gO taken off; JavaScript only: the ray's state
  //   cleared after the deep pass, and aim where the shader starts reach
  //   and nrm.)
  // - city: a cell of the city's rows: its plaza and its well, the further
  //   of them for a ray, its pockets asked after once the cell is done;
  // - cell (in JavaScript cellAir): a cell of any level, in one order: the
  //   city's cells, the sky over them; one level finer, the cells the table
  //   has an entry for (the halls only in its deep ones) and those it has
  //   none for (the ground away from the building, else the halls); the
  //   halls everywhere else; then the pockets asked after once (carve, its
  //   one call), stopped, at the city's level, at the solids without relief.
  //   (Shader only: gRay's second job, gSkin, and gO; JavaScript only: the
  //   point along the slants set where the city's and the relief's pieces
  //   ask after it (setPoint), and the clips counted (SEEN.clipped). Every cell answers the ray, aimed where
  //   the shader starts reach and nrm afresh: see hallsAir.)
  // (Where the languages differ: what twin.writer writes (vadd, vsub among
  // it); the cell's corner (gCellB, CELL.b: see cellB); the cell's place in
  // its city cell (own: see ownGlsl, ownOf); a city cell's id from its
  // corner; a city cell's id against BUILT_CELLS' (a vector's equality);
  // built's rule (spaceRoom: the JavaScript's halls take it); the bare
  // boxes' bounds, part by part in JavaScript; and the carve's state
  // (CELL's fields, the shader's gCarve globals). Otherwise the text is
  // both's: in JavaScript GLSL's vectors' functions as AS_GLSL_VEC has them
  // (ivec3, uvec4, any, lessThan, greaterThanEqual), the table read as
  // texelFetch reads it (see the module below: none out of its bounds, as
  // WebGL2 gives), and whole numbers as twin.unsigned makes them. The
  // JavaScript's module takes openings and townAir, so is made after the
  // town's; and the halls' hallsAir (hallsCell in GLSL), the relief's carve
  // and cityFaces, the city's plaza and ground, as made before it.)
  function cellPieces(js) {
    const { fn, decl, num, vadd, vsub, RAY, X, D, REACH, READ_REACH, aim, take, fade, faded, shaderOnly, axis, NOTHING } = twin.writer(js);
    // (Where the plaza does not fade, its own lines and terms: see PLAZA.)
    const [opened, openedFade, openedFaded] = [(...lines) => (UNFADED ? lines : []), (...lines) => (UNFADED ? fade(...lines) : []), (term) => (UNFADED ? faded(term) : '')];
    const CB = cellB(js);
    const relief = [
      '// What the table says of the level-(CITY + 1) cell id, in a city cell',
      `// (whose id is up): nothing, if it is not in the table. ${CB} is set to the`,
      "// cell's corner from the building's origin, in cells.",
      ...(js ? [] : ['ivec3 gCellB;']),
      fn('uvec4', 'relief', ['ivec3 id', 'ivec3 up']),
      `  if (up.y < ${ROW_ID} || up.y >= ${ROW_ID + ROWS}) return uvec4(0u);`,
      '  ' + decl('ivec3', `own = ${js ? 'ownOf(id)' : ownGlsl('id')}`),
      '  ' + decl('ivec3', 'v = tableAt(own, up)'),
      '  if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) return uvec4(0u);',
      `  ${CB} = ${vsub(vadd('v', 'VOL_LO'), 'ORIGIN')};`,
      '  return texelFetch(uVolume, v, 0);',
      '}',
    ];
    // (Whether the cell has a well, none being nothing: the gate.)
    const gate = (nothing) => [
      '  ' + decl('ivec3', `below = wrapId(${vsub('id', 'ivec3(0, 1, 0)')})`),
      `  if (!(${['below', 'id'].map((c) => (js ? `built(${c}, seed, ${CITY}, spaceRoom)` : `built(${c}, seed, ${CITY})`)).join(' || ')})) return ${nothing};`,
      `  if (offBuilt(${js ? 'fromMiddle(id).map((x) => x / R)' : 'fromMiddle(id) / R'}) == 0) return ${nothing};`,
    ];
    const slab = `hashCell(below, seed ^ ${hexu(HALLS.salt.slab)})`;
    const well = [
      '// The light well, if any, that the hall below opens up through the plaza:',
      "// the halls' own opening through its ceiling (their slabHole, at the city's",
      '// level), carried on up to the plaza.',
      fn('float', 'well', ['ivec3 L', 'vec3 f', 'ivec3 id', 'uint seed']),
      ...gate('1e9'),
      `  return slabHole(L, f, -M, G + 1, ${slab}, ${CITY});`,
      '}',
      ...(js ? ['// (Whether it has one: its hash and half width, or null.)', 'function wellOf(id, seed) {', ...gate('null'), `  const h = ${slab}, w = slabHalf(h, ${CITY});`, '  return w === null ? null : { h, w };', '}'] : []),
    ];
    const bareNear = [
      '// Whether the point, its whole part W and the rest f (units from the',
      "// building's origin), is within r of the bounds of a solid without relief",
      "// (pillars, the column), where the city's pockets stop at its faces: only",
      '// there need they ask how far inside one it is (bareIn).',
      fn('bool', 'bareNear', ['ivec3 W', 'vec3 f', 'float r']),
      `  for (${js ? 'let' : 'int'} i = 0; i < NBARE; i++) {`,
      js ? '    const o = [0, 1, 2].map((a) => max(float(BARE_LO[i][a] - W[a]) - f[a], float(W[a] - BARE_HI[i][a]) + f[a]));' : '    vec3 o = max(vec3(BARE_LO[i] - W) - f, vec3(W - BARE_HI[i]) + f);',
      '    if (max(max(o.x, o.y), o.z) < r) return true;',
      '  }',
      '  return false;',
      '}',
    ];
    const [OPEN, CROSS, CARVE, CARVE_FACES, BASE, E] = js ? ['CELL.open', 'CELL.cross', 'CELL.carve', 'CELL.faces', 'CELL.base', 'CELL.e'] : ['gCarveOpen', 'gCarveCross', 'gCarve', 'gCarveFaces', 'gCarveBase', 'gCarveE'];
    const side = (bit, a, plane, sign) => `if ((open & ${bit}u) == 0u) airPlane(${plane}, ${axis(a, sign)});`;
    const reliefCell = [
      '// A level-(CITY + 1) cell the table says something of: deep in the',
      "// building, the halls (d, reach and nrm being what they say of it), cut off",
      '// at its sides across which they may not run on; in its skin, pockets and no',
      "// rooms (they are the city's surface, coloured as the city: gSkin), and any",
      '// openings it has (see openings); plain, solid but for its openings, and its',
      '// town (see townAir). Its air is never further off than its sides (the next',
      "// cell's may be just across them).",
      js ? 'function reliefCell(L, f, id, seed, m, d, ray) {' : 'float reliefCell(ivec3 L, vec3 f, ivec3 id, uint seed, uvec4 m, float d, inout float reach, inout vec3 nrm) {',
      '  ' + decl('uint', 'kind = m.x & 3u'),
      ...shaderOnly('  bool ray = gRay;'),
      `  if (kind == ${DEEP}u) {`,
      '    ' + decl('uint', 'open = (m.x >> uint(OPEN_AT)) & 63u'),
      '    if (open == 63u) return d;',
      `    ${RAY} = false;`,
      `    ${js ? 'for (let' : 'for (int'} pass = 0; pass < 2; pass++) {`,
      '      airPiece();',
      '      ' + side(1, 0, 'float(L.x - R) + f.x', ''),
      '      ' + side(2, 0, '-float(L.x) - f.x', '-'),
      '      ' + side(4, 1, 'float(L.y - R) + f.y', ''),
      '      ' + side(8, 1, '-float(L.y) - f.y', '-'),
      '      ' + side(16, 2, 'float(L.z - R) + f.z', ''),
      '      ' + side(32, 2, '-float(L.z) - f.z', '-'),
      '      if (pass == 0) {',
      "        // (Cut off at those sides; and the next cell's air, a skin's",
      '        // pockets, may be just across them.)',
      `        d = max(d, ${D});`,
      `        if (d > 0.0) d = min(d, max(-${D}, 0.0));`,
      `        if (!ray || ${REACH} < 0.0) break;`,
      `        ${RAY} = true;`,
      `      } else ${take('<')}`,
      '    }',
      `    ${js ? 'S.ray = false;' : 'gRay = ray;'}`,
      '    return d;',
      '  }',
      `  ${js ? 'const' : 'float'} e = min(min(min(float(R - L.x) - f.x, float(L.x) + f.x), min(float(R - L.y) - f.y, float(L.y) + f.y)),`,
      '                min(float(R - L.z) - f.z, float(L.z) + f.z));',
      ...aim('  '),
      `  ${OPEN} = (m.w >> uint(OPEN_AT)) & 63u;`,
      `  ${CROSS} = ((m.w >> uint(CROSS_AT)) & 1u) != 0u;`,
      '  ' + decl('float', `a = m.z != 0u ? ${js ? 'openings(L, f, m, ray)' : 'openings(L, f, m, ray, reach, nrm)'} : 1e9`, true),
      ...shaderOnly('  gRay = ray;'),
      `  ${OPEN} = (m.x >> uint(OPEN_AT)) & 63u;`,
      `  ${CROSS} = ((m.y >> uint(CROSS_AT)) & 1u) != 0u;`,
      `  if (kind == ${PLAIN}u) {`,
      `    if (((m.x >> uint(TOWN_AT)) & 1u) != 0u) a = min(a, ${js ? 'townAir(L, f, m.x, ray)' : 'townAir(L, f, m.x, ray, reach, nrm)'});`,
      ...fade('    gSkin = ray ? reach >= 0.0 : a < 0.0;', '    // (Less gO, which map takes off the whole level again: see cell.)'),
      `    return min(a${faded(' - gO')}, max(e, 0.0));`,
      '  }',
      '  // (Its pockets, with its openings: see cell.)',
      `  ${CARVE} = 1;`,
      `  ${CARVE_FACES} = (m.x >> uint(FACE_AT)) & 63u;`,
      `  ${BASE} = ${js ? 'CELL.b.map((x) => x * R)' : 'gCellB * R'};`,
      `  ${E} = e;`,
      `  return a${faded(' - gO')};`,
      '}',
    ];
    // (Where the plaza does not fade: whether the city's level is faded fully,
    // as the cell being asked about is seen (see gScale). Then all there is of
    // it is the plaza, and the solids standing in it, grown as far as they
    // grow; its wells, its pockets and the halls under the plaza are gone, as
    // the whole level would be. Asked where it is used: kept in a global,
    // set once, it took the shader's build from 2.4 s to 4.0 s.)
    const GONE = '(gScale - 1.0 / LOD_HI) * LOD_K >= 1.0';
    const city = [
      '// A cell of the city.',
      ...opened("// (Where the plaza does not fade, a cell far out holds nothing but its air: see farAxis.)"),
      js ? 'function city(L, f, id, seed, ray) {' : 'float city(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {',
      ...aim('  '),
      ...shaderOnly('  bool ray = gRay;', '  gRay = false;'),
      ...opened('  ' + decl('bool', `rest = farAxis(${js ? 'fromMiddle(id).map((x) => x / R)' : 'fromMiddle(id) / R'}) < 0${openedFaded(` && !(${GONE})`)}`)),
      '  ' + decl('float', `w = id.y == ${ROW_ID}${UNFADED ? ' && rest' : ''} ? well(L, f, id, seed) : ${NOTHING}`),
      '  ' + decl('float', 'p = plaza(L, f, id)'),
      ...[...twin.reask(js, 'p', 'plaza(L, f, id)'), ...twin.reask(js, 'w', 'well(L, f, id, seed)')].map((l) => '  ' + l),
      ...shaderOnly('  gRay = ray;'),
      '  // (Its pockets: see cell.)',
      UNFADED ? `  ${CARVE} = rest ? 0 : -1;` : `  ${CARVE} = 0;`,
      UNFADED ? `  ${CARVE_FACES} = rest ? cityFaces(L, f, fromMiddle(id)) : 0u;` : `  ${CARVE_FACES} = cityFaces(L, f, fromMiddle(id));`,
      `  ${BASE} = ${vsub('fromMiddle(id)', 'ORIGIN')};`,
      '  return min(p, w);',
      '}',
    ];
    // (The cell's parent's id (the shader's caller's gUp, the JavaScript's
    // up); no entry in the table (in JavaScript one array, NO_ENTRY, read
    // only); how far off the city's other faces are (see cityFaces).)
    const [UP, NO_ENTRY, FAR] = js ? ['up', 'NO_ENTRY', 'RS.Far'] : ['gUp', 'uvec4(0u)', 'gFar'];
    // (The ray's reach and normal, as the carve block saves them, hands them
    // to the pieces' state (gX, gN) for the bare clip, and takes them back,
    // or the clip's: in JavaScript the ray may be absent (the shader's reach
    // is -1 then, its normal 0), and its normal is saved only where the
    // city's clip may restore it; the clips counted, for the checks: see
    // clipped.js.)
    const [SAVE, HAND, RESTORE, TAKE] = js
      ? [
          [`const r0 = ${READ_REACH};`, `const n0 = ${CARVE} == 0 && ray && [ray.nx, ray.ny, ray.nz];`],
          'if (ray) (S.x = ray.reach), (S.nx = ray.nx), (S.ny = ray.ny), (S.nz = ray.nz);',
          '{ if (ray) (ray.reach = r0), ([ray.nx, ray.ny, ray.nz] = n0); }',
          '{ if (S.x < ray.reach) SEEN.clipped++; (ray.reach = S.x), (ray.nx = S.nx), (ray.ny = S.ny), (ray.nz = S.nz); }',
        ]
      : [['float r0 = reach;', 'vec3 n0 = nrm;'], 'gX = reach; gN = nrm;', '{ reach = r0; nrm = n0; }', '{ reach = gX; nrm = gN; }'];
    const cell = [
      js ? 'function cellAir(L, f, id, seed, dg, level, up, ray) {' : 'float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {',
      `  if (level < ${CITY}) {`,
      ...aim('    '),
      `    return ${NOTHING};`,
      '  }',
      `  ${CARVE} = -1;`,
      '  ' + decl('float', `d = ${NOTHING}`, true),
      `  if (level == ${CITY} && id.y >= ${ROW_ID} && id.y < ${ROW_ID + ROWS}) d = ${js ? '(setPoint(L, f, dg), city(L, f, id, seed, ray))' : 'city(L, f, id, seed, reach, nrm)'};`,
      '  else {',
      "    // Over the city there is only sky, and the city's air comes right up to",
      '    // the cells above it: all a cell up there can say is how far down it is.',
      `    if (level == ${CITY} && id.y >= ${ROW_ID + ROWS} && id.y <= ${ROW_ID + ABOVE}) {`,
      ...aim('      '),
      `      return float(L.y + R * (id.y - ${ROW_ID + ROWS})) + f.y;`,
      '    }',
      ...openedFade("    // (The city's level faded fully: none of it is left but the plaza, and", '    // the solids standing in it, grown.)', `    if (level == ${CITY} && ${GONE}) {`, ...aim('      '), `      return ${NOTHING};`, '    }'),
      '    // (The halls asked after in one place only: the compiler copies them out',
      '    // wherever they are asked after, and they are much the biggest part. Not',
      '    // at all in the skin and plain cells, which have none.)',
      '    ' + decl('uvec4', `m = level == ${CITY + 1} ? relief(id, ${UP}) : ${NO_ENTRY}`),
      '    ' + decl('uint', 'kind = m.x & 3u'),
      ...aim('    '),
      // (In JavaScript, its place in its city cell worked out only where asked.)
      ...shaderOnly(`    ivec3 own = ${ownGlsl('id')};`),
      `    if (level == ${CITY + 1} && m.x == 0u && groundCell(${js ? 'ownOf(id)' : 'own'}, ${UP})) d = groundAir(L, f);`,
      `    else if (m.x == 0u || kind == ${DEEP}u) d = ${js ? 'hallsAir(L, f, id, seed, dg, level, spaceRoom, ray)' : 'hallsCell(L, f, id, seed, level, reach, nrm)'};`,
      `    if (m.x != 0u) d = ${js ? '(setPoint(L, f, dg), reliefCell(L, f, id, seed, m, d, ray))' : 'reliefCell(L, f, id, seed, m, d, reach, nrm)'};`,
      '  }',
      "  // (The buildings' relief, asked after in one place only, as the halls are.)",
      `  if (${CARVE} >= 0) {`,
      ...shaderOnly('    bool ray = gRay;'),
      ...SAVE.map((l) => '    ' + l),
      '    ' + decl('float', `a = carve(${CARVE}, L, f, ${BASE}, ${CARVE_FACES}, ${NOTHING}, ${js ? 'ray' : 'ray, reach, nrm'})`),
      ...shaderOnly('    gRay = ray;'),
      `    if (${CARVE} == 0) {`,
      `      // (The city's pockets, and how far off the rest are (${FAR}), stop at`,
      '      // the solids without relief: inside one (as the air there is drawn,',
      '      // shrunk with distance) they are no air; near one, a ray they take on',
      '      // strikes it. Asked only where it could matter.)',
      '      ' + decl('float', `c = min(${FAR}, a), bi = -1e9`, true),
      '      ' + decl('ivec3', `W = ${vadd(BASE, 'L')}`),
      '      // (It changes d only where c < d and the point is within -c of a',
      '      // solid (inside one, if c >= 0); a ray, only within BARE_NEAR.)',
      '      // (Asked once: for a ray the pockets took on (pockets), where it strikes',
      '      // one too, from its reach.)',
      '      ' + decl('bool', `pockets = ${READ_REACH} > r0`),
      `      if ((c < d && bareNear(W, f, max(-c, 0.0))) || (pockets && bareNear(W, f, ${num(BARE_NEAR)}))) {`,
      `        ${HAND}`,
      `        bi = bareIn(L, f, ${BASE}, pockets);`,
      '      }',
      '      d = min(d, max(c, bi));',
      `      if (bi${faded(' + gO')} >= 0.0) ${RESTORE}`,
      `      else if (pockets && bi > -${num(BARE_NEAR)}) ${TAKE}`,
      '    }',
      '    else {',
      "      // (With the cell's openings, in d: see reliefCell.)",
      `      d = min(d, min(a${faded(' - gO')}, max(${E}, 0.0)));`,
      ...fade('      gSkin = ray ? reach >= 0.0 : d < 0.0;'),
      '    }',
      '  }',
      '  return d;',
      '}',
    ];
    const text = (lines, names = ['up', 'o']) => (js ? twin.unsigned(twin.arrays(lines.join('\n'), names)) : lines.join('\n'));
    return { relief: text(relief), well: text(well), bareNear: text(bareNear), reliefCell: text(reliefCell, ['m', 'L', 'f']), city: text(city, ['id']), cell: text(cell, ['m', 'L', 'f', 'id']) };
  }
  const CITY_GLSL = cityPieces(false), OPEN_GLSL = openingsPieces(false), TOWN_GLSL = townPieces(false), RELIEF_GLSL = reliefPieces(false), CELL_GLSL = cellPieces(false);

  const glsl = /* glsl */ `
const int G = ${G};
const int NS = ${SOLIDS.length};
const ivec3 SLO[NS] = ivec3[NS](${ivecs(SOLIDS.map((s) => s.lo))});
const ivec3 SHI[NS] = ivec3[NS](${ivecs(SOLIDS.map((s) => s.hi))});
const int NNEAR = ${NEAR_CELLS.length};
const ivec3 NEAR_CELLS[NNEAR] = ivec3[NNEAR](${ivecs(NEAR_CELLS)});
const int NEAR_START[NNEAR + 1] = int[NNEAR + 1](${NEAR_START.join(', ')});
const int NEAR_BLOCKS[${NEAR_BLOCKS.length}] = int[${NEAR_BLOCKS.length}](${NEAR_BLOCKS.join(', ')});
const int NBUILT = ${BUILT_CELLS.length};
const ivec2 BUILT_CELLS[NBUILT] = ivec2[NBUILT](${BUILT_CELLS.map(([a, b]) => `ivec2(${a}, ${b})`).join(', ')});
${CITY_GLSL.offBuilt}
${UNFADED ? `// The city cells that hold anything but the plaza's air (see farAxis), and
// how far out a solid reaches for each unit it is grown (see plaza).
const int NEAR_X0 = ${NEAR_X0}, NEAR_X1 = ${NEAR_X1}, NEAR_Z0 = ${NEAR_Z0}, NEAR_Z1 = ${NEAR_Z1};
const float GROW = ${glf(GROW)};
${CITY_GLSL.farAxis}
` : ''}
const ivec3 VOL_LO = ivec3(${VOLUME.lo.join(', ')});
const ivec3 VOL_SIZE = ivec3(${VOLUME.size.join(', ')});
const ivec3 ORIGIN = ivec3(${ORIGIN.join(', ')});
const int FACE_AT = ${FACE_AT}, OPEN_AT = ${OPEN_AT}, CROSS_AT = ${CROSS_AT};
// (The town: see TOWN in the JS.)
const int TOWN_AT = ${TOWN_AT}, TOWN_CORNER_AT = ${TOWN_CORNER_AT}, TOWN_SHAPES = ${TOWN_SHAPES};
const ivec4 TOWN_LOT[${TOWN_LOT.length}] = ivec4[${TOWN_LOT.length}](${TOWN_LOT.map((r) => `ivec4(${r.join(', ')})`).join(', ')});
const int TOWN_PLAN_AT[${TOWN_PLAN_AT.length}] = int[${TOWN_PLAN_AT.length}](${TOWN_PLAN_AT.join(', ')});
const int TOWN_PICK[${TOWN_PICK.length}] = int[${TOWN_PICK.length}](${TOWN_PICK.join(', ')});
const int TOWN_H = ${TOWN_H};
const uint TOWN_SALT = ${TOWN_SALT}u;
const float TOWN_MARGIN = ${glf(TOWN_MARGIN)};
const uint POCKET_SALT = ${POCKET_SALT}u, ROW_SALT = ${ROW_SALT}u, DEPTH_SALT = ${DEPTH_SALT}u;
// The two levels' pockets (see LEVELS): sb, sby, quant, splits, and the
// least a part may be (LV_MIN, in quanta); and their depths' shares, ND to a
// level.
const int ND = ${ND};
${table('ivec4', 'LV', 2, vrow('ivec4'), RELIEF_ROWS)}
${table('int', 'LV_MIN', 2, String, RELIEF_ROWS)}
${table('float', 'CUM', '2 * ND', glf, RELIEF_ROWS)}
const int NF = ${FACES.length};
// Each face (see FACES and the setup after BARE): n's slant (index, sign),
// K, alpha; its rows' K term (F.yk); nn; its unit normal; its h and t as
// slants (index, sign); its quanta along (q2, a level each) and lo, hi (4 y);
// t; its length; its rows' m's slant (index, sign), gm and p (see faceAt);
// |n| and gm |m|; and the heights it may be cut between (cells).
${table('ivec4', 'FPLANE', 'NF', vrow('ivec4'), RELIEF_ROWS)}
${table('int', 'FNY', 'NF', String, RELIEF_ROWS)}
${table('int', 'FNN', 'NF', String, RELIEF_ROWS)}
${table('vec3', 'FN', 'NF', (r) => `vec3(${r.map(glf).join(', ')})`, RELIEF_ROWS)}
${table('ivec4', 'FHT', 'NF', vrow('ivec4'), RELIEF_ROWS)}
${table('ivec4', 'FQY', 'NF', vrow('ivec4'), RELIEF_ROWS)}
${table('ivec3', 'FT', 'NF', vrow('ivec3'), RELIEF_ROWS)}
${table('float', 'FLEN', 'NF', glf, RELIEF_ROWS)}
${table('ivec4', 'FSL', 'NF', vrow('ivec4'), RELIEF_ROWS)}
// Each face's normal's upright part and the length of its level part, as its
// whole-number n has them (not a unit's: see terraceOf).
${table('vec2', 'FNH', 'NF', (r) => `vec2(${r.map(glf).join(', ')})`, RELIEF_ROWS)}
${table('vec2', 'FNS', 'NF', (r) => `vec2(${r.map(glf).join(', ')})`, RELIEF_ROWS)}
// Each face's two ridges (see F.edges): dl, al, be, and sg (as sg W(DMAX)); and the other face's index.
${table('ivec4', 'FEDGE', 'NF * 2', vrow('ivec4'), RELIEF_ROWS)}
${table('int', 'FEG', 'NF * 2', String, RELIEF_ROWS)}
// W(t) at each ridge of each face (see F.edges), at each level, t twelfths, 0 to 16.
${table('int', 'FWT', 'NF * 68', String, RELIEF_ROWS)}
// Each face's ridges: which (see RIDGES), and the plane of a notch's edge
// there (see F.edges: gl, and gn, its unit normal into the face).
const int NRID = ${RIDGES.length};
${table('int', 'FER', 'NF * 2', String, RELIEF_ROWS)}
${table('float', 'EGL', 'NF * 2', glf, RELIEF_ROWS)}
${table('vec3', 'EGN', 'NF * 2', (r) => `vec3(${r.map(glf).join(', ')})`, RELIEF_ROWS)}
// Each ridge's two faces. Each face's caps (see F.cap, F.ncap: cap, and
// each level's ncap, five bits each), from F.c0, and where they are (offset,
// c0, how many); and each ridge's bare rows (see r.barep), likewise.
${table('int', 'FCAPS', RELIEF_ROWS.FCAPS.length, String, RELIEF_ROWS)}
${table('ivec3', 'FCR', 'NF', vrow('ivec3'), RELIEF_ROWS)}
// The ridges' rows (RIDGE_ROWS in the JS, the table uRidgeRows): from
// RR_FROM, RR_N of them.
const int RR_FROM[2] = int[2](${RR_FROM.join(', ')}), RR_N[2] = int[2](${RR_N.join(', ')});
const int FOUR = ${FOUR.k};
// Each level's depths in twelfths of a cell (see DEPTH12 in the JS).
${table('int', 'DEPTH12', '2 * ND', String, RELIEF_ROWS)}
// Each face's terraces' heights for t twelfths deep, t 0 to 16 (see FTH in the JS).
${table('int', 'FTH', 'NF * 17', String, RELIEF_ROWS)}
const uint TILE_SALT = ${TILE_SALT}u;
const float DMAX = ${glf(DMAX)}, BAND_IN = ${glf(BAND_IN)}, BAND_OUT = ${glf(BAND_OUT)};
// The faces with openings (see WINDOWS): h and t as slants (index, sign); K,
// alpha (w = h . Y < K R / alpha inside); len; and their grids (WGR: the
// first, how many).
const int NW = ${Math.max(WINDOWS.length, 1)};
${table('ivec4', 'WHT', 'NW', vrow('ivec4'))}
${table('ivec2', 'WKA', 'NW', vrow('ivec2'))}
${table('ivec3', 'WH', 'NW', vrow('ivec3'))}
${table('ivec3', 'WT', 'NW', vrow('ivec3'))}
${table('float', 'WLEN', 'NW', glf)}
${table('ivec2', 'WGR', 'NW', vrow('ivec2'))}
// Each grid (see GRIDS): pitch and width along (in u), the openings' depth
// and the channel's (in w); where an opening starts along, the pitch up, its
// height and where a row starts (GUP).
const int NG = ${Math.max(GRIDS.length, 1)};
${table('ivec4', 'GGRID', 'NG', vrow('ivec4'))}
${table('ivec4', 'GUP', 'NG', vrow('ivec4'))}
// (And how it varies, and the sizes it fades at: see GRIDS.)
${table('ivec4', 'GVAR', 'NG', vrow('ivec4'))}
${table('ivec4', 'GVB', 'NG', vrow('ivec4'))}
${table('float', 'GSCALE', 'NG', glf)}
const uint SEGMENT_SALT = ${SEGMENT_SALT}u;
const int WIN_BITS = ${WIN_BITS};
// Each face's mass's bounds, from the building's origin, in cells.
${table('ivec3', 'FLO', 'NF', vrow('ivec3'), RELIEF_ROWS)}
${table('ivec3', 'FHI', 'NF', vrow('ivec3'), RELIEF_ROWS)}
const int NBARE = ${BARE.length};
const ivec3 BARE_LO[NBARE] = ivec3[NBARE](${ivecs(BARE_BOX.map((b) => b[0]))});
const ivec3 BARE_HI[NBARE] = ivec3[NBARE](${ivecs(BARE_BOX.map((b) => b[1]))});
// (Their indices in SOLIDS: see bareIn.)
${table('int', 'BARE_ID', 'NBARE', String)}
// Every solid's planes' unit normals (their offsets exactly, below: see
// planeAt and cityPlaneAt), and where each one's are (first, how many).
${table('vec3', 'SOLID_NRM', OPEN_ROWS.SOLID_NRM.length, (p) => `vec3(${p.map(glf).join(', ')})`)}
${table('ivec2', 'SOLID_AT', SOLIDS.length, vrow('ivec2'))}
// And exactly, one level finer: each plane's n and R K in whole numbers (from
// the building's origin), and one over |n| (see planeAt).
${table('ivec4', 'SOLID_PI', OPEN_ROWS.SOLID_PI.length, vrow('ivec4'))}
${table('float', 'SOLID_INV', OPEN_ROWS.SOLID_INV.length, glf)}
const int SOLID_BITS = ${SOLID_BITS};
// Whose openings cut through each solid inside their own, as bits by solid
// (YIELDS in the JS); everyone else's stop at it.
${table('uint', 'SOLID_YIELDS', SOLIDS.length, (m) => m + 'u')}
// How far clear of each solid others' openings stop (cells: a pillar's
// bearing, say).
${table('float', 'SOLID_KEEP', SOLIDS.length, glf)}
// Each solid's first face with openings (its index in WINDOWS).
${table('int', 'WFIRST', SOLIDS.length, String)}

${CITY_GLSL.middle}
${CITY_GLSL.room}

${CITY_GLSL.table}

${CELL_GLSL.relief}

int fdiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); } // floor, b > 0

${CITY_GLSL.ground}

${RELIEF_GLSL.rect}

${CELL_GLSL.bareNear}
${RELIEF_GLSL.decide}

${RELIEF_GLSL.face}

// The true heights lo..hi (in 4 y at the city's level; in units one level
// finer, and within the cell, or a cell past each side in gCarveOpen; as
// three pieces (gCarveCross), the piece gAxis runs on along that axis only:
// see runOn in the JS. (Set with gCarve, below, and for a plain cell's
// openings: see windowAir.)
uint gCarveOpen;
bool gCarveCross;
int gAxis;
${OPEN_GLSL.cell}
${RELIEF_GLSL.heights}

int lowBit(uint m) { return int(round(log2(float(m & (~m + 1u))))); } // (findLSB, for small m)
// A box facePocket asks after, with the others in one loop (one copy of
// their planes): from u A on sa's side to B on sb's (F's measure), or (e >= 0,
// a notch) from past the ridge to its edge, whose plane is sv away (see
// notchBox); between heights y0 and y1, with its depth plane dn (see depthN),
// bounded a unit past face g (for notches, the other face at the ridge;
// for the pocket, its own); fz: how deep it fades from (see below). Kept in
// separate variables, not arrays: indexed arrays make the compile crawl.
${RELIEF_GLSL.box}
${RELIEF_GLSL.cut}
${RELIEF_GLSL.notch}

${RELIEF_GLSL.pocket}

${RELIEF_GLSL.carve}

${RELIEF_GLSL.cityFaces}

${OPEN_GLSL.windowAir}

${OPEN_GLSL.openings}

${OPEN_GLSL.bare}

// Box k of a lot r of the town, in units over the cell's corner and the
// floor (made from the definition's kinds of building: see town.js, as the
// JS's is).
${townShapeGlsl(def.town.types)}

${TOWN_GLSL.box}

${TOWN_GLSL.air}

${CELL_GLSL.reliefCell}

${CELL_GLSL.well}

${CITY_GLSL.solids}

${CITY_GLSL.plaza}

${CELL_GLSL.city}

${CELL_GLSL.cell}
`;

  // The same, in JavaScript, on the shared pieces (see src/pieces.js): in
  // the same order and choices as the shader's, but not everywhere in the
  // same form (the two agree as the parity checks show, not by
  // construction: see .claude/design/t10-review.md).
  // (The point along the slants, as setPoint last set it: read by the code
  // written below, made into functions, as by the rest.)
  const SL = { Ls: null, Fs: null };

  // The rest of the city's own pieces in JavaScript (see cityPieces), made
  // into functions.
  const NEAR_AT = new Map(NEAR_CELLS.map((c, n) => [c.join(), n]));
  const { plaza, tableAt, groundCell, groundAir, farAxis } = new Function(
    'P', 'SL', 'fromMiddle', 'R', 'M', 'G', 'SLO', 'SHI', 'NEAR_AT', 'NEAR_START', 'NEAR_BLOCKS', 'VOL_LO', 'VOL_SIZE', 'NEAR_X0', 'NEAR_X1', 'NEAR_Z0', 'NEAR_Z1',
    `'use strict';\nconst { S, airPiece, airSpan, solidPiece, solidPlane, solidDone, NONE } = P;\n${twin.AS_GLSL}\n${twin.AS_GLSL_VEC}\nconst min = Math.min, max = Math.max;\n${CITY_JS.solids}\n${CITY_JS.farAxis}\n${CITY_JS.plaza}\n${CITY_JS.table}\n${CITY_JS.ground}\nreturn { plaza, tableAt, groundCell, groundAir${UNFADED ? ', farAxis' : ''} };\n//# sourceURL=cityPieces.gen.js`,
  )(P, SL, fromMiddle, R, M, G, SOLIDS.map((sd) => sd.lo), SOLIDS.map((sd) => sd.hi), NEAR_AT, NEAR_START, NEAR_BLOCKS, VOLUME.lo, VOLUME.size, NEAR_X0, NEAR_X1, NEAR_Z0, NEAR_Z1);

  // The point along the diagonals (the shared pieces', see pieces.at), and
  // along the slants (from dg, or else from L and f).
  function setPoint(L, f, dg) {
    P.at(L, f, dg);
    if (dg?.Ls) (SL.Ls = dg.Ls), (SL.Fs = dg.fs);
    else {
      // (Split again, as levelRay does: a whole number and the rest, at most a half.)
      const fs = SLANTS.map((m) => m[0] * f[0] + m[1] * f[1] + m[2] * f[2]);
      SL.Ls = SLANTS.map((m, k) => m[0] * L[0] + m[1] * L[1] + m[2] * L[2] + Math.round(fs[k]));
      SL.Fs = fs.map((x) => x - Math.round(x));
    }
  }

  // The cell of the table being asked about (see relief and reliefCell):
  // its corner from the building's origin (b); the sides its pockets (or its
  // openings) run on across (open), whether as three pieces (cross), and
  // which of them is being asked about (axis: see runsOn). Read by the code
  // written below, made into functions, as by the rest.
  // (And, as the shader's gCarve and the rest, the pockets asked after once
  // the cell is done: which level's (carve: 0 the city's, 1 the next's, -1
  // none), of which faces, from which corner (base), and the cell's own
  // bound (e). (At the city's level, how far off the other faces are is
  // cityFaces' own, RS.Far.)
  const CELL = { b: [0, 0, 0], open: 0, cross: false, axis: -1, carve: -1, faces: 0, base: [0, 0, 0], e: 0 };

  // (The lowest bit set in m: GLSL's lowBit.)
  const lowBit = (m) => 31 - Math.clz32(m & -m);
  // The openings in JavaScript (see openingsPieces), made into functions.
  const OPEN_JS = openingsPieces(true);
  const { openLo, openHi, openings, bareIn } = new Function(
    'P', 'SL', 'CELL', 'R', 'hashCell', 'fdiv', 'lowBit', 'SEGMENT_SALT', 'WIN_BITS', 'SOLID_BITS', 'NBARE', ...Object.keys(OPEN_ROWS),
    `'use strict';\nconst { S, airPiece, airPlane, airSpan, solidBegin, solidFace, solidPiece, solidPlane, solidDone } = P;\n${twin.AS_GLSL}\nconst min = Math.min, max = Math.max;\n${OPEN_JS.cell}\n${OPEN_JS.windowAir}\n${OPEN_JS.openings}\n${OPEN_JS.bare}\nreturn { openLo, openHi, openings, bareIn };\n//# sourceURL=openingsPieces.gen.js`,
  )(P, SL, CELL, R, hashCell, fdiv, lowBit, SEGMENT_SALT, WIN_BITS, SOLID_BITS, BARE.length, ...Object.values(OPEN_ROWS));
  // The relief's whole-number decisions in JavaScript (see reliefPieces),
  // made into functions, and what the shader keeps in globals (gU0, gRY0 and
  // the rest), RS.
  const RS = { U0: 0, U1: 0, Y0: 0, Y1: 0, Depth: 0, RY0: 0, RY1: 0, RT: 0, RTC: 0, RCY0: 0, RCY1: 0, Pu: 0, Py: 0, PYi: 0, Pni: 0, Pfu: 0, Pfy: 0, PYf: 0, Pnf: 0, Cter: false, Cyin: 0, Cdn: 0, Cyb: 0, Cback: 0, Cap: 0, EdgeBox: { on: false }, Far: 1e9 };
  const RELIEF_JS = reliefPieces(true);
  const { ridgeRow: ridgeRowAt, depthN, carve, cityFaces } = new Function(
    'P', 'RS', 'SL', 'SLANT', 'FOUR', 'openLo', 'openHi', 'CELL', 'lowBit', 'TILE_SALT', 'NF', 'BAND_IN', 'BAND_OUT', 'ORIGIN', 'R', 'hashCell', 'fdiv', 'ND', 'ROW_SALT', 'POCKET_SALT', 'DEPTH_SALT', 'RR_FROM', 'RR_N', 'RR_W', 'RR_DATA', ...Object.keys(RELIEF_ROWS),
    `'use strict';\nconst { S: PS, beyond, h01, airPiece, airPlane, airSpan } = P;\n${twin.AS_GLSL}\n${twin.AS_GLSL_VEC}\nconst min = Math.min, max = Math.max, floor = Math.floor, round = Math.round, sqrt = Math.sqrt, clamp = (x, a, b) => Math.min(Math.max(x, a), b), normalize = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };\n${RELIEF_JS.rect}\n${RELIEF_JS.decide}\n${RELIEF_JS.face}\n${RELIEF_JS.heights}\n${RELIEF_JS.cut}\n${RELIEF_JS.notch}\n${RELIEF_JS.pocket}\n${RELIEF_JS.carve}\n${RELIEF_JS.cityFaces}\nreturn { rectangle, ridgeRow, rectDepth, faceAt, depthN, depthOut, heights, cutOf, notchBox, facePocket, carve, cityFaces };\n//# sourceURL=reliefPieces.gen.js`,
  )(P, RS, SL, SLANTS, FOUR.k, openLo, openHi, CELL, lowBit, TILE_SALT, FACES.length, BAND_IN, BAND_OUT, ORIGIN, R, hashCell, fdiv, ND, ROW_SALT, POCKET_SALT, DEPTH_SALT, RR_FROM, RR_N, RIDGE_ROWS.size[0], RIDGE_ROWS.data, ...Object.values(RELIEF_ROWS));
  // (Every face's shallowest cuts one level finer, 1 to 3 twelfths, at least
  // a whole number of its measure deep: else one would not be cut at all.)
  if (FACES.some((F, k) => [1, 2, 3].some((t) => !(depthN(k, R, [Math.floor(t / 3), t % 3]) > 0)))) throw new Error('arcology: a cut too shallow for its face');
  // (A ridge's row, as the test of the ridges' rows looks it up: see
  // _V2.ridgeRows.)
  const rowOf = (r, lv, y) => (ridgeRowAt(r, lv, y), { y0: RS.RY0, y1: RS.RY1, t: RS.RT, tc: RS.RTC, cy0: RS.RCY0, cy1: RS.RCY1 });

  // The town in JavaScript (see townPieces), made into functions.
  const TOWN_JS = townPieces(true);
  const { townAir } = new Function(
    'P', 'CELL', 'R', 'H2', 'hashCell', 'fdiv', 'townShape', 'TOWN_LOT', 'TOWN_PLAN_AT', 'TOWN_PICK', 'TOWN_H', 'TOWN_SALT', 'TOWN_MARGIN', 'TOWN_SHAPES', 'OPEN_AT', 'TOWN_CORNER_AT',
    `'use strict';\nconst { S, airPiece, airPlane, solidPiece, solidPlane, solidDone } = P;\n${twin.AS_GLSL}\nconst min = Math.min, max = Math.max;\n${TOWN_JS.box}\n${TOWN_JS.air}\nreturn { townAir };\n//# sourceURL=townPieces.gen.js`,
  )(P, CELL, R, Math.SQRT1_2, hashCell, fdiv, townShape, TOWN_LOT, TOWN_PLAN_AT, TOWN_PICK, TOWN_H, TOWN_SALT, TOWN_MARGIN, TOWN_SHAPES, OPEN_AT, TOWN_CORNER_AT);

  // The cell's pieces in JavaScript (see cellPieces), made into functions,
  // the cell of any level (cellAir) among them; the table read as the
  // shader's texelFetch reads its texture.
  const CELL_JS = cellPieces(true);
  const { relief, wellOf, cellAir } = new Function(
    'P', 'SEEN', 'RS', 'setPoint', 'plaza', 'farAxis', 'tableAt', 'groundCell', 'groundAir', 'hallsAir', 'carve', 'cityFaces', 'bareIn', 'openings', 'townAir', 'OPEN_AT', 'CROSS_AT', 'TOWN_AT', 'FACE_AT', 'CELL', 'R', 'M', 'G', 'fromMiddle', 'offBuilt', 'ownOf', 'wrapId', 'built', 'spaceRoom', 'hashCell', 'slabHole', 'slabHalf', 'NBUILT', 'BUILT_CELLS', 'NBARE', 'BARE_LO', 'BARE_HI', 'VOL_LO', 'VOL_SIZE', 'ORIGIN', 'uVolume',
    `'use strict';\nconst { S, airPiece, airPlane, aim, through, NONE } = P;\n${twin.AS_GLSL}\n${twin.AS_GLSL_VEC}\nconst min = Math.min, max = Math.max;\nconst NO_ENTRY = [0, 0, 0, 0];\nconst texelFetch = (t, v) => { if (!t.within(v)) return [0, 0, 0, 0]; const i = t.words * t.at(v); return [t.data[i], t.data[i + 1], t.data[i + 2], t.data[i + 3]]; };\n${CELL_JS.relief}\n${CELL_JS.well}\n${CELL_JS.bareNear}\n${CELL_JS.reliefCell}\n${CELL_JS.city}\n${CELL_JS.cell}\nreturn { relief, wellOf, cellAir };\n//# sourceURL=cellPieces.gen.js`,
  )(P, SEEN, RS, setPoint, plaza, farAxis, tableAt, groundCell, groundAir, hallsAir, carve, cityFaces, bareIn, openings, townAir, OPEN_AT, CROSS_AT, TOWN_AT, FACE_AT, CELL, R, M, G, fromMiddle, offBuilt, ownOf, wrapId, built, spaceRoom, hashCell, slabHole, slabHalf, BUILT_CELLS.length, BUILT_CELLS, BARE.length, BARE_BOX.map((b) => b[0]), BARE_BOX.map((b) => b[1]), VOLUME.lo, VOLUME.size, ORIGIN, VOLUME);

  // Where a first visit starts, in the middle city cell (lattice units): on
  // the plaza, near the building, wherever nothing stands.
  const START = (() => {
    const free = (x, z) => SOLIDS.every((s) => [G, G + 1, G + 2].every((y) => cellOut(s, [x, y, z])));
    for (let r = 0; r < R; r++)
      for (let x = C - r; x <= C + r; x++)
        for (const z of [C - r, C + r]) {
          if (x < 0 || z < 0 || x >= R || z >= R) continue;
          if (free(x, z) && free(x - 1, z) && free(x + 1, z) && free(x, z - 1) && free(x, z + 1)) return [x, z];
        }
    return [C, C];
  })();

  const arcology = {
    name: 'arcology',
    R,
    glsl: hallsGlsl + glsl,
    cellAir,
    // (Its rooms and their openings as the halls', where it lets them be;
    // their walls' half thickness, for finding ways: see planner.js.)
    room: (id, seed, level) => hallsRoom(id, seed, level, spaceRoom),
    openings: (id, seed, level) => hallsOpenings(id, seed, level, spaceRoom),
    halfWall: M,
    volume: VOLUME,
    // What fraction of a surface opens at a level (see the detail asked after
    // in main, shaders.js), by where the surface is, not by the way a ray came
    // to it: the halls' where they are; in the building's own cells, its
    // relief (in its skin cells, this level's pockets, which may open into
    // any surface there: drawn where they open, once sharp, and further off
    // as their average tone) and its openings (in its plain cells, only where the
    // surface is upright, as the faces with them are), in the surface's own
    // shade; elsewhere there, none (and so nothing finer).
    openAreaGlsl: `float openAreaAt(int level, ivec3 id, ivec3 up, vec3 n) {
  gOwnInk = false;
  if (level != ${CITY + 1}) return OPEN_AREA;
  uvec4 m = relief(id, up);
  uint kind = m.x & 3u;
  // (Nothing of this level opens in the ground away from the building (see
  // groundCell), but finer levels do: -1.)
  if (m.x == 0u && groundCell(${ownGlsl('id')}, up)) return -1.0;
  if (m.x == 0u || kind == ${DEEP}u) return OPEN_AREA;
  gOwnInk = true;
  return kind == ${SKIN}u || (m.z != 0u && abs(n.y) < 0.5) ? OPEN_AREA : 0.0;
}`,
    tables: [{ name: 'uRidgeRows', ...RIDGE_ROWS }],
    // The building's planes' normals, carried exactly across levels (see
    // Position.levels): the city's level asks after them for its solids, the
    // next for its pockets.
    slants: SLANTS,
    // A plaza's air reaches up out of its cell, and its longest way runs
    // corner to corner across the cells either side. (Where the plaza does not
    // fade, its pieces are bigger, as its air is: the shader does not hold the
    // open level to these: see openAir.)
    maxInterior: 0.65,
    longestWay: 6,
    // (Where the plaza does not fade, its air is open at every distance:
    // see PLAZA.)
    openAir: UNFADED ? CITY : null,
    close: CLOSE,
    // Roughly what fraction of a surface is openings, where nothing says
    // otherwise (see openAreaGlsl).
    openArea: 0.07,

    // Where a visit starts in its cell: standing in the middle of a room.
    start: STANDING,
    // On the plaza, in the city's row; coarser than that, all is solid, so
    // anywhere does; finer than level 0, as in the halls.
    ancestorDigit(level) {
      if (level > 0) return hallsDigit(level);
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
    // Finer than the city, it is halls, whose ways the tour can plan (and
    // from the plaza, the ways in are ENTRANCES).
    planned: (level) => level > CITY,
    // (The city's levels: the relief's surfaces are not all carried exactly
    // (ledger B49), nor yet are the openings' and the town's (B44).)
    nearOnly: [CITY, CITY + 1],
    // (Only the city's levels are cut by the slants: finer, the halls are
    // all axes and diagonals.)
    slanted: (level) => level <= CITY + 1,
    entrances: { level: CITY + 1, list: ENTRANCES },
    // Nothing stands higher than the building (in level-0 cells).
    skyClear: (ROWS * R - TOP) * Math.pow(R, -1 - CITY),
    // Sunlight comes down into it as far as the plaza (in level-0 cells).
    sunReach: (ROWS * R - G) * Math.pow(R, -1 - CITY),

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
    fogK: 250, // visibility, in cells of the room we are in
  };
  return { arcology, def, VOLUME, _V2 };
}

// The arcology as it is (and its table and parts, for the checks).
const made = makeArcology();
export const { VOLUME, _V2 } = made;
export default made.arcology;
