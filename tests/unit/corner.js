// Somewhere too close to a room's walls for its level to be among those drawn
// as a rule (more than UP levels coarser than where we work: see visible in
// view.js): from inside the building's halls (see inside), straight up to the
// ceiling of the room we are in, or into one of its corners, until the room
// is gap levels up. into: 'ceiling', 'edge' (where the floor meets a wall) or
// 'corner' (two walls and the floor). Each step aims afresh at what is left
// of the way there, from what the room's own level says of rays along the
// axes, so that the corner is found however deep we are (as one flying there
// would, steering by eye). Returns the flight, the room's level, and how far
// off (level-F cells) each of the walls aimed at is; or null if the room
// opened on the way (another level's air took us in).
import { inside } from './inside.js';
import { rand } from './rand.js';

export function into(flight, { seed = 1, gap = 13, to = 'corner' } = {}) {
  inside(flight, rand(seed));
  const room = flight.room, sx = seed % 2 ? 1 : -1, sz = seed % 3 ? 1 : -1;
  const axes = { ceiling: [[0, 1, 0]], edge: [[sx, 0, 0], [0, -1, 0]], corner: [[sx, 0, 0], [0, -1, 0], [0, 0, sz]] }[to];
  const wall = (e) => {
    const rec = flight.airs.find((a) => a.rec.level === room)?.rec, ray = { dir: e };
    if (!rec) return NaN;
    flight.airAt(rec, [0, 0, 0], ray);
    return ray.known && ray.reach >= 0 ? ray.reach / rec.sig : NaN;
  };
  for (let i = 0; i < 4000 && flight.pos.F - room < gap; i++) {
    const off = axes.map(wall);
    if (!off.every(Number.isFinite) || flight.room !== room) return null;
    const aim = [0, 1, 2].map((a) => axes.reduce((s, e, k) => s + e[a] * off[k], 0)), l = Math.hypot(...aim);
    flight.step(0.1, aim.map((x) => (8 * x) / l));
    flight.sense();
  }
  if (flight.room !== room || flight.pos.F - room < gap) return null;
  return { flight, room, off: axes.map(wall) };
}
