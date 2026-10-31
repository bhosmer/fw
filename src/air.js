// Asking a world, in JavaScript, what the shader's levelAir asks of it: at
// a point near a level's record (see Position.levels), that level's air
// distance (and, for a ray, how far it goes in that air). Nothing here waits
// on the GPU: the flight asks it (Flight.airAt), and through the flight the
// tour, the view and the tests.
import { DIAGONALS } from './position.js';
import { levelSeed, wrapId, slantsCut } from './util.js';
import { fade as fading, NO_FADE } from './pieces.js';

// One level's air distance at the point v from the camera (level-F cells),
// in that level's lattice units. And if ray is given ({ dir }), what the
// world says of a ray from there along dir (see cellAir in worlds.js). Cut
// off at the ground, as far under us as the record says (see
// Position.levels). As the level fades there (fade: { o, a, scale, rate },
// see fade in pieces.js), as the shader draws it; by default, as it is.
// (The fade lasts for this ask alone: at rest the pieces' state is
// unfaded, so that what asks the cells directly asks the world as it is.)
export function airAt(space, rec, v = [0, 0, 0], ray = null, fade = NO_FADE) {
  if (fade === NO_FADE) return asked(space, rec, v, ray, fade);
  fading(fade, ray);
  try {
    return asked(space, rec, v, ray, fade);
  } finally {
    fading(NO_FADE, null);
  }
}
function asked(space, rec, v, ray, fade) {
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
  // And along the space's slants, where they cut its cells (see slantsCut):
  // elsewhere there are none to ask after.
  dg.Ls = slantsCut(space, rec.level) ? [] : null;
  dg.fs = dg.Ls && [];
  if (dg.Ls) (space.slants ?? []).forEach((m, k) => {
    const s = rec.fs[k] + (m[0] * v[0] + m[1] * v[1] + m[2] * v[2]) * rec.sig;
    const r = Math.floor(s + 0.5);
    dg.fs[k] = s - r;
    dg.Ls[k] = rec.Ls[k] + r - (m[0] * cell[0] + m[1] * cell[1] + m[2] * cell[2]) * R;
  });
  // (And the id of the cell's parent: see gUp in shaders.js.)
  const up = rec.pid.map((p, a) => p + Math.floor((rec.id[a] - R * Math.floor(rec.id[a] / R) + cell[a]) / R));
  const a = space.cellAir(L, f, wrapId(id, R), levelSeed(rec.level), dg, rec.level, wrapId(up, R), ray);
  if (!(rec.ground < Infinity)) return a;
  // Under the ground there is only solid, at every level, as levelRay in
  // shaders.js has it (h: how high v is over it, in the level's lattice units).
  // The ground never fades: its distance is less the level's shrinking, which
  // is taken off the whole level again where it fades.
  const h = (v[1] + rec.ground) * rec.sig;
  if (ray && ray.known) {
    if (h < 0) ray.reach = -1;
    else if (ray.reach >= 0 && ray.dir[1] < 0 && h < -ray.reach * ray.dir[1]) {
      ray.reach = h / -ray.dir[1];
      [ray.nx, ray.ny, ray.nz] = [0, 1, 0];
    }
  }
  return Math.max(a, -h - fade.o);
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
