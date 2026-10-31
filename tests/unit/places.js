import { Flight } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';
import { inside } from './inside.js';

// Places in a world, for the tests that ask what the world is there: first
// visits (out on the plaza), or (within) places inside the building, in its
// halls; and where short flights from them lead.
export function places(space, seed, n = 8, within = false) {
  const rnd = rand(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    let flight = new Flight(space);
    if (within) inside(flight, rnd);
    else elsewhere(flight, rnd);
    for (let k = 0; k < 4; k++) {
      flight.sense();
      out.push(flight);
      const next = new Flight(space);
      Object.assign(next.pos, { F: flight.pos.F, frac: flight.pos.frac.slice(), digits: new Map([...flight.pos.digits].map(([j, d]) => [j, d.slice()])) });
      next.begin();
      const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      for (let s = 0; s < 40; s++) next.step(1 / 30, dir.map((x) => x * 4));
      flight = next;
    }
  }
  return out;
}
