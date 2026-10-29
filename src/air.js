// Asking a world, in JavaScript, what the shader's levelAir asks of it: at
// a point near a level's record (see Position.levels), that level's air
// distance (and, for a ray, how far it goes in that air). Nothing here waits
// on the GPU: the flight asks it (Flight.airAt), and through the flight the
// tour, the view and the tests.
import { DIAGONALS } from './position.js';
import { levelSeed, wrapId } from './util.js';

// One level's air distance at the point v from the camera (level-F cells),
// in that level's lattice units. And if ray is given ({ dir }), what the
// world says of a ray from there along dir (see hallsAir in spaces/halls.js).
export function airAt(space, rec, v = [0, 0, 0], ray = null) {
  if (ray) ray.known = false; // (a world that does not say, does not know)
  const R = space.R;
  const L = [0, 0, 0], f = [0, 0, 0], id = [0, 0, 0], cell = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const s = rec.f[a] + v[a] * rec.sig;
    const r = Math.floor(s + 0.5);
    f[a] = s - r;
    const I = rec.L[a] + r;
    // A point on a cell boundary belongs to the cell it is just inside.
    const c = Math.floor((I - (f[a] < 0 ? 1 : 0) + 0.5) / R);
    L[a] = I - c * R;
    id[a] = rec.id[a] + c;
    cell[a] = c;
  }
  // The same along the diagonals (see Position.levels).
  const dg = { Lp: [0, 0, 0], fp: [0, 0, 0], Lm: [0, 0, 0], fm: [0, 0, 0] };
  DIAGONALS.forEach(([a, b], p) => {
    const sp = rec.fp[p] + (v[a] + v[b]) * rec.sig, sm = rec.fm[p] + (v[a] - v[b]) * rec.sig;
    const rp = Math.floor(sp + 0.5), rm = Math.floor(sm + 0.5);
    dg.fp[p] = sp - rp;
    dg.fm[p] = sm - rm;
    dg.Lp[p] = rec.Lp[p] + rp - (cell[a] + cell[b]) * R;
    dg.Lm[p] = rec.Lm[p] + rm - (cell[a] - cell[b]) * R;
  });
  // And along the space's slants.
  dg.Ls = [];
  dg.fs = [];
  (space.slants ?? []).forEach((m, k) => {
    const s = rec.fs[k] + (m[0] * v[0] + m[1] * v[1] + m[2] * v[2]) * rec.sig;
    const r = Math.floor(s + 0.5);
    dg.fs[k] = s - r;
    dg.Ls[k] = rec.Ls[k] + r - (m[0] * cell[0] + m[1] * cell[1] + m[2] * cell[2]) * R;
  });
  // (And the id of the cell's parent: see gUp in shaders.js.)
  const up = rec.pid.map((p, a) => p + Math.floor((rec.id[a] - R * Math.floor(rec.id[a] / R) + cell[a]) / R));
  return space.cellAir(L, f, wrapId(id, R), levelSeed(rec.level), dg, rec.level, wrapId(up, R), ray);
}

// How f changes about the camera, along each axis: f h either way, the
// difference (as a vector, not divided by 2h: those who ask want its way).
export function gradient(f, h) {
  return [0, 1, 2].map((a) => {
    const v = [0, 0, 0];
    v[a] = h;
    const up = f(v);
    v[a] = -h;
    return up - f(v);
  });
}
