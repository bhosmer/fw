// The JavaScript twin of the world compared with the shader (fw.check,
// fw.checkRays, fw.compareRays), and a ray marched in it as the shader marches
// (fw.trace), from the console and the tests: each given the app's fw object
// (see main.js) as ctx, for its pos, flight, renderer and fly.
import { UP, DOWN, builtClearance } from './flight.js';

// How far from the camera, in a level's lattice units, the shader and the
// JavaScript are compared.
const CHECK_REACH = 2000;

// Step a ray by the clearance (as the older way of drawing did: see
// refProg), here, where it can be watched: returns each step's position
// along the ray and every level's clearance.
// (We go back to where we were afterwards.)
export function trace(ctx, dir, steps = 60, finest = Infinity) {
  const { pos, flight } = ctx, R = flight.R;
  const was = { F: pos.F, frac: pos.frac.slice(), digits: new Map([...pos.digits].map(([j, d]) => [j, d.slice()])) };
  const log = [];
  let t = 0;
  for (let i = 0; i < steps; i++) {
    flight.sense();
    const unit = Math.pow(R, -pos.F);
    const d = builtClearance(flight.sensed, (s) => s.air, finest);
    log.push({ t, d: d * unit, levels: flight.sensed.filter((s) => s.level >= -1 && s.level <= finest).map((s) => [s.level, s.air]) });
    if (d <= 0) break;
    pos.move(dir.map((x) => x * 0.9 * d));
    t += 0.9 * d * unit;
  }
  Object.assign(pos, was);
  flight.sense();
  return log;
}
// A ray from where the flight is along dir, through the air of the levels
// recs (by default every level around us: the world as it is), each asked
// how far the ray goes in its air, exactly and unfaded, and stepped as the
// shader's march steps it: to the furthest way out any of them gives, and on
// from just past it. And, if given, through outer: a half-space of air
// ({ normal, dist }, as the view's outer plane: see outerAir in view.js).
// Over the sky's plane a ray going up is gone, and one coming down has a
// clear run down to it. No further than far; a level whose cells are less
// than a ten-millionth of the way gone is left out (past its numbers there,
// and too small to matter). Returns how far the ray went (t), and whether it
// met a surface there (hit). In level-F cells.
export function rayThrough(flight, dir, far, recs = flight.airs.map((a) => a.rec), outer = null) {
  const R = flight.R, ray = { dir };
  let t = 0;
  for (let k = 0; k < 400; k++) {
    const v = dir.map((x) => x * t);
    let best = -1;
    if (outer) {
      const above = outer.normal.reduce((s, n, a) => s + n * v[a], 0) + outer.dist;
      const fall = -outer.normal.reduce((s, n, a) => s + n * dir[a], 0);
      if (above > 0) best = fall > 0 ? above / fall : Infinity;
    }
    const high = flight.sky + v[1];
    if (high > 0) {
      if (dir[1] >= 0) return { t: Infinity, hit: false };
      best = Math.max(best, high / -dir[1]);
    }
    for (const r of recs) {
      if (R / r.sig < 1e-7 * t) continue;
      flight.airAt(r, v, ray);
      if (ray.known && ray.reach >= 0) best = Math.max(best, ray.reach / r.sig);
    }
    if (best < 0) return { t, hit: true };
    t += best + 1e-9 * t + 1e-12;
    if (t > far) return { t: far, hit: false };
  }
  return { t, hit: true };
}

// Compare the JavaScript cell function with the shader's along a random
// flight, at the camera and at points round it out to a few cells away
// (where cells, diagonals and slants are found from the camera's): returns
// the worst disagreement found, in lattice units (and of those, the worst
// where the JavaScript says there is more air than the shader: more
// than there is, for the flight), and how many comparisons away from the
// camera were made.
export function check(ctx, n = 300, round = 15) {
  const { pos, flight, renderer } = ctx;
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let worst = { diff: 0 }, more = { diff: 0 }, compared = 0;
  for (let i = 0; i < n; i++) {
    if (i % 10 === 0) (flight.yaw = rnd() * 6.28), (flight.pitch = (rnd() - 0.5) * 2.4);
    ctx.fly(0.05 + rnd() * 0.4, { f: 1 });
    const recs = pos.levels(pos.F - UP, pos.F + DOWN);
    const points = [[0, 0, 0]];
    for (let k = 0; k < round; k++) {
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], r = Math.pow(10, -3 + 4 * rnd()) / Math.hypot(...d);
      points.push(d.map((x) => x * r));
    }
    renderer.probe(recs, points).forEach((gpu, k) => recs.forEach((r, j) => {
      // (Only where the shader's numbers can tell: a level's lattice units
      // from the camera in single precision, no further than its cells
      // can be seen anyway.)
      if (Math.max(...points[k].map(Math.abs)) * r.sig > CHECK_REACH) return;
      compared += k > 0;
      const cpu = flight.airAt(r, points[k]);
      const diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
      if (diff <= worst.diff && !(cpu < gpu[j] && diff > more.diff)) return;
      const found = { diff, level: r.level, v: points[k], cpu, gpu: gpu[j], at: { F: pos.F, frac: pos.frac.slice(), digits: [...pos.digits].map(([j, d]) => [j, d.slice()]) } };
      if (diff > worst.diff) worst = found;
      if (cpu < gpu[j] && diff > more.diff) more = found;
    }));
  }
  return { ...worst, more, compared };
}
// The same for rays, where the JavaScript answers them (see cellAir in
// worlds.js): along random directions, the axes and diagonals, from
// the camera and points round it, how far each level says a ray goes in
// its air and the surface it meets. The worst disagreement in reach, as a
// multiple of what single precision can tell there (more along a ray
// that grazes the surface); how many disagree about whether the point is
// in air at all (apart), or about the surface; and how many were compared,
// and of those, how many in air, by level.
export function checkRays(ctx, n = 150, round = 15) {
  const { pos, flight } = ctx;
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const AXES = [[1, 0, 0], [0, -1, 0], [0, 0, 1], [Math.SQRT1_2, Math.SQRT1_2, 0], [0, -Math.SQRT1_2, -Math.SQRT1_2]];
  const sum = { ratio: 0, apart: 0, facing: 0, compared: 0, inAir: {} };
  for (let i = 0; i < n; i++) {
    if (i % 10 === 0) (flight.yaw = rnd() * 6.28), (flight.pitch = (rnd() - 0.5) * 2.4);
    ctx.fly(0.05 + rnd() * 0.4, { f: 1 });
    const e = i % 3 === 0 ? AXES[(i / 3) % AXES.length] : [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const points = [[0, 0, 0]];
    for (let k = 0; k < round; k++) {
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], r = Math.pow(10, -3 + 4 * rnd()) / Math.hypot(...d);
      points.push(d.map((x) => x * r));
    }
    compareRays(ctx, pos.levels(pos.F - UP, pos.F + DOWN), points, e.map((x) => x / Math.hypot(...e)), sum);
  }
  return sum;
}
// (The comparing, for the levels recs at points round the camera along
// dir, added into sum. Not on a surface, nor where nudging the point by
// what single precision cannot tell changes the answer: there the two
// may rightly choose differently. A nudge of tol along each axis moves a
// ray's end on a plane by tol root 3 at most, along its normal (reach times
// slant); more than twice tol is a jump, not that: at tol itself a plane
// square to an axis would be a tie, decided by rounding.)
export function compareRays(ctx, recs, points, dir, sum) {
  const { pos, flight, renderer } = ctx, R = flight.R;
  renderer.probe(recs, points, dir).forEach((gpus, k) => recs.forEach((r, j) => {
    const far = Math.max(...points[k].map(Math.abs)) * r.sig;
    if (far > CHECK_REACH) return;
    const tol = Math.max(1e-5, 1e-6 * (far + R));
    const ray = { dir };
    const a = flight.airAt(r, points[k], ray), gpu = gpus[j];
    if (!ray.known || Math.abs(a) < tol) return;
    const nudge = (s) => {
      const q = { dir };
      flight.airAt(r, points[k].map((x) => x + (s * tol) / r.sig), q);
      return q.reach;
    };
    const slant = Math.max(Math.abs(dir[0] * ray.nx + dir[1] * ray.ny + dir[2] * ray.nz), 1e-3);
    if ([nudge(1), nudge(-1)].some((x) => Math.abs(x - ray.reach) * slant > 2 * tol)) return;
    sum.compared++;
    if (ray.reach >= 0 !== gpu.reach >= 0) return void sum.apart++;
    if (ray.reach < 0) return;
    sum.inAir[r.level] = (sum.inAir[r.level] ?? 0) + 1;
    // (Where the ray lands is as far off as the point and its reach: single
    // precision tells it no finer there. Far out in air open at every
    // distance, a reach is hundreds of cells.)
    const ratio = (Math.abs(ray.reach - gpu.reach) * slant) / Math.max(tol, 1e-6 * (far + Math.abs(ray.reach) + R));
    if (ratio > sum.ratio) Object.assign(sum, { ratio, level: r.level, F: pos.F, v: points[k], dir, cpu: ray.reach, gpu: gpu.reach });
    if (ratio < 1 && Math.hypot(ray.nx - gpu.n[0], ray.ny - gpu.n[1], ray.nz - gpu.n[2]) > 1e-3) sum.facing++;
  }));
  return sum;
}
