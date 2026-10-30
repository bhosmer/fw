// What the renderer is to draw, decided from where the flight is and how the
// view is shown: which levels, the outer plane (see outerAir), the camera,
// the view as drawn (makeView) and when it would be drawn differently
// (viewKey). The flight knows where we are and which way we face; this,
// what of it to show.
import { UP } from './flight.js';
import { gradient } from './air.js';
import { SLACK } from './shaders.js';
import { SCHEMES } from './schemes.js';

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
// solid as far as this frame is concerned.
export function visible(flight, maxT, n) {
  const { pos } = flight;
  const all = flight.airs;
  // (Each its own record, near and all: the flight's are left as they are.)
  let recs = all.filter(({ rec }) => rec.level >= pos.F - UP).map(({ rec, air }) => ({ ...rec, near: Math.max(0, (air - SLACK) / rec.sig) }));
  recs = recs.filter((r) => r.near < maxT);
  if (recs.length > n) recs = mostVisible(flight, recs, n);
  return { recs, all };
}

// More levels have air in sight than can be drawn. In order, keep: what is
// right in front of us; the space we are in and the two levels that give its
// far walls their facade and texture; the spaces outside it; then the rest.
function mostVisible(flight, recs, n) {
  const levels = recs.map((r) => r.level);
  const within = (flight.sensed.find((s) => s.air < 0) ?? flight.sensed[0]).level;
  const order = [
    ...levels.filter((l) => l >= flight.pos.F - 1).reverse(),
    within, within + 1, within + 2,
    ...levels.filter((l) => l < within).reverse(),
    ...levels.slice().reverse(),
  ];
  const keep = new Set();
  for (const l of order) if (keep.size < n && levels.includes(l)) keep.add(l);
  return recs.filter((r) => keep.has(r.level));
}

// The air of a level too coarse to draw, as the shader is to see it: the
// plane of its nearest surface. all: the levels around us, each with its
// air here (see visible).
export function outerAir(flight, all) {
  let best = null;
  for (const { rec: r, air } of all) {
    if (r.level >= flight.pos.F - UP) break;
    const dist = -air / r.sig;
    if (dist > 0 && (!best || dist > best.dist)) best = { r, dist };
  }
  if (!best) return null;
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
// compared is shown (the flight is in it).
export function makeView(flight, s) {
  const { pos, space, R } = flight, scheme = SCHEMES[s.scheme];
  const fogLen = flight.fog * scheme.fog;
  const maxT = 4 * Math.max(flight.fog, fogLen);
  const { recs, all } = visible(flight, maxT, N_VIEW);
  const { fwd, right, up } = camera(flight);
  const view = {
    cam: [...right, ...up, -fwd[0], -fwd[1], -fwd[2]],
    tan: FOV_TAN,
    lodH: s.lodH,
    scale: flight.scale,
    fogLen,
    maxT,
    fogK: space.fogK * R * scheme.fog,
    debug: s.debug,
    reference: s.reference,
    taa: !s.snapping,
    // (What fraction of the pixels each way the view is drawn at: see upscale
    // in main.js.)
    upscale: s.snapping ? 1 : s.upscale,
    scheme,
    outer: outerAir(flight, all),
    sky: flight.skyHeight(),
    // (Deep down R^F is Infinity, and none times that no number at all.)
    sunReach: space.sunReach ? space.sunReach * Math.pow(R, pos.F) : 0,
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
  return [pos.F, pos.frac, flight.yaw, flight.pitch, flight.scale.toPrecision(3), flight.fog.toPrecision(3), s.w, s.h, s.lodH, s.upscale, s.debug, s.reference, s.scheme, s.side, own].join();
}
