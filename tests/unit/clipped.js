import arcology, { CITY, _V2 } from '../../src/spaces/arcology.js';
import { Flight } from '../../src/flight.js';

// Rays the city's pockets take that the solids without relief stop (see
// the pockets' block in cellAir): found among n from points close by each such solid, toward
// points inside it. As [x, dir]: x in lattice units of the city's level over
// the middle city cell's corner.
export function clippedRays(rnd, n) {
  const R = arcology.R, out = [];
  const flight = new Flight(arcology);
  for (const [blo, bhi] of _V2.BARE_BOX) {
    const [l, h] = [blo, bhi].map((b) => b.map((x, a) => x + _V2.ORIGIN[a]));
    for (let k = 0; k < n; k++) {
      const x = [0, 1, 2].map((a) => (a === 1 ? l[a] + rnd() * (h[a] - l[a]) : l[a] - 3 + rnd() * (h[a] - l[a] + 6)));
      Object.assign(flight.pos, { F: CITY - 1, frac: x.map((v) => (R / 2 + v / R) / R), digits: new Map() });
      const [r] = flight.pos.levels(CITY, CITY);
      const e = [0, 1, 2].map((a) => l[a] + rnd() * (h[a] - l[a]) - x[a]), m = Math.hypot(...e), dir = e.map((v) => v / m);
      const seen = _V2.SEEN.clipped;
      flight.airAt(r, [0, 0, 0], { dir });
      if (_V2.SEEN.clipped > seen) out.push([x, dir]);
    }
  }
  return out;
}
