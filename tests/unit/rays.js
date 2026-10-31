import assert from 'node:assert/strict';
import { airAt } from '../../src/air.js';

// What a level says of a ray from v (cells of level F from the camera) along
// dir must hold: where it says how far the ray goes in its air (known), it
// is in air there just when that is not less than 0; it goes no less far
// than the distance (each plane is at least that far off along any ray);
// all of the way is air at that level, or once past its cell, at a coarser
// one (a piece may run on out of its cell where a coarser level's air is,
// as an opening out of a building does into the city's, or over what stands
// highest, as the plaza's air does into the sky); and the surface it
// meets there faces back along it. And it hands over: just past where it
// ends, either every level is solid (the ray has met a surface truly) or
// some level says the ray goes on through its air (as the shader marches,
// which stops where none does: a level whose way ended short of its
// surface, with nothing to take the ray on, would draw a surface that is
// not there); and each level's distance there says the same, so that the
// hand-over is not taken on the word of the rays alone. Says whether it was
// known, and in air.
// (at: where the point is, for the messages.)
export function rayHolds(flight, r, v, dir, at = '') {
  const R = flight.space.R;
  const ray = { dir };
  const a = flight.airAt(r, v, ray);
  assert.equal(a, flight.airAt(r, v), 'the distance is the same, asked with a ray or not');
  if (!ray.known) return { known: false, inAir: false };
  const where = `level ${r.level} at F ${flight.pos.F}, v ${v}, dir ${dir}${at && `, ${at}`}`;
  assert.equal(ray.reach >= 0, a <= 0, `in air (${a}) but reach ${ray.reach}, ${where}`);
  if (ray.reach < 0) return { known: true, inAir: false };
  assert.ok(ray.reach >= -a - 1e-9, `reach ${ray.reach} less than the distance ${-a}, ${where}`);
  assert.ok(Math.abs(Math.hypot(ray.nx, ray.ny, ray.nz) - 1) < 1e-9 && ray.nx * dir[0] + ray.ny * dir[1] + ray.nz * dir[2] <= 1e-12, `normal ${[ray.nx, ray.ny, ray.nz]}, ${where}`);
  // (Covered by balls of air, each as big as the clearance of the level,
  // or past its cell of the levels no finer and the sky, says: all the way
  // to the end. Each step is at least a millionth of the way, so the walk
  // ends; where a ball is smaller than that, the step goes on unchecked,
  // and those steps together may cover no more than a thousandth of the
  // way.) (Cells of level F.)
  const end = ray.reach / r.sig, least = end * 1e-6;
  const cellOf = (u) => [0, 1, 2].map((a) => Math.floor((r.L[a] + r.f[a] + u[a] * r.sig) / R)).join();
  const home = cellOf(v);
  let t = 0, unchecked = 0;
  for (let n = 0; t < end * (1 - 1e-6); n++) {
    assert.ok(n <= 1e6, `the walk did not end: at ${t} of ${end} after ${n} steps, ${where}`);
    const u = v.map((x, i) => x + dir[i] * t);
    const inHome = cellOf(u) === home, levels = inHome ? [r] : flight.here.filter((q) => q.level <= r.level);
    const b = Math.max(inHome ? -Infinity : flight.sky + u[1], ...levels.map((q) => -flight.airAt(q, u) / q.sig));
    assert.ok(b >= -1e-9 / r.sig, `solid (${-b} cells) at ${t * r.sig} of reach ${ray.reach}, ${where}`);
    if (b < least) unchecked += least - b;
    t += Math.max(b, least);
  }
  assert.ok(unchecked <= 1e-3 * end, `${unchecked / end} of the way stepped over unchecked (balls under a millionth of it), ${where}`);
  // (Just past: a millionth of the way, or of the level's lattice unit,
  // whichever is more; open above the sky's plane, where the shader stops
  // marching. A level that does not answer rays goes on as far as its
  // distance says.)
  const p = v.map((x, i) => x + dir[i] * (end + 1e-6 * Math.max(end, 1 / r.sig)));
  if (flight.sky + p[1] <= 0) {
    const d = flight.here.map((q) => flight.airAt(q, p));
    const on = flight.here.map((q, j) => {
      const next = { dir };
      flight.airAt(q, p, next);
      return next.known ? next.reach : d[j] <= 0 ? -d[j] : -1;
    });
    const said = () => on.map((x, j) => `level ${flight.here[j].level}: ${x} (distance ${d[j]})`).join(', ');
    assert.ok(on.every((x) => x < 0) || on.some((x) => x > 0), `the ray is handed over to none just past its end (${said()}), ${where}`);
    // (And the distances agree: where every level says the ray stops, each
    // is solid there; where one says it goes on, that one is in air.)
    if (on.every((x) => x < 0)) assert.ok(d.every((x) => x > 0), `just past its end the rays say solid, but a distance says air (${said()}), ${where}`);
    else assert.ok(on.every((x, j) => !(x > 0) || d[j] <= 0), `just past its end a level's ray goes on, but its distance says solid (${said()}), ${where}`);
  }
  return { known: true, inAir: true };
}

// And as drawn, faded with distance (fade: { o, a, scale, rate, span }, see
// fadeAt in fade.js): a ray goes only where the level's air is, faded as
// the march would fade it there (its shrinking grown by a, its footprint
// by rate, for each unit of the way; at 31 points along it, as far as the
// fade keeps its pace (span) and within the point's cell); where the level
// fades all alike (uniform: every plane moved in by o, growing by a), no
// less far than its faded distance allows; and it hands over just past its
// end (that air faded further: solid there, or the level's own ray goes on,
// where its distance says air too). And it is in air there just when the
// distance, faded, says so, and the surface it meets faces back along it.
// (A faded level's air is where its distance and its shrinking are not more
// than 0: see levelAir in shaders.js.) Says whether it was known, and in air.
export function fadedRayHolds(flight, r, v, dir, fade, { uniform = false, at = '' } = {}) {
  const { space } = flight, R = space.R, { o, a, scale, rate, span } = fade;
  const ray = { dir }, d = airAt(space, r, v, ray, fade);
  if (!ray.known) return { known: false, inAir: false };
  const where = `level ${r.level} at F ${flight.pos.F}, v ${v}, dir ${dir}, fade ${JSON.stringify(fade)}${at && `, ${at}`}`;
  assert.ok(Object.is(d, airAt(space, r, v, null, fade)), `the distance is the same, asked with a ray or not, ${where}`);
  if (Math.abs(d + o) > 1e-9 * (1 + o)) assert.equal(ray.reach >= 0, d + o <= 0, `faded, in air (${d + o}) but reach ${ray.reach}, ${where}`);
  if (ray.reach < 0) return { known: true, inAir: false };
  assert.ok(Math.abs(Math.hypot(ray.nx, ray.ny, ray.nz) - 1) < 1e-9 && ray.nx * dir[0] + ray.ny * dir[1] + ray.nz * dir[2] <= 1e-12, `faded, normal ${[ray.nx, ray.ny, ray.nz]}, ${where}`);
  if (uniform) assert.ok(ray.reach >= -(d + o) / (1 + a) - 1e-9 * (1 + o), `faded, reach ${ray.reach} less than the faded distance allows (${-(d + o) / (1 + a)}), ${where}`);
  const cellOf = (u) => [0, 1, 2].map((q) => Math.floor((r.L[q] + r.f[q] + u[q] * r.sig) / R)).join(), home = cellOf(v);
  const along = (t) => v.map((x, i) => x + (dir[i] * t) / r.sig);
  const x = Math.min(ray.reach, span);
  for (let k = 1; k < 32; k++) {
    const t = (x * k) / 32, p = along(t);
    if (cellOf(p) !== home) break;
    const ot = o + a * t, dt = airAt(space, r, p, null, { o: ot, a: 0, scale: scale + rate * t, rate: 0 });
    assert.ok(dt + ot <= 1e-9 * (1 + ot), `faded, solid (${dt + ot}) at ${t} of reach ${ray.reach}, ${where}`);
  }
  const e = ray.reach * (1 + 1e-6) + 1e-9, p = along(e);
  if (ray.reach <= span && cellOf(p) === home && flight.sky + p[1] <= 0) {
    const oe = o + a * e, next = { dir }, de = airAt(space, r, p, next, { o: oe, a, scale: scale + rate * e, rate });
    assert.ok(de + oe > 0 || next.reach > 0, `faded, the ray is handed over to nothing just past its end (distance ${de + oe}, reach ${next.reach}), ${where}`);
    assert.ok(!(next.reach > 0) || de + oe <= 1e-9 * (1 + oe), `faded, just past its end the level's ray goes on, but its distance says solid (${de + oe}), ${where}`);
  }
  return { known: true, inAir: true };
}
