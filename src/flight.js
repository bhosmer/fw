// Where we are and how we move: what is around us at every scale, how far
// the way ahead is open, each step and the trail of them. Nothing here draws
// or waits on the GPU, so all of it can run anywhere (main.js shows it; the
// tests fly it in Node).
import { Position, DIAGONALS } from './position.js';
import { levelSeed, wrapId } from './util.js';
import { SLACK } from './shaders.js';

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
// How many levels coarser than the room we are in to look for a way out.
const OUT = 4;

// F follows our clearance: it is kept above REFINE_BELOW level-(F + 1)
// cells and below COARSEN_ABOVE level-F cells.
const REFINE_BELOW = 0.29;
const COARSEN_ABOVE = 0.5;

const SPEED = 1.0; // open distances per second (see step)

// How far ahead() looks: no further than LOOK times the width of the way,
// or out in the open, SKY_LOOK times how high we are.
const LOOK = 5;
const SKY_LOOK = 2;
const SKY_SEE = 150; // how far we see out in the open, in heights above the ground

const TRAIL_MAX = 200000;

// x moved the fraction w of the way toward y, on a log scale. (In logs, so
// that deep down two numbers far apart do not overflow their ratio; and from
// nothing, or less than a number can say, there is no easing: straight to y.)
const toward = (x, y, w) => (x > 0 ? Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * w) : y);

export class Flight {
  // controls: which way we face (yaw, pitch), and how much faster than usual
  // to go (boost()).
  constructor(space, controls) {
    this.space = space;
    this.R = space.R;
    this.controls = controls;
    this.pos = new Position(this.R, space.ancestorDigit, space.start, space.slants ?? []);
    this.here = []; // the levels around us, as sense() last found them
    this.sensed = []; // per level: the clearance it alone gives us
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
    this.lastMove = [0, 0, 0]; // what the last step moved us by, in level-F cells
  }

  // One level's air distance at the point v from the camera, in level-F
  // cells (what levelAir in shaders.js gives), worked out here so that
  // nothing waits on the GPU.
  airAt(rec, v = [0, 0, 0]) {
    const R = this.R;
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
    (this.space.slants ?? []).forEach((m, k) => {
      const s = rec.fs[k] + (m[0] * v[0] + m[1] * v[1] + m[2] * v[2]) * rec.sig;
      const r = Math.floor(s + 0.5);
      dg.fs[k] = s - r;
      dg.Ls[k] = rec.Ls[k] + r - (m[0] * cell[0] + m[1] * cell[1] + m[2] * cell[2]) * R;
    });
    // (And the id of the cell's parent: see gUp in shaders.js.)
    const up = rec.pid.map((p, a) => p + Math.floor((rec.id[a] - R * Math.floor(rec.id[a] / R) + cell[a]) / R));
    return this.space.cellAir(L, f, wrapId(id, R), levelSeed(rec.level), dg, rec.level, wrapId(up, R));
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

  // How far the way is open in direction dir, in level-F cells. Each stride
  // is the clearance where it starts, so everything up to the distance
  // returned is air. The width is the most clearance met on the way, not the
  // clearance here: that dips wherever one piece of air hands over to the
  // next (a room to its doorway), though nothing there is in the way. The
  // open sky has no width: there, how high we are is how big the space is.
  ahead(dir) {
    let t = 0, width = 0;
    const far = () => Math.max(LOOK * width, SKY_LOOK * this.sky);
    for (let i = 0; i < 10 && t < far() + 1e-30; i++) {
      const v = dir.map((x) => x * t);
      const built = Math.max(...this.here.map((r) => -this.airAt(r, v) / r.sig));
      const c = Math.max(this.sky + v[1], built);
      if (c <= 0.02 * t) break;
      width = Math.max(width, built);
      t += c;
    }
    return Math.min(t, far());
  }

  // The way directly away from the nearest built surface (for the tour). Out
  // in the open, none: there is nothing to keep off.
  awayFrom() {
    if (!(this.clearance > this.sky)) return [0, 0, 0];
    const h = 0.25 * this.clearance;
    const at = (v) => Math.max(this.sky + v[1], ...this.here.map((r) => -this.airAt(r, v) / r.sig));
    const g = [0, 1, 2].map((a) => {
      const v = [0, 0, 0];
      v[a] = h;
      const up = at(v);
      v[a] = -h;
      return up - at(v);
    });
    const l = Math.hypot(...g);
    return l > 0 ? g.map((x) => x / l) : [0, 0, 0];
  }

  // The levels around us, from the coarsest that matters: FAR above those we
  // draw, or the room we are in if that is further (but not past DEEPEST).
  around() {
    const { pos } = this;
    return pos.levels(Math.max(Math.min(pos.F - UP - FAR, this.room ?? Infinity), pos.F - DEEPEST), pos.F + DOWN);
  }

  // Find our clearance, and move the working level to suit it.
  sense() {
    const { pos, R } = this;
    for (let i = 0; i < 8; i++) {
      const lo = pos.F - UP - FAR;
      this.here = this.around().filter((r) => r.level >= pos.F - UP || ((r.level >= lo || r.level === this.room) && this.airAt(r) < 0));
      this.sensed = this.here.map((r) => ({ level: r.level, air: this.airAt(r), sig: r.sig }));
      // (Over the sky plane, nothing is nearer than what stands highest under
      // it: clearance goes by that, not by the plane.)
      this.sky = this.skyHeight(this.space.skyClear ?? 0);
      // Somewhere with no air in sight at all (a place we were sent to):
      // look further up for the room we are in.
      if (!(this.sky > 0) && !this.sensed.some((s) => s.air < 0)) {
        const far = this.search(lo);
        this.here.unshift(...far);
        this.sensed.unshift(...far.map((r) => ({ level: r.level, air: this.airAt(r), sig: r.sig })));
      }
      // (Finer levels' air can be here too, but it is the most room any
      // level gives us that is the space we are in.)
      let most = 0;
      for (const s of this.sensed) if (-s.air / s.sig > most) (most = -s.air / s.sig), (this.room = s.level);
      this.clearance = Math.max(this.sky, ...this.sensed.map((s) => -s.air / s.sig));
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
      } else break;
      this.scale *= k;
      this.pace *= k;
      this.fog *= k;
    }
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
  // rooms until there is space to stand in.
  begin(fresh = false) {
    this.trail.length = this.travelled = 0;
    this.room = null;
    this.sense();
    for (let i = 0; fresh && i < 40 && this.clearance < 0.08; i++) {
      this.pos.move([0, 0, 1]);
      this.sense();
    }
    this.scale = Math.max(this.clearance, 1e-3);
    this.fog = this.fogTarget;
  }

  // Start somewhere new: a first visit is somewhere different each time,
  // in the same world. Across, not up or down (which would take us out of
  // the storey under the ground, or into the sky): our cell and its parent
  // are anywhere in theirs. rand() gives numbers in [0, 1).
  elsewhere(rand) {
    const { pos, R } = this;
    const reset = () => {
      pos.F = 0;
      pos.digits.clear();
      pos.frac = this.space.start.slice();
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
      this.begin();
      if (pos.F >= picked[0] && this.clearance >= 0.08) return this.faceOpen();
    }
    // (Failing that, where a first visit always began.)
    reset();
    this.begin(true);
  }

  // Turn level, to whichever of the four ways along the walls is open
  // furthest. (Not the diagonals: in a closed room, the furthest of all is
  // into a corner.)
  faceOpen() {
    let best = -1;
    for (let k = 0; k < 4; k++) {
      const yaw = (k * Math.PI) / 2;
      const open = this.ahead([Math.sin(yaw), 0, -Math.cos(yaw)]);
      if (open > best) (best = open), (this.controls.yaw = yaw);
    }
    this.controls.pitch = 0;
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
  // displacement (from the mouse), both in clearances. Returns how far we
  // went, in level-F cells.
  step(dt, wish, nudge = [0, 0, 0]) {
    this.lastMove = [0, 0, 0];
    // Standing still with nothing left to settle: there is nothing to do.
    if (wish.every((x) => x === 0) && nudge.every((x) => x === 0) && this.settled()) return 0;
    this.sense();
    this.settle(dt);
    const aim = wish.map((x, a) => x * SPEED * dt + nudge[a]);
    const size = Math.hypot(...aim);
    if (size <= 0) return 0;
    // Speed is proportional to how far the way ahead is open, and a step
    // never covers more than half of that, so nothing is ever reached, only
    // approached. Going by what is ahead and not by what is nearest means a
    // doorway or a wall alongside does not slow us, only a wall in front.
    // (Slowing down is immediate; only speeding up is eased, over about a
    // second, and always from the speed we are actually going.)
    const open = (this.opened = this.clearance > 0 ? this.ahead(aim.map((x) => x / size)) : 0);
    this.pace = toward(this.pace, Math.max(open, 1e-6), 1 - Math.exp(-dt / 1.0));
    this.pace = Math.min(this.pace, Math.max(open, 0.05 * this.scale));
    const want = size * this.pace;
    const len = this.clearance > 0 ? Math.min(want, 0.5 * open) : want;
    if (len <= 0) return 0;
    const delta = aim.map((x) => (x * len) / size);
    this.pos.move(delta);
    this.lastMove = delta;
    const { trail } = this;
    trail.length = this.travelled;
    trail.push({ delta, F: this.pos.F, dt, yaw: this.controls.yaw, pitch: this.controls.pitch });
    if (trail.length > TRAIL_MAX) trail.splice(0, TRAIL_MAX / 10);
    this.travelled = trail.length;
    return len;
  }

  // Fly dt seconds along the trail, backwards (way = -1) or forwards again
  // (way = 1), faster than it was flown. The view turns to face the way it
  // did then, eased so that it never snaps.
  retrace(dt, way) {
    const { trail, pos, controls, R } = this;
    let budget = dt * 2.5 * controls.boost();
    let len = 0;
    let facing = null;
    while (budget > 0 && (way < 0 ? this.travelled > 0 : this.travelled < trail.length)) {
      const m = trail[way < 0 ? this.travelled - 1 : this.travelled];
      this.sense();
      const k = Math.pow(R, pos.F - m.F);
      pos.move(m.delta.map((x) => way * x * k));
      this.travelled += way;
      len += Math.hypot(...m.delta) * k;
      facing = m;
      budget -= m.dt;
    }
    facing ??= trail[Math.max(0, Math.min(trail.length - 1, way < 0 ? this.travelled : this.travelled - 1))];
    if (facing) {
      const ease = 1 - Math.exp(-dt / 0.15);
      const turn = Math.atan2(Math.sin(facing.yaw - controls.yaw), Math.cos(facing.yaw - controls.yaw));
      controls.yaw += turn * ease;
      controls.pitch += (facing.pitch - controls.pitch) * ease;
    }
    this.sense();
    this.settle(dt);
    return len;
  }

  // The levels to draw, seen out to maxT, at most n of them, each with how
  // far away its nearest air is (near), from where we are now (which may be
  // a step on from where sense() last looked); and all the levels around us,
  // drawn or not. A level with no air in sight is solid as far as this frame
  // is concerned.
  visible(maxT, n) {
    const { pos } = this;
    const all = this.around();
    let recs = all.filter((r) => r.level >= pos.F - UP);
    for (const r of recs) r.near = Math.max(0, (this.airAt(r) - SLACK) / r.sig);
    recs = recs.filter((r) => r.near < maxT);
    if (recs.length > n) recs = this.mostVisible(recs, n);
    return { recs, all };
  }

  // More levels have air in sight than can be drawn. In order, keep: what is
  // right in front of us; the space we are in and the two levels that give
  // its far walls their facade and texture; the spaces outside it; then the
  // rest.
  mostVisible(recs, n) {
    const levels = recs.map((r) => r.level);
    const within = (this.sensed.find((s) => s.air < 0) ?? this.sensed[0]).level;
    const order = [
      ...levels.filter((l) => l >= this.pos.F - 1).reverse(),
      within, within + 1, within + 2,
      ...levels.filter((l) => l < within).reverse(),
      ...levels.slice().reverse(),
    ];
    const keep = new Set();
    for (const l of order) if (keep.size < n && levels.includes(l)) keep.add(l);
    return recs.filter((r) => keep.has(r.level));
  }

  // Which way is out: toward the nearest air of a level coarser than the
  // room we are in, or under the ground, up to the sky. A direction, how
  // far, in level-F cells, as the crow flies (the way there may well wind),
  // and whether it is the sky; null out in the open.
  outward() {
    if (this.sky > 0 || this.room === null) return null;
    let best = { dist: -this.sky, dir: [0, 1, 0], sky: true };
    // (levels() works out from F, so it is asked for everything up to there.)
    for (const r of this.pos.levels(this.room - OUT, this.pos.F)) {
      if (r.level >= this.room) break;
      const dist = this.airAt(r) / r.sig;
      if (!(dist > 0) || dist >= best.dist) continue;
      const h = 0.25 * dist;
      const g = [0, 1, 2].map((a) => {
        const v = [0, 0, 0];
        v[a] = h;
        const up = this.airAt(r, v);
        v[a] = -h;
        return up - this.airAt(r, v);
      });
      const len = Math.hypot(...g);
      if (len > 0) best = { dist, dir: g.map((x) => -x / len), sky: false };
    }
    return best;
  }

  // The air of a level too coarse to draw, as the shader is to see it: the
  // plane of its nearest surface. all: the levels around us (see visible).
  outerAir(all) {
    let best = null;
    for (const r of all) {
      if (r.level >= this.pos.F - UP) break;
      const dist = -this.airAt(r) / r.sig;
      if (dist > 0 && (!best || dist > best.dist)) best = { r, dist };
    }
    if (!best) return null;
    const { r, dist } = best;
    const h = 0.25 * dist;
    const g = [0, 1, 2].map((a) => {
      const v = [0, 0, 0];
      v[a] = h;
      const up = this.airAt(r, v);
      v[a] = -h;
      return this.airAt(r, v) - up;
    });
    const len = Math.hypot(...g);
    if (!(len > 0)) return null;
    return { level: r.level, dist, normal: g.map((x) => x / len) };
  }
}
