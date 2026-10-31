// How a level's air fades with distance, worked out on its own: an oracle
// for the twins' fading (.claude/design/test-oracles.md), written from what
// fading is meant to be and sharing no code with them.
//
// A piece of air is the intersection of planes, each given at the point
// asked about as { s, n, o, a }: s the point's distance outside the plane
// (not faded), n its unit normal (out of the piece), and how it fades: the
// plane moves into the piece by o, and by a more for each unit the ray goes.
// A solid standing in the air is given the same way, with n out of the
// solid; it grows as the air shrinks. Lengths are in the level's lattice
// units, as levelRay's are.

// A piece of air: whether the point is in it, faded (every plane's s + o not
// over 0), and if so where a ray along dir leaves it, and the plane it
// leaves by (its n, facing the air). A plane the ray goes away from faster
// than it moves in is never met.
export function airExit(planes, dir) {
  if (!planes.every((p) => p.s + p.o <= 0)) return null;
  let x = Infinity, n = null;
  for (const p of planes) {
    const r = dot(p.n, dir) + p.a;
    if (!(r > 0)) continue;
    const e = Math.max(-(p.s + p.o), 0) / r;
    if (e < x) (x = e), (n = p.n.map((c) => -c));
  }
  return { x, n };
}

// A convex solid the point is outside, faded (grown): where a ray along dir
// goes into it and comes out (in, out; in < out where it is struck at all),
// and the face it goes in by.
export function solidHit(planes, dir) {
  let lo = -Infinity, hi = Infinity, n = null;
  for (const p of planes) {
    const r = dot(p.n, dir) - p.a, c = p.s - p.o;
    if (r < 0) {
      const e = c / -r;
      if (e > lo) (lo = e), (n = p.n);
    } else if (r > 0) hi = Math.min(hi, -c / r);
    else if (c > 0) hi = -Infinity;
  }
  lo = Math.max(lo, 0);
  return { in: lo, out: hi, n, struck: lo < hi };
}

// A union of pieces of air, each with the solids standing in it: whether the
// point is in faded air, and how far a ray goes in it: as far as it goes in
// whichever piece it is in takes it furthest, each piece's way cut short
// where a solid in it is struck first.
export function unionExit(pieces, dir) {
  let best = null;
  for (const { planes, solids = [] } of pieces) {
    const e = airExit(planes, dir);
    if (!e) continue;
    for (const s of solids) {
      const h = solidHit(s, dir);
      if (h.struck && h.in < e.x) (e.x = h.in), (e.n = h.n);
    }
    if (!best || e.x > best.x) best = e;
  }
  return best;
}

// The same for a piece whose fading changes pace along the ray: segments
// [{ t0, t1, at }], each from t0 to t1 along the ray, where at(plane) gives
// the plane's { o, a } at t0. The way out is found segment by segment (a
// plane's s at t0 is its s plus n . dir t0): the first segment in which the
// piece ends, or the point is found outside it.
export function segmentsExit(planes, dir, segments) {
  for (const { t0, t1, at } of segments) {
    const here = planes.map((p) => ({ ...p, s: p.s + dot(p.n, dir) * t0, ...at(p) }));
    const e = airExit(here, dir);
    if (!e) return t0 === segments[0].t0 ? null : { x: t0, n: null };
    if (t0 + e.x <= t1) return { x: t0 + e.x, n: e.n };
  }
  return { x: segments[segments.length - 1].t1, n: null };
}

// The fade the march gives a level at a step (src/shaders.js, march: its
// sizes, and the step's turn), from what the step sees: foot, the
// footprint there (camera units); cell, the level's cell (camera units);
// pix, the footprint's growth per unit of distance; slant, how
// foreshortened the surface is (1 face on); and the world's close (how far,
// as a fraction of a cell, air is shrunk to fade a level out) and R. open:
// the level whose air is open at every distance (it stays, faded fully).
// Null where the level is too small to be asked. Gives gO, gA, gScale and
// gScaleRate as the march sets them, and turn: the distance from the
// camera at which the fade changes pace, past which a step does not go.
export const LOD_LO = 8, LOD_HI = 24, LOD_K = 1 / (1 / LOD_LO - 1 / LOD_HI);
export function marchState({ foot, cell, pix, slant, close, R, open = false }) {
  if ((foot / cell - 1 / LOD_HI) * LOD_K >= 1 && !open) return null;
  let rel = (foot / (slant * cell) - 1 / LOD_HI) * LOD_K;
  if (rel >= 1 && !open) return null;
  if (open) rel = Math.min(rel, 1);
  return {
    gO: close * R * Math.max(rel, 0),
    gA: rel > 0 && !(open && rel >= 1) ? (close * LOD_K * pix) / slant : 0,
    gScale: foot / (slant * cell),
    gScaleRate: pix / (slant * R),
    turn: open && rel >= 1 ? Infinity : (slant * cell) / ((rel > 0 ? LOD_LO : LOD_HI) * pix),
  };
}

// How each plane of the relief (src/spaces/relief.js) is meant to fade, from
// the head of relief.js and .claude/design/relief-cover.md 3.6, given its
// level lv (0 the city's, 1 the next), its fade code (0 none, 1 a back, 2 a
// terrace's floor or ceiling), its fading depth fz, and the march's state:
// at the city's level every plane shrinks uniformly, by gO and growing by gA
// (ledger B43: the code drops the growth); one level finer a back rises by
// fr fz and grows by fg fz, a floor or ceiling only grows, and the rest stay,
// where fr and fg are gO and gA as fractions of a whole fade (close R).
export function reliefFade(lv, code, fz, { gO, gA }, { close, R }) {
  if (lv === 0) return { o: gO, a: gA };
  const fr = gO / (close * R), fg = gA / (close * R);
  return code === 1 ? { o: fr * fz, a: fg * fz } : code === 2 ? { o: 0, a: fg * fz } : { o: 0, a: 0 };
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

// A fade state for level rec as the march would give it where the level is
// faded rel of the way (0 to 1; under 0, not yet, where what fades at its
// own, finer size may have begun to), seen at slant, the footprint growing by pix
// per unit of distance (see marchState), for the world { R, close }: as an
// ask takes it ({ o, a, scale, rate }: see fade in src/pieces.js), and how
// far a ray may go in the level's lattice units before the fade changes
// pace (span: the march's step goes no further).
export const FADE_GRID = [-0.2, 0.05, 0.5, 0.95].flatMap((rel) => [0.6, 1].flatMap((slant) => [2e-3, 5e-3].map((pix) => ({ rel, slant, pix }))));
export function fadeAt(rec, { R, close }, { rel, slant, pix }) {
  const cell = R / rec.sig, foot = (rel / LOD_K + 1 / LOD_HI) * slant * cell;
  const s = marchState({ foot, cell, pix, slant, close, R });
  return { o: s.gO, a: s.gA, scale: s.gScale, rate: s.gScaleRate, span: (s.turn - foot / pix) * rec.sig };
}
