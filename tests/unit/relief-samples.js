// The points the relief's checks ask about (see relief.test.js): seeded, so
// that every run asks the same; over the skin's cells (the table's cells
// with faces' pockets in them), at the city's level and one finer, in turn:
// { lv, X }, X in units one level finer from the building's origin.
import { rand } from './rand.js';

export function reliefSamples(VOLUME, ORIGIN, SKIN, R, n = 30000) {
  const vlo = VOLUME.lo.map((x, a) => x - ORIGIN[a]), vsz = VOLUME.size, skin = [];
  for (let z = 0; z < vsz[2]; z++) for (let y = 0; y < vsz[1]; y++) for (let x = 0; x < vsz[0]; x++) if (VOLUME.kind[VOLUME.at([x, y, z])] === SKIN) skin.push([x + vlo[0], y + vlo[1], z + vlo[2]]);
  const rnd = rand(5), out = [];
  for (let i = 0; i < n; i++) {
    const c = skin[Math.floor(rnd() * skin.length)];
    out.push({ lv: 1, X: c.map((x) => (x + rnd()) * R) });
    out.push({ lv: 0, X: c.map((x) => (x + rnd()) * R) });
  }
  return out;
}
