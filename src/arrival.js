// Where a visit starts: somewhere new in a world (see Flight.begin for
// starting from wherever the flight now is, as a link does).

// Start somewhere new: a first visit is somewhere different each time, in
// the same world. Across, not up or down (which would take us out of the
// storey under the ground, or into the sky): our cell and its parent are
// anywhere in theirs. rand() gives numbers in [0, 1).
export function elsewhere(flight, rand) {
  const { pos, R } = flight;
  const reset = () => {
    pos.F = 0;
    pos.digits.clear();
    pos.frac = flight.space.start.slice();
  };
  // (Somewhere with room as it is, each try, working no coarser than the
  // digits picked: walking on from somewhere without, as begin(true) does,
  // or working at a scale they no longer tell apart, would bring many tries
  // to the same place.)
  const picked = [-1, 0];
  for (let tries = 0; tries < 40; tries++) {
    reset();
    for (const j of picked) {
      const d = pos.digit(j);
      d[0] = Math.floor(rand() * R);
      d[2] = Math.floor(rand() * R);
    }
    flight.begin();
    if (pos.F >= picked[0] && flight.clearance >= 0.08) return faceOpen(flight);
  }
  // (Failing that, where a first visit always began.)
  reset();
  flight.begin(true);
}

// Turn level, to whichever of the four ways along the walls is open
// furthest. (Not the diagonals: in a closed room, the furthest of all is
// into a corner.)
export function faceOpen(flight) {
  let best = -1;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const open = flight.ahead([Math.sin(yaw), 0, -Math.cos(yaw)]);
    if (open > best) (best = open), (flight.controls.yaw = yaw);
  }
  flight.controls.pitch = 0;
}
