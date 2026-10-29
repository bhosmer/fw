// What the renderer is to draw, decided from where the flight is: which
// levels, and the outer plane (see outerAir). The flight knows where we are;
// this, what of it to show.
import { UP } from './flight.js';
import { gradient } from './air.js';
import { SLACK } from './shaders.js';

// The levels to draw, seen out to maxT, at most n of them, each with how far
// away its nearest air is (near), from where we are now (which may be a step
// on from where the flight last sensed); and all the levels around us, drawn
// or not. A level with no air in sight is solid as far as this frame is
// concerned.
export function visible(flight, maxT, n) {
  const { pos } = flight;
  const all = flight.around();
  let recs = all.filter((r) => r.level >= pos.F - UP);
  for (const r of recs) r.near = Math.max(0, (flight.airAt(r) - SLACK) / r.sig);
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
// plane of its nearest surface. all: the levels around us (see visible).
export function outerAir(flight, all) {
  let best = null;
  for (const r of all) {
    if (r.level >= flight.pos.F - UP) break;
    const dist = -flight.airAt(r) / r.sig;
    if (dist > 0 && (!best || dist > best.dist)) best = { r, dist };
  }
  if (!best) return null;
  const { r, dist } = best;
  const g = gradient((v) => -flight.airAt(r, v), 0.25 * dist);
  const len = Math.hypot(...g);
  if (!(len > 0)) return null;
  return { level: r.level, dist, normal: g.map((x) => x / len) };
}
