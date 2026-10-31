// What the renderer is to draw, decided from where the flight is and how the
// view is shown: which levels (see visible), the outer plane (see outerAir),
// the camera, the view as drawn (makeView) and when it would be drawn
// differently (viewKey). The flight knows where we are and which way we
// face; this, what of it to show.
import { UP, roomier } from './flight.js';
import { zoomed } from './position.js';
import { gradient } from './air.js';
import { SLACK } from './shaders.js';
import { SCHEMES } from './schemes.js';
import { define, frozen, slantsCut } from './util.js';

// The most levels coarser than the one we work at that a level can be and
// still be drawn as it is: in the shader's single precision, a level's
// lattice units per level-F cell (sig, R^(level + 1 - F)) and its cells in
// level-F cells (R / sig) stay numbers, as do the sizes the march works out
// from them, with two levels to spare. (Measured: such a level agrees with
// the JavaScript, in level-F cells, as far as 26 levels up; at 27 it does
// not, and further up sig is no number at all. Ledger B45.)
export const FIT = 24;

// How frames are drawn, as a link may set it (?view.history=depth: see
// fromLink in worlds.js), at its defaults:
//   history  which of the frame before's pixels moving temporal
//            antialiasing keeps (see TAAU_FRAG in frame.js): depth, those
//            that saw about this pixel's own distance; range, those that saw
//            a distance among the samples around it, or the sky where one of
//            them did (steadier far detail in motion, ledger B25; Basil
//            chose it, 2026-10-30: depth is how frames were drawn before)
//   fit      how many levels coarser than the one we work at a level may be
//            and still be drawn as it is (see visible): FIT, the most there
//            are numbers for; fewer only to see that the picture is the same
//            however coarse levels are drawn (coarser than fit, the room we
//            are in is drawn zoomed)
export const VIEW = frozen({ history: 'range', fit: FIT });
// Settings for the view, from VIEW with changes, checked.
export function viewSettings(set) {
  const s = define(VIEW, set, 'view.');
  if (!['depth', 'range'].includes(s.history)) throw new Error(`definition: view.history is depth or range, not ${s.history}`);
  if (!(Number.isInteger(s.fit) && s.fit > UP && s.fit <= FIT)) throw new Error(`definition: view.fit is a whole number of levels more than ${UP} and at most ${FIT}, not ${s.fit}`);
  return s;
}

// Of the levels around us, the most that are drawn.
export const N_VIEW = 12;
// The tan of half the field of view, up and down.
export const FOV_TAN = Math.tan((70 * Math.PI) / 360);

const SHIFT = (25 * Math.PI) / 180; // the most of the pitch that slides the picture rather than tilts it (see camera)

// How the screen maps to rays, facing as the flight does: the ray through
// (x, y) (tan of the half field of view at the screen's edge) goes along
// fwd + x right + y up. As a shift lens: near level the picture plane stays
// upright and slides (fwd is not then square to it), so that what is
// upright stays so; looking further up or down, more and more of the pitch
// tilts it instead, smoothly (the slide never more than SHIFT).
export function camera(flight) {
  const shift = SHIFT * Math.tanh(flight.pitch / SHIFT), { fwd, right, up } = flight.basis(flight.pitch - shift);
  return { fwd: fwd.map((x, a) => x + Math.tan(shift) * up[a]), right, up };
}

// The levels to draw, seen out to maxT, at most n of them, each with how far
// away its nearest air is (near); and all the levels around us, drawn or
// not, each with its air distance here (rec, air). As the flight last sensed
// them, where we are (see Flight.airs). A level with no air in sight is
// solid as far as this frame is concerned. The levels drawn are those the
// flight looks at as a rule (UP coarser than F and finer), and coarser ones
// too, up to fit (see VIEW), where their air is in sight: close to a wall
// that has not opened for many levels, the room it is a wall of. But not
// those the space draws only near F (nearOnly: see worlds.js). And the room
// we are in, if it is coarser still (and not one of those): drawn as a level
// fit up would be, zoomed about the corner of it we are near (see zoomed in
// position.js), which out to reach (level-F cells: no ray goes further, see
// makeView) is the room as it is; so drawn, it holds out to valid, no more
// than reach. (If it holds nowhere, it is not drawn.) Where the room we are
// in is a level not drawn, the outer plane stands in for it (see outerAir).
export function visible(flight, maxT, n, fit = FIT, reach = Infinity) {
  const { pos, space } = flight;
  const all = flight.airs;
  const drawn = (level) => level >= pos.F - UP || (level >= pos.F - fit && !space.nearOnly?.includes(level));
  const zoom = (level) => level < pos.F - fit && level === flight.room && !space.nearOnly?.includes(level);
  let valid = Infinity;
  // (Each its own record, near and all: the flight's are left as they are.)
  let recs = [];
  for (const { rec, air } of all) {
    if (drawn(rec.level)) recs.push({ ...rec, near: Math.max(0, (air - SLACK) / rec.sig) });
    else if (zoom(rec.level) && air < 0) {
      const z = zoomed(rec, space.slants ?? [], Math.pow(flight.R, pos.F - fit - rec.level), reach, { least: -air / rec.sig, slanted: slantsCut(space, rec.level) });
      if (z.valid > 0) (valid = z.valid), recs.push({ ...z.rec, near: 0 });
    }
  }
  recs = recs.filter((r) => r.near < maxT);
  if (recs.length > n) recs = mostVisible(flight, recs, n);
  // (The zoomed room, if drawn: how far it holds.)
  if (!recs.some((r) => zoom(r.level))) valid = Infinity;
  return { recs, all, valid };
}

// More levels have air in sight than can be drawn. In order, keep: what is
// right in front of us; the space we are in (within: the coarsest level whose
// air we are in) and the two levels that give its far walls their facade
// and texture (of those looked at as a rule: a room further up than that,
// its walls those levels and coarser, is a room we are pressed close to the
// walls of, and they its texture); the spaces outside it; then the rest; and
// last of all, a level coarser than those looked at as a rule (UP), which is
// drawn only if there is room left (unless it is the space we are in).
function mostVisible(flight, recs, n) {
  const levels = recs.map((r) => r.level);
  const within = (flight.sensed.find((s) => s.air < 0) ?? flight.sensed[0]).level;
  const first = levels.filter((l) => l >= flight.pos.F - UP || l === within);
  const order = [
    ...first.filter((l) => l >= flight.pos.F - 1).reverse(),
    within, ...[within + 1, within + 2].filter((l) => first.includes(l)),
    ...first.filter((l) => l < within).reverse(),
    ...first.slice().reverse(),
    ...levels.filter((l) => !first.includes(l)).reverse(),
  ];
  const keep = new Set();
  for (const l of order) if (keep.size < n && levels.includes(l)) keep.add(l);
  return recs.filter((r) => keep.has(r.level));
}

// The air of a level coarser than those looked at as a rule (UP) whose air we
// are in, as the shader is to see it where that level is not drawn: the
// plane of its nearest surface. Of such levels, the one that gives us the
// most room (see roomier in flight.js); if it is drawn (one of recs), none.
// A stand-in that keeps one wall of a room and loses the rest, left only
// where the level cannot be drawn (see visible). all and recs: as visible
// gives them.
export function outerAir(flight, all, recs) {
  let best = null;
  for (const { rec: r, air } of all) {
    if (r.level >= flight.pos.F - UP) break;
    const dist = -air / r.sig;
    if (dist > 0 && (!best || roomier(dist, best.dist))) best = { r, dist };
  }
  if (!best || recs.some((r) => r.level === best.r.level)) return null;
  const { r, dist } = best;
  const g = gradient((v) => -flight.airAt(r, v), 0.25 * dist);
  const len = Math.hypot(...g);
  if (!(len > 0)) return null;
  return { level: r.level, dist, normal: g.map((x) => x / len) };
}

// What is to be drawn, from where the flight is and how it is to be shown:
// the levels (recs: see visible) and the view the renderer draws them by.
// s: the canvas's size (w, h) and lodH (see resize in main.js); upscale and
// snapping (drawn at that fraction of the pixels, or, snapping, all of them
// and without antialiasing over time); debug and reference (see fw in
// main.js); scheme, an index into SCHEMES; side, which of two worlds
// compared is shown (the flight is in it); history and fit, the view
// settings (see VIEW: fit FIT if not given).
export function makeView(flight, s) {
  const { pos, space, R } = flight, scheme = SCHEMES[s.scheme], fit = s.fit ?? FIT;
  const fogLen = flight.fog * scheme.fog, fogK = space.fogK * R * scheme.fog;
  const maxT = 4 * Math.max(flight.fog, fogLen);
  // (The furthest any ray goes (see main in shaders.js): maxT, or under the
  // sky's plane as far as four fog lengths (fogDown) and four times how far
  // one sees in the air the dive comes to; and each time it comes into bigger
  // air, as far again as four times how far one sees there (gWideFog), each
  // more than half as much again as the last. Of the levels drawn, none sees
  // further than the coarsest the flight looks at as a rule (see uWide), fog
  // of them.)
  const fog = fogK / Math.pow(R, 1 - UP), reach = Math.max(maxT, 4 * fogLen + 4 * Math.max(fog, fogLen)) + 12 * fog;
  const { recs, all, valid } = visible(flight, maxT, N_VIEW, fit, reach);
  const { fwd, right, up } = camera(flight);
  const view = {
    cam: [...right, ...up, -fwd[0], -fwd[1], -fwd[2]],
    tan: FOV_TAN,
    lodH: s.lodH,
    scale: flight.scale,
    fogLen,
    maxT,
    fogK,
    debug: s.debug,
    reference: s.reference,
    taa: !s.snapping,
    // (What fraction of the pixels each way the view is drawn at: see upscale
    // in main.js.)
    upscale: s.snapping ? 1 : s.upscale,
    scheme,
    history: s.history,
    outer: outerAir(flight, all, recs),
    // (How many of the levels drawn, the first, are coarser than those looked
    // at as a rule (UP): one does not see any further for being in their air,
    // but as far as the flight says, as when they were not drawn (see uWide
    // in shaders.js).)
    wide: recs.filter((r) => r.level < pos.F - UP).length,
    // (How far from the camera what is drawn holds, as a room drawn zoomed
    // does (see visible): no ray goes further. Infinity: as far as any goes.)
    valid,
    sky: flight.skyHeight(),
  };
  return { recs, view };
}

// What makeView's picture is made from, as text: the same unless the picture
// would differ, so that it is drawn again only then (see present in
// main.js). From the same s: where we are and which way we face (of the
// digits, those that are not the world's default: one filled in as a level
// is first asked changes nothing); scale and fog to 3 digits (imperceptible
// settling draws nothing); and the rest of s but snapping (a snapshot is
// drawn regardless).
export function viewKey(flight, s) {
  const { pos } = flight;
  const own = [...pos.digits].filter(([j, d]) => d.some((x, a) => x !== pos.defaultDigit(j)[a])).sort((a, b) => a[0] - b[0]);
  return [pos.F, pos.frac, flight.yaw, flight.pitch, flight.scale.toPrecision(3), flight.fog.toPrecision(3), s.w, s.h, s.lodH, s.upscale, s.debug, s.reference, s.scheme, s.side, s.history, s.fit, own].join();
}
