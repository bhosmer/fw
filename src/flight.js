// Where we are and how we move: what is around us at every scale (sensing),
// and how far the way ahead is open, each step and the trail of them
// (motion), which go by what sensing finds. Nothing here draws or waits on
// the GPU, so all of it can run anywhere (main.js shows it; the tests fly it
// in Node). What it asks of the world is in air.js; where a visit starts, in
// arrival.js; what of it to draw, in view.js; what the tour asks of it, in
// pilot.js.
import { Position } from './position.js';
import { airAt } from './air.js';
import { define, frozen } from './util.js';

// Levels looked at each frame, relative to the working level F: UP coarser
// ones (so a wall we are pressed against, many scales up, is still known
// about) and DOWN finer ones (as much as a screen can resolve).
export const UP = 12;
export const DOWN = 3;
// Beyond those, this many coarser levels are still asked whether we are in
// their air. We can be: flying at a surface that never happens to open, we
// come closer to it than any drawn level reaches, and it is still that
// level's room we are in. Such a level is not drawn (the numbers it would
// take are beyond the GPU's arithmetic); its surface is, as a plane. And
// held at such a surface, the room can end up further up than FAR: then it
// is the room we know we are in (see room) that is still asked.
const FAR = 60;
// The furthest up from F that a level is asked anything, the room we are in
// included: further, and how big a level is in level-F cells is more than a
// number holds (R^223 is about the most). Somewhere with no air in sight the
// room is looked for up to here.
const DEEPEST = 200;

// F follows our clearance: it is kept above REFINE_BELOW level-(F + 1)
// cells and below COARSEN_ABOVE level-F cells.
const REFINE_BELOW = 0.29;
const COARSEN_ABOVE = 0.5;

// How it flies, as a link may set it (?flight.ease=2: see fromLink in
// worlds.js), at its defaults:
//   speed   open distances a second (see step), the keys held (not the
//           wheel's and drag's moves, which go by the pace alone; nor the
//           tour, which goes at its own speed: see step's carry)
//   ease    seconds over which speeding up is eased (slowing is not; 0:
//           not eased at all)
export const FLIGHT = frozen({ speed: 1, ease: 1 });
// Settings for a flight, from FLIGHT with changes, checked.
export function flightSettings(set) {
  const s = define(FLIGHT, set, 'flight.');
  if (!(Number.isFinite(s.speed) && s.speed > 0)) throw new Error(`definition: flight.speed is a number more than 0, not ${s.speed}`);
  if (!(Number.isFinite(s.ease) && s.ease >= 0)) throw new Error(`definition: flight.ease is a number of seconds, 0 or more, not ${s.ease}`);
  return s;
}

// How far ahead() looks: no further than LOOK times the width of the way,
// or out in the open, SKY_LOOK times how high we are.
const LOOK = 5;
const SKY_LOOK = 2;
const SKY_SEE = 150; // how far we see out in the open, in heights above the ground

const TRAIL_MAX = 200000;
const RAY_STEPS = 4; // the most of a ray's steps in one look ahead (see ahead)

// x moved the fraction w of the way toward y, on a log scale. (In logs, so
// that deep down two numbers far apart do not overflow their ratio; and from
// nothing, or less than a number can say, there is no easing: straight to y.)
const toward = (x, y, w) => (x > 0 ? Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * w) : y);

// Where we are, as an offset from us.
const ORIGIN = Object.freeze([0, 0, 0]);

// The clearance levels give, in level-F cells: the most room any of the
// levels gives, each one's air distance (air(r): what level r says of its
// air, in its own units: see airAt) taken to level-F cells. (finest: only
// the levels no finer than it.)
export function builtClearance(levels, air, finest = Infinity) {
  let most = -Infinity;
  for (const r of levels) if (r.level <= finest) most = Math.max(most, -air(r) / r.sig);
  return most;
}

export const PITCH_MAX = 1.55; // the furthest up or down we can face

export class Flight {
  // settings: how it flies, as a link may set it: changes to FLIGHT.
  constructor(space, settings) {
    this.space = space;
    this.R = space.R;
    this.settings = flightSettings(settings);
    // Which way we face: yaw, turned right from looking along -z; pitch, up
    // from level (turned, no further either way than PITCH_MAX).
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new Position(this.R, space.ancestorDigit, space.start, space.slants ?? []);
    this.here = []; // the levels around us, as sense() last found them
    this.sensed = []; // per level: the clearance it alone gives us
    // Every level around us (see around), as sense() last found them, each
    // with its air distance here (rec, air): what the view is drawn from.
    // The flight senses wherever it moves us (step, retrace, begin), so these
    // are of where we are; a write to pos from outside must sense after it.
    this.airs = [];
    // Whether a sense is due before we move on (see setSpace and sense).
    this.due = false;
    this.sky = -1e30; // how high we are above the ground, or what stands highest on it (level-F cells)
    this.clearance = 0;
    this.scale = 0.25; // smoothed clearance, level-F cells
    this.pace = 0.25; // smoothed open distance the way we are going
    this.fog = 0; // smoothed visibility, level-F cells
    this.fogTarget = 0;
    this.opened = 0; // what ahead() last found
    this.room = null; // the level whose air gives us our clearance, however far up
    // Everywhere we have been, as the moves that got us there, so that it can
    // be flown again in either direction. A move is a displacement in cells
    // of the level it was made at, which stays meaningful however far the
    // working level has since drifted. travelled is how many of the moves we
    // are currently at the end of: rewinding lowers it, and the moves beyond
    // it are the way forward again until we strike out somewhere new.
    this.trail = [];
    this.travelled = 0;
    // What the last step moved us by (delta), in cells of the level it was
    // made at (F: the sense after it may have changed ours).
    this.lastMove = { delta: [0, 0, 0], F: this.pos.F };
  }
  // Be in space from now on (another of the same lattice: a variant of the
  // world we are in), where we are, as we were: nothing is sensed again until
  // we move, so that a flip between two at rest changes the world alone. Only
  // the levels around us are asked again, in space, for the view; the sense
  // is due before the next move. (Where we are, but in its own frame: a cell
  // where the other's default would have put it is where this one's default
  // puts it, as its own link would have it.)
  setSpace(space) {
    if (space.R !== this.R) throw new Error('flight: a space of another lattice');
    const was = this.pos.defaultDigit;
    for (const [j, d] of this.pos.digits) {
      const w = was(j), n = space.ancestorDigit(j);
      if (d.every((x, a) => x === w[a]) && n.some((x, a) => x !== w[a])) this.pos.digits.set(j, n.slice());
    }
    this.space = space;
    this.pos.defaultDigit = space.ancestorDigit;
    this.pos.slants = space.slants ?? [];
    this.airs = this.around().map((rec) => ({ rec, air: this.airAt(rec) }));
    this.due = true;
  }

  // Turn by dyaw and dpitch (radians: right and up).
  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, this.pitch + dpitch));
  }

  // The way we face (fwd), and right and up of it, as if pitched by pitch.
  basis(pitch = this.pitch) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = [sy * cp, sp, -cy * cp];
    const right = [cy, 0, sy];
    const up = [-sy * sp, cp, cy * sp];
    return { fwd, right, up };
  }

  // One level's air distance at the point v from the camera (see airAt in
  // air.js), in the space we are in.
  airAt(rec, v = [0, 0, 0], ray = null) {
    return airAt(this.space, rec, v, ray);
  }

  // How far we are above the ground: the one plane over which there is only
  // sky (see ground in spaces/halls.js). In level-F cells, negative below it.
  // Our height and the plane's are compared digit by digit from the coarsest
  // level at which we have ever been anywhere but the default, so that close
  // to the plane what is left is a small whole number plus our offset in the
  // cell. under: count from this far under the plane instead (level-0 cells,
  // added at level 0 so that it stays whole where it is).
  skyHeight(under = 0) {
    const { pos, space, R } = this;
    const plane = space.skyPlane ?? ((j) => (j < 0 ? space.ancestorDigit(j)[1] : j === 0 ? space.ground : 0));
    let acc = 0;
    for (let j = Math.min(0, pos.F, ...pos.digits.keys()); j <= pos.F; j++) {
      acc = acc * R + pos.digit(j)[1] - plane(j) + (j === 0 ? under : 0);
      // (So far from the plane, finer digits cannot take us across it; and
      // deep down the height in level-F cells would soon be more than a number
      // holds: stop while it is still one.)
      if (Math.abs(acc) > 1e30) return acc > 0 ? 1e30 : -1e30;
    }
    // (Working coarser than level 0, the plane is part of the way up our cell.)
    for (let j = pos.F + 1; j <= 0; j++) acc -= (plane(j) - (j === 0 ? under : 0)) * Math.pow(R, pos.F - j);
    return Math.max(acc + pos.frac[1], -1e30);
  }

  // The clearance at v (an offset from us, in level-F cells): how far from
  // there, at least, nothing is in the way. It is whichever is more of two
  // figures, neither of which ever overstates: what the levels around us
  // say (built: see builtAt, where it is already known), and, over the
  // ground, how high v is above it (or above what stands highest on it:
  // see sky).
  clearanceAt(v, built = this.builtAt(v)) {
    return Math.max(this.sky + v[1], built);
  }

  // The clearance the levels around us give at v, the sky aside (see
  // builtClearance).
  builtAt(v) {
    return builtClearance(this.here, (r) => this.airAt(r, v));
  }

  // How far the way is open in direction dir, in level-F cells. Each stride
  // is the clearance where it starts, so everything up to the distance
  // returned is air. The width is the most clearance met on the way, not the
  // clearance here: that dips wherever one piece of air hands over to the
  // next (a room to its doorway), though nothing there is in the way. The
  // open sky has no width: there, how high we are is how big the space is.
  // Where the strides would stop, what is ahead may be no surface at all but
  // a face two pieces of air only share (a seam: the clearance goes to
  // nothing there, on both sides): so there the levels are asked how far a
  // ray goes in their air, as the shader's march does, and if one takes it
  // further than a stride would, the look goes on from there.
  ahead(dir) {
    const at = (t) => [dir[0] * t, dir[1] * t, dir[2] * t];
    const ray = { dir };
    let t = 0, open = 0, width = 0;
    const far = () => Math.max(LOOK * width, SKY_LOOK * this.sky);
    // (At most 10 strides, and as many again as RAY_STEPS of a ray's: a slant
    // approach can take all ten strides to come up to a seam, and then two of
    // a ray's, onto it and on past it.)
    for (let i = 0, rays = 0; i < 10 + rays && t < far() + 1e-30; i++) {
      const v = at(t);
      const built = this.builtAt(v), c = this.clearanceAt(v, built);
      // (The levels are asked about a ray where the strides would stop, and
      // where they would run out: coming up to a face at a slant, they
      // shrink toward it, but a ray goes straight to it.)
      const stop = !(c > 0.02 * t);
      if (!stop && i < 9 + rays) {
        width = Math.max(width, built);
        open = t += c;
        continue;
      }
      // (Over the ground plane, a ray going up is gone; coming down, it
      // has a clear run to the ground. A level's ray, where it says how
      // far it goes: no less than its distance.)
      const high = this.sky + v[1];
      let e = high > 0 ? (dir[1] >= 0 ? Infinity : high / -dir[1]) : -1, unit = 0;
      if (rays < RAY_STEPS) {
        for (const r of this.here) {
          const a = this.airAt(r, v, ray), x = Math.max(ray.reach, -a) / r.sig;
          if (ray.known && ray.reach >= 0 && x > e) (e = x), (unit = 1 / r.sig);
        }
      }
      if (e > c && rays < RAY_STEPS) {
        if (e === Infinity) return far();
        rays++;
        // (How wide the way is within the stretch so passed: the clearance
        // at its middle, no more than half of it.)
        width = Math.max(width, built, Math.min(this.builtAt(at(t + e / 2)), e / 2));
        open = t += e;
        // (Just past where that piece of air ends, to be in the next: a point
        // on the face two pieces share is in both, but each level says which
        // piece it is in by its own numbers, so the step must show in them
        // (a hundred times their rounding) and in ours; and nothing that
        // stands there is anywhere near as thin (a billionth of the way
        // looked, at most). It is not counted in what is open unless a
        // stride goes on from it.)
        t += Math.min(Math.max(1e-12 * Math.max(t, this.scale), 1e-14 * unit), 1e-9 * Math.max(t, this.scale));
        continue;
      }
      if (stop) break;
      width = Math.max(width, built);
      open = t += c;
    }
    return Math.min(open, far());
  }

  // Whether some level says a ray along dir from here is in its air (where
  // the clearance is nothing: on the surface of some level's air, which
  // may be a face two pieces of air share, with more air beyond).
  goesOn(dir) {
    const ray = { dir };
    return this.here.some((r) => (this.airAt(r, [0, 0, 0], ray), ray.known && ray.reach >= 0));
  }

  // The levels around us, from the coarsest that matters: FAR above those we
  // draw, or the room we are in if that is further (but not past DEEPEST).
  around() {
    const { pos } = this;
    return pos.levels(Math.max(Math.min(pos.F - UP - FAR, this.room ?? Infinity), pos.F - DEEPEST), pos.F + DOWN);
  }

  // Find our clearance, and move the working level to suit it; and what each
  // level around us says of its air here, for the view (airs). Each level is
  // asked once at each working level tried.
  sense() {
    const { pos, R } = this;
    // (What each level has said of its air here, at this pass's F.)
    let asked, stable = false;
    const ask = (r) => {
      if (!asked.has(r.level)) asked.set(r.level, this.airAt(r));
      return asked.get(r.level);
    };
    for (let i = 0; i < 8; i++) {
      asked = new Map();
      const lo = pos.F - UP - FAR;
      this.here = this.around().filter((r) => r.level >= pos.F - UP || ((r.level >= lo || r.level === this.room) && ask(r) < 0));
      this.sensed = this.here.map((r) => ({ level: r.level, air: ask(r), sig: r.sig }));
      // (Over the sky plane, nothing is nearer than what stands highest under
      // it: clearance goes by that, not by the plane.)
      this.sky = this.skyHeight(this.space.skyClear ?? 0);
      // Somewhere with no air in sight at all (a place we were sent to):
      // look further up for the room we are in.
      if (!(this.sky > 0) && !this.sensed.some((s) => s.air < 0)) {
        const far = this.search(lo);
        this.here.unshift(...far);
        this.sensed.unshift(...far.map((r) => ({ level: r.level, air: ask(r), sig: r.sig })));
      }
      // (Finer levels' air can be here too, but it is the most room any
      // level gives us that is the space we are in.)
      let most = 0;
      for (const s of this.sensed) if (-s.air / s.sig > most) (most = -s.air / s.sig), (this.room = s.level);
      this.clearance = this.clearanceAt(ORIGIN, builtClearance(this.sensed, (s) => s.air));
      // (In a room too far up to ask, there is more room than we can say:
      // enough to work our way up toward it.)
      if (!(this.clearance > 0) && this.room !== null && this.room < pos.F - DEEPEST) this.clearance = R * COARSEN_ABOVE;
      let k = 1;
      if (this.clearance > 0 && this.clearance < REFINE_BELOW / R) {
        pos.refine();
        k = R;
      } else if (this.clearance > COARSEN_ABOVE) {
        pos.coarsen();
        k = 1 / R;
      } else {
        stable = true;
        break;
      }
      this.scale *= k;
      this.pace *= k;
      this.fog *= k;
      this.opened *= k;
    }
    // (Every level around us as we now are: at the working level we ended
    // at, and with the room just found. Where the last pass left it changed,
    // what was asked there is of another working level.)
    if (!stable) asked = new Map();
    this.airs = this.around().map((rec) => ({ rec, air: ask(rec) }));
    // (Not yet at the working level that suits where we are, as after a
    // jump of many levels: more of it is due before we move.)
    this.due = !stable;
    // Visibility goes by the space we are in, not by how close we are to its
    // walls: it is a multiple of the cell whose air we are floating in.
    // (Of the spaces that can be drawn: failing any, as far as those go.)
    const fogK = this.space.fogK * R;
    const drawn = this.sensed.filter((s) => s.level >= pos.F - UP);
    const within = drawn.find((s) => s.air < 0);
    let see = within ? fogK / within.sig : drawn.length < this.sensed.length ? fogK / drawn[0].sig : 0;
    // Out in the open, by how high up we are.
    if (this.sky > 0) see = Math.max(see, SKY_SEE * this.sky);
    if (see > 0) this.fogTarget = see;
  }

  // The finest level coarser than lo (and not past DEEPEST) whose
  // air we are in, if any, as a list. (Somewhere none nearer has air, that
  // is the room we are in.)
  search(lo) {
    // (levels() works out from F, so it is asked for everything up to there.)
    const recs = this.pos.levels(this.pos.F - DEEPEST, this.pos.F);
    for (let i = recs.length - 1; i >= 0; i--) if (recs[i].level < lo && this.airAt(recs[i]) < 0) return [recs[i]];
    return [];
  }

  // Start out from wherever pos now is: no trail, nothing still settling.
  // fresh: we came by nothing in particular, so go on along the row of
  // rooms until there is space to stand in. (The pace, as for a way open as
  // far as our clearance: how open it is here, whichever way we go. Not what
  // was carried here from wherever we were, by the senses since.)
  begin(fresh = false) {
    this.trail.length = this.travelled = 0;
    this.room = null;
    this.sense();
    for (let i = 0; fresh && i < 40 && this.clearance < 0.08; i++) {
      this.pos.move([0, 0, 1]);
      this.sense();
    }
    this.scale = Math.max(this.clearance, 1e-3);
    this.pace = this.paced(this.scale);
    this.opened = 0;
    this.fog = this.fogTarget;
  }

  // Ease the things that should not jump: travel speed, and how far we can
  // see. (Until we have been somewhere with air in sight, there is no telling
  // how far we should see, and so nothing to ease toward.)
  settle(dt) {
    this.scale = toward(this.scale, Math.max(this.clearance, 1e-6), 1 - Math.exp(-dt / 0.3));
    if (this.fogTarget > 0) this.fog = toward(this.fog, this.fogTarget, 1 - Math.exp(-dt / 1.0));
  }
  settled() {
    const { clearance, scale, fog, fogTarget } = this;
    return clearance > 0 && Math.abs(scale / clearance - 1) < 1e-3 && (!(fogTarget > 0) || Math.abs(fog / fogTarget - 1) < 1e-3);
  }

  // Go on for dt seconds. wish is a velocity (from the keys) and nudge a
  // displacement (from the mouse), both in paces: how far the way ahead says
  // (see paced). carry is a velocity of its own, in level-F cells a second
  // (the tour's: see Pilot.fly), not paced. Returns how far we went, in
  // level-F cells.
  step(dt, wish, nudge = ORIGIN, carry = ORIGIN) {
    const F = this.pos.F;
    this.lastMove = { delta: [0, 0, 0], F };
    const still = (v) => v.every((x) => x === 0);
    // Standing still with nothing left to settle: there is nothing to do.
    if (still(wish) && still(nudge) && still(carry) && this.settled()) return 0;
    if (this.due) this.sense();
    this.settle(dt);
    const aim = wish.map((x, a) => x * this.settings.speed * dt + nudge[a]);
    // (The carried travel in cells of the level we work at: a sense due
    // just now may have moved it from the one carry was given in.)
    const k = Math.pow(this.R, this.pos.F - F);
    const carried = carry.map((x) => x * dt * k);
    // (Which way: the paced travel, at the pace we are going, and the
    // carried, together.)
    const by = aim.map((x, a) => x * this.pace + carried[a]);
    const size = Math.hypot(...by);
    if (size <= 0) return 0;
    // Speed goes by how far the way ahead is open (see paced), and a step
    // never covers more than half of that, so nothing is ever reached, only
    // approached. Going by what is ahead and not by what is nearest means a
    // doorway or a wall alongside does not slow us, only a wall in front.
    // (Slowing down is immediate; only speeding up is eased, over about a
    // second, and always from the speed we are actually going.) Of all this,
    // the carried travel keeps only the cap: half the way open.
    const way = by.map((x) => x / size);
    // (In air, or on a face two pieces of air share, which is air too.)
    const inAir = this.clearance > 0 || this.goesOn(way);
    const open = (this.opened = inAir ? this.ahead(way) : 0);
    const target = this.paced(open);
    this.pace = toward(this.pace, Math.max(target, 1e-6), 1 - Math.exp(-dt / this.settings.ease));
    this.pace = Math.min(this.pace, Math.max(target, 0.05 * this.scale));
    // (How far: the paced travel at the pace now set, and the carried.)
    const want = Math.hypot(...aim.map((x, a) => x * this.pace + carried[a]));
    const len = inAir ? Math.min(want, 0.5 * open) : want;
    if (len <= 0) return 0;
    const delta = by.map((x) => (x * len) / size);
    this.pos.move(delta);
    this.lastMove = { delta, F: this.pos.F };
    const { trail } = this;
    trail.length = this.travelled;
    trail.push({ delta, F: this.pos.F, dt, yaw: this.yaw, pitch: this.pitch });
    if (trail.length > TRAIL_MAX) trail.splice(0, TRAIL_MAX / 10);
    this.travelled = trail.length;
    // (Sensed where we now are: so the view, and the next step, go by here.)
    this.sense();
    return len;
  }

  // The pace for a way open this far ahead (level-F cells): how far a wish
  // of 1 takes us in a second, before the speed setting (see step). In
  // proportion to how far the way is open.
  paced(open) {
    return open;
  }

  // Fly dt seconds along the trail, backwards (way = -1) or forwards again
  // (way = 1), faster than it was flown (boost times faster again). The view
  // turns to face the way it did then, eased so that it never snaps.
  retrace(dt, way, boost = 1) {
    const { trail, pos, R } = this;
    let budget = dt * 2.5 * boost;
    let len = 0;
    let facing = null;
    if (this.due) this.sense();
    while (budget > 0 && (way < 0 ? this.travelled > 0 : this.travelled < trail.length)) {
      const m = trail[way < 0 ? this.travelled - 1 : this.travelled];
      const k = Math.pow(R, pos.F - m.F);
      pos.move(m.delta.map((x) => way * x * k));
      this.sense();
      this.travelled += way;
      len += Math.hypot(...m.delta) * k;
      facing = m;
      budget -= m.dt;
    }
    facing ??= trail[Math.max(0, Math.min(trail.length - 1, way < 0 ? this.travelled : this.travelled - 1))];
    if (facing) {
      const ease = 1 - Math.exp(-dt / 0.15);
      const turn = Math.atan2(Math.sin(facing.yaw - this.yaw), Math.cos(facing.yaw - this.yaw));
      this.yaw += turn * ease;
      this.pitch += (facing.pitch - this.pitch) * ease;
    }
    this.settle(dt);
    return len;
  }
}
