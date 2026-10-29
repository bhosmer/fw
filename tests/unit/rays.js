import assert from 'node:assert/strict';

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
// not there). Says whether it was known, and in air.
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
  // or past its cell of the levels no finer and the sky, says.)
  const end = ray.reach / r.sig;
  const cellOf = (u) => [0, 1, 2].map((a) => Math.floor((r.L[a] + r.f[a] + u[a] * r.sig) / R)).join();
  const home = cellOf(v);
  for (let t = 0, n = 0; t < end * (1 - 1e-6) && n < 4000; n++) {
    const u = v.map((x, i) => x + dir[i] * t);
    const inHome = cellOf(u) === home, levels = inHome ? [r] : flight.here.filter((q) => q.level <= r.level);
    const b = Math.max(inHome ? -Infinity : flight.sky + u[1], ...levels.map((q) => -flight.airAt(q, u) / q.sig));
    assert.ok(b >= -1e-9 / r.sig, `solid (${-b} cells) at ${t * r.sig} of reach ${ray.reach}, ${where}`);
    t += Math.max(b, end * 1e-6);
  }
  // (Just past: a millionth of the way, or of the level's lattice unit,
  // whichever is more; open above the ground, where the shader stops
  // marching. A level that does not answer rays goes on as far as its
  // distance says.)
  const p = v.map((x, i) => x + dir[i] * (end + 1e-6 * Math.max(end, 1 / r.sig)));
  if (flight.sky + p[1] <= 0) {
    const on = flight.here.map((q) => {
      const next = { dir }, b = flight.airAt(q, p, next);
      return next.known ? next.reach : b <= 0 ? -b : -1;
    });
    assert.ok(on.every((x) => x < 0) || on.some((x) => x > 0), `the ray is handed over to none just past its end (${on.map((x, j) => `level ${flight.here[j].level}: ${x}`).join(', ')}), ${where}`);
  }
  return { known: true, inAir: true };
}
