// Somewhere inside the arcology's building: in the halls of one of its deep
// cells (that of the browser tests' place "inside": the city's cell and the
// building's cell there), where a first visit, out on the plaza, never is.
// The finer digits (levels 0 and 1) and the offset from rnd, tried until
// the flight has room to stand and the room it is in is of the halls (the
// building's great halls, a level finer than the city, or finer still);
// rnd gives numbers in [0, 1). The flight is begun there (see Flight.begin)
// and faces as it did.
export const INSIDE = [[-2, [12, 13, 12]], [-1, [7, 0, 17]]];

export function inside(flight, rnd) {
  const { pos, R } = flight;
  for (let tries = 0; tries < 400; tries++) {
    const digit = () => [0, 1, 2].map(() => Math.floor(rnd() * R));
    Object.assign(pos, { F: 1, frac: [rnd(), rnd(), rnd()], digits: new Map([...INSIDE.map(([j, d]) => [j, d.slice()]), [0, digit()], [1, digit()]]) });
    flight.begin();
    if (flight.clearance >= 0.08 && flight.room !== null && flight.room >= -1) return flight;
  }
  throw new Error('inside: nowhere inside the building with room to stand');
}
