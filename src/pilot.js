// The tour: flies by itself, leisurely, through whatever looks worth seeing.
//
// A few times a second it is handed a sparse picture of what the view sees,
// as distances (Renderer.look). From that it picks somewhere to go: open
// space (a long way to the nearest surface), or an opening (somewhere much
// further off than the surface all round it), which is a way into a smaller
// space. It turns toward that place gently and flies there at an easy pace.
// Getting there safely is not its business: it only says which way it would
// like to go, and travel is by the same rules as when flown by hand, which
// never reach a surface.
//
// It goes one of two ways, as asked: in, diving into openings to smaller and
// smaller spaces, or out, making for open space and the openings to spaces
// bigger than the one it is in, and so out to the sky.

import { gradient } from './air.js';

const CRUISE = 0.35; // of how far off what is in view is, per second
const CAP = 200; // open space counts up to this many clearances
const TURN = 0.7; // most yaw, radians per second
const TILT = 0.7; // most pitch, radians per second
const STEER = 2.4; // seconds: we steer for the point of the way this long ahead at our speed
const BRAKE = 1.2; // seconds: we go no faster than would bring us to what is in front in this long
const QUICKEN = 0.8, SLACKEN = 0.6; // seconds over which speed grows or shrinks by a factor e
const PITCH_MAX = 1.2;
const PITCH_PLAN = 1.5; // ...following a way planned, which can go straight up or down
const KEEP = 0.8; // how much better somewhere else has to look to change course
const TAKE = 0.2; // ...when that is an opening, and we are only heading at a surface
const OUTWARD = 0.6; // how much more, going out, a way counts for going the way out than across it
const SMALLER = -1.5; // log of how much smaller than ours a space has to be to be one going out passes by
const OPENING = Math.log(1.3); // how much further off than the surface round it an opening is
const DEEP = 2; // ...or how much deeper than it looks wide
const SLANT = 0.5; // diving, how much an opening seen at a slant counts against it
const SPANS = 15;
const HEADING = 6; // going in, how much likelier a way in the way the dive heads // going in, how many ways in are looked into for a way out elsewhere
const PLAN_EVERY = 1; // seconds between tries at planning a way, when there is none
const STALLED = 8; // seconds getting no nearer the next point before giving up the way
const BEHIND = 3; // seconds with no way ahead before one behind us will do
const NEAREST = 2; // clearances: a target closer than this is reached
// Closer than this to a surface, for the space in view, we keep away from it
// (skimming a surface is slow, and shows little).
const ROOM = 0.3;

const unit = (v) => {
  const l = Math.hypot(...v);
  return l > 0 ? v.map((x) => x / l) : v;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// What the tour asks of where the flight is, beyond what it sees.

// How many levels coarser than the room we are in to look for a way out.
const OUT = 4;

// The way directly away from the nearest built surface. Out in the open,
// none: there is nothing to keep off.
export function awayFrom(flight) {
  if (!(flight.clearance > flight.sky)) return [0, 0, 0];
  const h = 0.25 * flight.clearance;
  const g = gradient((v) => Math.max(flight.sky + v[1], ...flight.here.map((r) => -flight.airAt(r, v) / r.sig)), h);
  const l = Math.hypot(...g);
  return l > 0 ? g.map((x) => x / l) : [0, 0, 0];
}

// Which way is out: toward the nearest air of a level coarser than the room
// we are in, or under the ground, up to the sky. A direction, how far, in
// level-F cells, as the crow flies (the way there may well wind), and
// whether it is the sky; null out in the open.
export function outward(flight) {
  if (flight.sky > 0 || flight.room === null) return null;
  let best = { dist: -flight.sky, dir: [0, 1, 0], sky: true };
  // (levels() works out from F, so it is asked for everything up to there.)
  for (const r of flight.pos.levels(flight.room - OUT, flight.pos.F)) {
    if (r.level >= flight.room) break;
    const dist = flight.airAt(r) / r.sig;
    if (!(dist > 0) || dist >= best.dist) continue;
    const g = gradient((v) => flight.airAt(r, v), 0.25 * dist);
    const len = Math.hypot(...g);
    if (len > 0) best = { dist, dir: g.map((x) => -x / len), sky: false };
  }
  return best;
}

export class Pilot {
  constructor(R) {
    this.R = R;
    this.lnR = Math.log(R);
    this.on = false;
  }

  start(F) {
    this.on = true;
    this.target = null; // where we are going: a point relative to us, in level-F cells
    this.F = F; // the level target is measured in
    this.rate = [0, 0]; // yaw and pitch rates, eased
    this.spread = 0; // how far off things in view typically are, level-F cells
    this.side = 0; // which way we are turning to look about (-1 left, 1 right), or 0
    this.way = 'in'; // as looking goes (see see), when there is no way planned
    // The way planned (see Planner), as points relative to us in level-F
    // cells, the next first; and how it is going.
    this.plan = null;
    this.planned = -Infinity; // when we last tried to plan (seconds of touring): at once, to begin with
    this.ahead = 0; // when we last had a way to go ahead of us (see choose)
    this.time = 0;
    this.along = 0; // how far along the way planned we have come (level-F cells)
    this.made = 0; // ...as of when we last got on along it, and when
    this.closer = 0;
    this.look = 1; // how much of the way ahead we steer for (less where that is out of sight)
    this.v = null; // how fast we fly, level-F cells per second (see fly)
    // The tour's course: diving to some level finer than where it began,
    // lingering there a room or two, coming up to some level coarser, and
    // diving again.
    // (this.count, if set, is told of what becomes of ways planned, for
    // looking into what the tour does.)
    this.phase = 'dive';
    this.goal = null;
    this.linger = 0;
    this.going = null; // the room the way planned goes to (see Planner.key)
    this.heading = null; // which way a dive heads (see decide)
    this.last = null; // the room we were last in
    this.passed = new Set(); // the rooms come into since the last dive began
  }

  // Where to go next, as the course has it: a way the planner finds from
  // the room we are in (or, if we are in an opening, the one we were making
  // for). With none to plan (out under the sky, or on the arcology's plaza,
  // which are not rooms of the halls), we go by looking (see see).
  //
  // The course: dive some levels, linger a room or two, come up through
  // rooms not passed on the way down (so, out somewhere else), up past
  // where the dive began, and dive again.
  //
  // from: the room to plan from, if not the one we are in; on: carry on
  // the way we are following with the way found, rather than set out on it.
  decide(from = null, on = false) {
    const P = this.planner, rnd = Math.random;
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    P.begin();
    // (The room we were going to, if we are well inside it: until we are
    // in its middle, its air may not yet be what gives us most room, and
    // here() names the room round it.)
    const to = this.going && P.find(this.going);
    let at = from ?? (to && P.inside(to.k, to.c, 0) ? to : null) ?? P.here() ?? to;
    if (!at || !P.frame(at.k) || !P.room(at.k, at.c)) {
      if (this.phase === 'surface') (this.phase = 'dive'), (this.goal = null);
      this.way = 'in';
      // Out in the arcology's city: in, through the nearest entrances ahead.
      const city = P.outdoors();
      if (city === null) return;
      this.passed = new Set();
      (this.goal = city + int(2, 5)), (this.top = city - 1), (this.linger = 0), (this.heading = null);
      at = null;
      this.choose(P.waysFromCity(), null, city - 1, 'city', false);
      return;
    }
    const k = at.k, name = P.key(k, at.c);
    // (Lingering is at the bottom of a dive; come up from there, it is over.)
    if (this.phase === 'dive' && this.goal !== null && k < this.goal) this.linger = 0;
    if (this.goal === null) (this.goal = k + int(3, 6)), (this.top = k), (this.passed = new Set());
    // Come into a room not come into last time.
    if (name !== this.last) {
      this.last = name;
      this.passed.add(name);
      if (this.phase === 'dive' && k >= this.goal) {
        if (!this.linger) this.linger = int(1, 2);
        else if (--this.linger === 0) (this.phase = 'surface'), (this.goal = this.top - int(0, 2));
      } else if (this.phase === 'surface' && k <= this.goal) {
        (this.phase = 'dive'), (this.goal = k + int(3, 6)), (this.top = k), (this.passed = new Set([name]));
        this.heading = null;
      }
    }
    // Which way a dive heads: toward a room beside ours that we have not
    // been in (into the wall between, and on into the walls of the rooms in
    // it the same way; so that coming back up, it is that room's side we
    // come out on), or failing one, any way along the floor.
    if (this.phase === 'dive' && !this.heading) {
      const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      const beside = sides.filter((e) => {
        const d = at.c.map((x, a) => x + e[a]);
        return P.room(k, d) && !this.passed.has(P.key(k, d));
      });
      const from = beside.length ? beside : sides;
      this.heading = from[Math.floor(rnd() * from.length)];
    }
    this.way = this.phase === 'dive' ? 'in' : 'out';
    let ways;
    if (this.phase === 'surface') {
      const out = P.wayOut(k, at.c, this.passed, rnd);
      ways = out ? [{ points: out.points, to: out.to }] : [];
    } else if (this.linger) ways = P.waysAcross(k, at.c);
    else ways = rnd() < 0.2 ? P.waysAcross(k, at.c) : P.waysIn(k, at.c);
    if (!ways.length) ways = P.waysIn(k, at.c);
    this.choose(ways, at, k, name, on);
  }

  // Of ways from the room at (null: from the city, see decide), the one to
  // go: the likeliest that can be got to from here; and so the plan.
  choose(ways, at, k, name, on) {
    const P = this.planner, rnd = Math.random;
    if (!ways.length) return;
    // The nearer, and the more nearly ahead, the likelier; going straight
    // up or down through a floor or ceiling, less so. And only ways ahead,
    // if there are any (turning back on our way is no tour: what we were
    // making for, we should get to), nor back into the room we were last
    // going to. None more than a little behind us, until for some seconds
    // there has been nothing else (meanwhile we fly on, and look).
    // (Carrying on a way, from its end, facing the way its last stretch goes.)
    const end = on && this.plan ? this.plan.at(-1).slice(0, 3) : [0, 0, 0];
    const last = on && this.plan && this.plan.length > 1 ? unit(end.map((x, a) => x - this.plan.at(-2)[a])) : null;
    const fwd = last && Math.hypot(...last) > 0 ? last : this.fwd ?? [0, 0, -1];
    for (const w of ways) w.at = P.toUs(P.frame(w.points[0][0]), w.points[0][1]).map((x, a) => x - end[a]);
    const left = ways.filter((w) => !(w.to?.c && P.key(w.to.k, w.to.c) === this.left));
    if (left.length) ways = left;
    for (const most of [0, -0.34]) {
      const these = ways.filter((w) => dot(unit(w.at), fwd) > most);
      if (these.length) {
        ways = these;
        break;
      }
    }
    if (dot(unit(ways[0].at), fwd) > -0.34) this.ahead = this.time;
    else if (this.time - this.ahead < BEHIND) return;
    const far = (w) => Math.hypot(...w.at);
    const near = Math.min(...ways.map(far));
    // (Going in, ways into a wall with a room we have not been in behind it,
    // likelier still: through it, coming back up, is another room.)
    const behind = (w) => at && w.face && w.to?.k === k + 1 && !w.down && P.room(k, at.c.map((x, a) => x + w.face[a])) && !this.passed.has(P.key(k, at.c.map((x, a) => x + w.face[a])));
    // (Ways behind us, hardly ever: turning back on our way is no tour.)
    const ahead = (w) => dot(unit(w.at), fwd) > -0.3;
    const heading = (w) => this.phase === 'dive' && w.face && this.heading && ahead(w) && w.face.every((v, a) => v === this.heading[a]);
    const weight = new Map(ways.map((w) => [w, (0.2 + (1 + dot(unit(w.at), fwd)) / 2) ** 2 * Math.exp(-far(w) / (3 * near)) * (w.down ? 0.4 : 1) * (heading(w) ? HEADING : 1) * (0.3 + rnd())]));
    ways.sort((a, b) => weight.get(b) - weight.get(a));
    // Going in, of the likeliest, the first whose rooms reach a way up into
    // a room other than this one (and not one passed): coming back up, that
    // is a way out somewhere else.
    if (at && this.phase === 'dive' && !this.linger) {
      const fresh = (air) => air === 'sky' || !air.c || (P.key(air.k, air.c) !== name && !this.passed.has(P.key(air.k, air.c)));
      const i = ways.slice(0, SPANS).findIndex((w) => !P.late() && ahead(w) && w.to?.k === k + 1 && P.searchUp(k + 1, w.to.c, rnd, fresh).steps);
      if (i > 0) ways.unshift(...ways.splice(i, 1));
      this.count?.(i >= 0 ? 'spans' : 'spans none');
    }
    // (The likeliest that can be got to from here.)
    let plan = null, way = null;
    for (const w of ways.slice(0, 6)) {
      if (P.late() && plan === null && w !== ways[0]) break;
      plan = P.points(w, at, end);
      if (plan) {
        way = w;
        break;
      }
    }
    if (!plan) return;
    if (on && this.plan) this.plan.push(...plan);
    else {
      // (The way, as a path from where we are; and how far along it we
      // have come.)
      this.plan = [[0, 0, 0, 0], ...plan];
      this.along = this.made = 0;
      this.closer = this.time;
      this.closerF = this.planner.flight.pos.F;
      this.look = 1;
    }
    this.chained = false;
    this.left = this.going;
    this.going = way.to && way.to !== 'sky' && way.to.c ? P.key(way.to.k, way.to.c) : null;
    this.kind = 'plan';
  }

  // The point of the way planned at length u along it (cum: the lengths
  // along it of its points).
  at(cum, u) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < u) i++;
    const [a, b] = [this.plan[i], this.plan[i + 1] ?? this.plan[i]], len = cum[i + 1] - cum[i];
    const t = len > 0 ? Math.max(0, Math.min(1, (u - cum[i]) / len)) : 0;
    return [0, 1, 2].map((q) => a[q] + (b[q] - a[q]) * t);
  }

  stop() {
    this.on = false;
  }

  // Bring the target to level F's units, then account for having moved by
  // delta (level-F cells).
  moved(delta, F) {
    if (F !== this.F) {
      const k = Math.pow(this.R, F - this.F);
      if (this.target) this.target = this.target.map((x) => x * k);
      if (this.plan) this.plan = this.plan.map((p) => p.map((x) => x * k)); // (clearance and all)
      this.along *= k;
      this.made *= k;
      this.spread *= k;
      if (this.v) this.v *= k;
      this.F = F;
    }
    if (this.target) this.target = this.target.map((x, a) => x - delta[a]);
    if (this.plan) this.plan = this.plan.map(([x, y, z, c]) => [x - delta[0], y - delta[1], z - delta[2], c]);
  }

  // A new look (from Renderer.seen): a grid of distances in level-lookF cells,
  // -1 for nothing, taken with camera basis b and half-height tan, every
  // stride-th pixel of a canvas res pixels in size. F, scale (our clearance),
  // sky (how high we are above the ground) and room (how big the space we
  // are in is, if we are in one) are as of now, in level-F cells; out is
  // which way is out (see Flight.outward), going out.
  see(look, b, lookF, tan, res, stride, { F, scale, sky, room = Infinity, out = null }) {
    const { w, h, dist } = look;
    const k = Math.pow(this.R, F - lookF);
    // How big the space in view is: the median distance to what is in it
    // (which is how fast we go: see fly).
    const seen = Float32Array.from(dist.filter((x) => x >= 0).map((x) => Math.max(Math.min(x * k, CAP * scale), 1e-6 * scale))).sort();
    this.spread = seen.length ? seen[seen.length >> 1] : 0;
    // (Following a way planned, there is nothing to look for.)
    if (this.plan) return;
    // Each grid point's direction, worked out once.
    const n = w * h;
    const dirs = new Float32Array(n * 3);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = (((i + 0.5) * stride * 2 - res[0]) / res[1]) * tan;
      const v = (((j + 0.5) * stride * 2 - res[1]) / res[1]) * tan;
      const x = b.fwd[0] + b.right[0] * u + b.up[0] * v;
      const y = b.fwd[1] + b.right[1] * u + b.up[1] * v;
      const z = b.fwd[2] + b.right[2] * u + b.up[2] * v;
      const l = Math.hypot(x, y, z);
      const o = (j * w + i) * 3;
      dirs[o] = x / l;
      dirs[o + 1] = y / l;
      dirs[o + 2] = z / l;
    }
    const far = CAP * scale;
    // Distance, capped (nothing counts as far), and never quite zero, since
    // what is made of it goes by its logarithm.
    const D = new Float32Array(n);
    for (let m = 0; m < n; m++) D[m] = dist[m] < 0 ? far : Math.max(Math.min(dist[m] * k, far), 1e-6 * scale);
    const at = (i, j) => D[j * w + i];

    // The surface round about (i, j), r grid steps out: the median of eight.
    const eight = new Float64Array(8);
    const ring = (i, j, r) => {
      if (i < r || j < r || i >= w - r || j >= h - r) return -1;
      eight[0] = at(i - r, j); eight[1] = at(i + r, j); eight[2] = at(i, j - r); eight[3] = at(i, j + r);
      eight[4] = at(i - r, j - r); eight[5] = at(i + r, j - r); eight[6] = at(i - r, j + r); eight[7] = at(i + r, j + r);
      for (let a = 1; a < 8; a++) {
        const x = eight[a];
        let c = a - 1;
        for (; c >= 0 && eight[c] > x; c--) eight[c + 1] = eight[c];
        eight[c + 1] = x;
      }
      return 0.5 * (eight[3] + eight[4]);
    };

    const diving = this.way === 'in';

    // How clearly a point d away, with the surface r grid steps round it m
    // away, is an opening (0 if it is not): by how much further off it is
    // than that surface, or by how deep it is for how wide it looks. (A
    // cavity far off can be shallow next to how far off it is, and still
    // plain to see.)
    const step = (2 * tan * stride) / res[1]; // radians per grid step
    const opening = (d, m, r) => {
      if (m < 0) return 0;
      const further = Math.log(d / m);
      const deep = (d - m) / (2 * r * step * m);
      if (further < OPENING && deep < DEEP) return 0;
      return Math.min(2, Math.max(further, OPENING + 0.4 * Math.log(deep / DEEP)));
    };

    // How good going toward grid point (i, j) looks, how far along it to
    // aim, and what is there (for looking into what the tour does).
    const fwd = b.fwd;
    const score = (i, j, jitter) => {
      const m0 = j * w + i;
      const d = D[m0];
      if (d < 1.5 * scale) return { s: -Infinity };
      const dx = dirs[m0 * 3], dy = dirs[m0 * 3 + 1], dz = dirs[m0 * 3 + 2];
      const turn = Math.acos(Math.max(-1, Math.min(1, dx * fwd[0] + dy * fwd[1] + dz * fwd[2])));
      // (Going out, the more of the way it goes the way out, the better.)
      const outness = !diving && out ? dx * out.dir[0] + dy * out.dir[1] + dz * out.dir[2] : 0;
      const toward = 1 + OUTWARD * outness;
      // How much bigger than ours a space of size e is, as going out sees
      // it. (A space a level smaller is no detour if it is straight up to
      // the sky: from the top storey, the only ways out are through the
      // roof.)
      const straight = outness > 0.7 && out.sky;
      const bigger = (e) => {
        const b = Math.log(Math.max(e, 1e-30) / room);
        return straight && b < 0 ? Math.min(0, b + this.lnR) : b;
      };
      // (Steep views are avoided, except diving down at the ground, or
      // going straight the way out.)
      const pitch = Math.max(0, Math.abs(dy) - ((diving && sky > 0 && dy < 0) || outness > 0.7 ? 0.9 : 0.45)) * 3;
      // Off into an empty sky is no tour. (But from under the ground, it
      // is the way out.)
      const away = dist[m0] < 0 && dy > 0.15 && (diving || sky > 0) ? 2 : 0;
      const base = -1.2 * turn - pitch - away + jitter;
      let s = -Infinity, aim = 0, kind = '';
      if (!diving) {
        // Out: into open space. (But an opening into a space smaller than
        // the one we are in is only as far off as the wall it is in: in a
        // small room the furthest things in sight are down such openings,
        // and making for them would take us in.)
        let far = d;
        for (let r = 2; r <= 8; r *= 2) {
          const m = ring(i, j, r);
          if (opening(d, m, r) && bigger(d - m) < SMALLER) far = Math.min(far, m);
        }
        s = base + toward * Math.log(far / scale);
        aim = 0.6 * far;
        kind = 'open';
      } else if (dist[m0] >= 0) {
        // Diving: at a surface, failing anything better (coming close to
        // one, finer openings show; but one already in sight is better).
        s = base - 0.5;
        aim = 0.85 * d;
        kind = 'surface';
      }
      // Out over the ground, a way down into it is an opening too (seen
      // nearly edge on, a pit is not much deeper than the ground beyond it).
      if (diving && sky > 0 && dy < 0) {
        const below = -(sky + dy * d);
        if (below > 0.3 * scale) {
          // (The nearer the better.)
          const down = sky / -dy;
          const t = base + 2.4 * Math.min(2, Math.log(1 + below / scale)) - 0.5 * Math.log(down / scale);
          if (t > s) {
            s = t;
            aim = down + 0.5 * (d - down);
            kind = 'pit';
          }
        }
      }
      for (let r = 2; r <= 8; r *= 2) {
        const m = ring(i, j, r);
        const hole = opening(d, m, r);
        if (!hole) continue;
        // (Going in never goes out: not into the sky, nor into a space
        // plainly bigger than ours, such as the one we have just come from.)
        if (diving && (dist[m0] < 0 || bigger(d - m) > 0.7)) continue;
        // How steeply the wall round it is seen: an opening seen at a slant
        // can only be come at along the wall, which flight slides along
        // without turning in. (The tangent of the angle off face on, from
        // how the distance to the wall changes across the opening.)
        const across = 2 * r * step * m;
        const slant = Math.hypot(at(i + r, j) - at(i - r, j), at(i, j + r) - at(i, j - r)) / across;
        // How clearly it is an opening, and how big the space beyond it is:
        // going in looks for spaces smaller than the one we are in, going
        // out for bigger ones. (Against the space we are in, not how close
        // we are to its walls: close to a wall, every opening in it is big
        // for us.)
        const t = base + (diving ? 1 + 1.5 * hole - 0.9 * Math.max(bigger(d - m), 0) - 0.3 * Math.log(m / scale) - SLANT * Math.log1p(slant * slant)
                                 : toward * Math.log(d / scale) + 0.5 * hole + 0.8 * Math.min(1.5, bigger(d - m)));
        if (t > s) {
          s = t;
          // Aim past the mouth, halfway to what lies beyond it.
          aim = m + 0.5 * (d - m);
          kind = 'hole';
        }
      }
      // (Going out, somewhere closer than a target is kept to is nowhere to
      // go. Going in, it is the way on: we carry on into it.)
      if (!diving && aim < NEAREST * scale) return { s: -Infinity };
      return { s, aim, kind, turn };
    };

    // The clearest opening within a turn of the way we face, however it
    // scores (as how much further off it is than the surface round it would
    // make it that clear).
    const h0 = h;
    const holeNear = (cone) => {
      let clearest = 0;
      for (let j = 0; j < h0; j++) for (let i = 0; i < w; i++) {
        const m0 = j * w + i;
        const d = D[m0];
        if (d < 1.5 * scale || dist[m0] < 0) continue;
        const c = dirs[m0 * 3] * fwd[0] + dirs[m0 * 3 + 1] * fwd[1] + dirs[m0 * 3 + 2] * fwd[2];
        if (c < Math.cos(cone)) continue;
        for (let r = 2; r <= 8; r *= 2) {
          const hole = opening(d, ring(i, j, r), r);
          if (hole) clearest = Math.max(clearest, Math.exp(hole));
        }
      }
      return clearest;
    };

    let best = null;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const { s, aim, kind, turn } = score(i, j, 0.15 * Math.random());
      if (s > -Infinity && (!best || s > best.s)) {
        const o = (j * w + i) * 3;
        best = { s, kind, turn, go: [dirs[o] * aim, dirs[o + 1] * aim, dirs[o + 2] * aim] };
      }
    }

    // How the current target looks now, if it is still in view and clear. An
    // opening we are making for counts for at least what it did when we
    // chose it: close up, it can fill more of the view than is looked at to
    // see an opening, and no longer be seen as one.
    let current = null;
    if (this.target) {
      const len = Math.hypot(...this.target);
      const dir = this.target.map((x) => x / len);
      const z = dot(dir, b.fwd);
      if (z > 0.2 && len > NEAREST * scale) {
        const u = dot(dir, b.right) / z / tan, v = dot(dir, b.up) / z / tan;
        const i = Math.floor((u * res[1] + res[0]) / 2 / stride), j = Math.floor((v * res[1] + res[1]) / 2 / stride);
        if (i >= 1 && j >= 1 && i < w - 1 && j < h - 1) {
          let clear = 0, s = -Infinity;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            clear = Math.max(clear, at(i + di, j + dj));
            s = Math.max(s, score(i + di, j + dj, 0.15).s);
          }
          const kept = this.kind === 'hole' || this.kind === 'pit' ? this.chose.s : -Infinity;
          if (clear > 0.8 * len && Math.max(s, kept) > -Infinity) current = Math.max(s, kept);
        }
      }
    }

    // (For looking into what the tour does, when asked to: what it sees, and
    // how clear an opening there is near the way it faces.)
    if (this.diagnose) this.saw = { best, current, diving, holeNear: holeNear(0.35), holeWide: holeNear(0.7), ahead: D[(h >> 1) * w + (w >> 1)] / scale };
    const keep = this.kind === 'surface' && best && best.kind !== 'surface' ? TAKE : KEEP;
    if (current !== null && !(best && best.s > current + keep)) return;
    if (best && best.s > -1.5) {
      this.side = 0;
      this.target = best.go;
      this.chose = best; // (for looking into what it does)
      this.kind = best.kind;
      this.F = F;
      this.picks = (this.picks || 0) + 1;
      return;
    }
    // Nothing worth going to in sight: turn and look about, toward the way
    // out if we are going out and it is to one side, or else the more open
    // side; and once turning, keep on the same way until there is somewhere
    // to go. (Choosing afresh each look, in a corner, where the two sides
    // are much alike, it turned back and forth and never got out.)
    if (!this.side) {
      const across = !diving && out ? dot(out.dir, b.right) : 0;
      let left = 0, right = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) (i < w / 2 ? (left += Math.log(at(i, j))) : (right += Math.log(at(i, j))));
      this.side = Math.abs(across) > 0.2 ? Math.sign(across) : left > right ? -1 : 1;
    }
    const side = this.side;
    this.target = [0, 1, 2].map((a) => (b.fwd[a] * 0.5 + b.right[a] * side) * 4 * scale);
    this.kind = 'aside';
    this.F = F;
  }

  // Fly like a plane: on at a steady speed, turning toward the target at a
  // bounded rate, never stopping to turn. away() gives the way directly away
  // from the nearest surface. While steered (the view is being turned by
  // hand) it only flies on the way we face, and looks for somewhere to go
  // afresh once that stops. Returns the velocity wished for, as from the
  // keys.
  //
  // Speed is a steady CRUISE of how big the space we are in looks (how far
  // off what is in view is: see see); failing a look, our clearance. It
  // changes only gradually (by a factor at a time, the world being the
  // same at every scale), and never so fast that what is in front of us
  // would be reached in under BRAKE seconds. Flight goes by how
  // far the way ahead is open; the wish is scaled so that it comes to this.
  //
  // Steering is pure pursuit: for a point STEER seconds ahead along the way,
  // turning at a rate in proportion to how far off it is, which carries us
  // round corners in arcs begun before them.
  fly(dt, controls, scale, away, steered) {
    this.time += dt;
    this.dt = dt;
    if (steered) {
      this.target = this.plan = null;
      this.rate = [0, 0];
    }
    const { fwd } = controls.basis();
    this.fwd = fwd;
    // Every so often, when there is no way planned, plan one (out under the
    // sky there is none to plan: there we go by looking).
    const flight = this.planner?.flight;
    if (flight && !this.plan && !steered && this.time - this.planned > PLAN_EVERY && flight.room !== null) {
      this.planned = this.time;
      if (flight.sky > 0) {
        if (this.phase === 'surface') (this.phase = 'dive'), (this.goal = null);
        this.way = 'in';
      } else {
        this.F = flight.pos.F;
        this.decide();
        if (this.plan) this.target = null;
      }
    }
    const size = this.spread > 0 ? this.spread : scale; // how big the space we are in looks
    const v0 = this.v ?? 0.6 * CRUISE * size; // (setting off gently)
    if (this.plan) {
      // Follow the way as a path: how far along it we have come is how far
      // along it the nearest point of it is (looked for a few stretches on
      // from there, never back); and we steer for the point further along
      // (less far if that is out of sight).
      const P = this.planner, F = P.flight.pos.F;
      const lengths = () => {
        const cum = [0];
        for (let i = 1; i < this.plan.length; i++) cum.push(cum[i - 1] + dist(this.plan[i - 1], this.plan[i]));
        return cum;
      };
      let cum = lengths();
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] <= this.along) i++;
      let drift = Infinity;
      for (let j = i; j < Math.min(i + 3, this.plan.length - 1); j++) {
        const [a, b] = [this.plan[j], this.plan[j + 1]], len = cum[j + 1] - cum[j];
        const t = len > 0 ? Math.max(0, Math.min(1, -dot(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]) / (len * len))) : 0;
        const off = Math.hypot(...[0, 1, 2].map((q) => a[q] + (b[q] - a[q]) * t));
        if (cum[j] + t * len >= this.along && off < drift) (drift = off), (this.along = cum[j] + t * len);
      }
      if (drift === Infinity) drift = Math.hypot(...this.at(cum, this.along));
      const L = Math.max(v0 * STEER, 0.5 * scale) * this.look;
      // Nearing the end of the way: on from the room it goes to, rather
      // than come to its end (and set out afresh, any way at all from
      // there). Tried every so often until it is carried on.
      if (cum.at(-1) - this.along < 3 * L && this.going && !this.chained && this.time - (this.tried ?? -1) > 0.5) {
        this.tried = this.time;
        P.begin();
        const to = P.find(this.going);
        if (to) {
          const n = this.plan.length;
          this.decide(to, true);
          this.chained = this.plan.length > n;
          this.count?.(this.chained ? 'chained' : 'chain none');
          cum = lengths();
        }
      }
      if (cum.at(-1) - this.along < 0.25 * L) (this.plan = null), (this.planned = -Infinity), (this.target = fwd.map((x) => x * L)), this.count?.('done');
      else {
        if (this.along > this.made + 0.5 * scale) (this.made = this.along), (this.closer = this.time), (this.closerF = F);
        // Getting no further along for a while, or come so close to
        // something on the way that we are two levels finer than when we
        // last got on, or well off the way: give it up and plan again
        // (flying on as we were meanwhile).
        if (this.time - this.closer > STALLED || F - this.closerF >= 2 || drift > 3 * L) {
          this.count?.(this.time - this.closer > STALLED ? 'stalled' : F - this.closerF >= 2 ? 'pressed' : 'off the way');
          (this.plan = null), (this.target = fwd.map((x) => x * L));
        } else {
          const carrot = this.at(cum, Math.min(this.along + L, cum.at(-1)));
          // (Out of sight: look less far along, a few times a second.)
          if (this.time - (this.glanced ?? -1) > 0.25) {
            this.glanced = this.time;
            P.begin();
            this.look = P.clear([0, 0, 0], carrot) ? Math.min(1, this.look * 1.25) : Math.max(0.2, this.look * 0.5);
          }
          this.target = carrot;
        }
      }
    }
    if (!this.plan && this.target && (Math.hypot(...this.target) < NEAREST * scale || dot(unit(this.target), fwd) < -0.5)) {
      // Come to where we aimed in an opening, going in: on into it, the
      // same way (where we aimed was only a guess at how deep it goes, made
      // from further off; if it is no deeper, the next look says so).
      // Choosing afresh there, it turned off to whatever opening in the
      // wall beside it looked best, and never went in.
      const into = this.way === 'in' && (this.kind === 'hole' || this.kind === 'pit') && dot(this.target, fwd) > 0;
      this.target = into ? unit(this.target).map((x) => x * 3 * NEAREST * scale) : null;
    }
    let err = 0;
    const want = [0, 0];
    if (this.target) {
      let dir = unit(this.target);
      // (But not off the mouth of an opening we are going into.)
      const into = this.kind === 'hole' || this.kind === 'pit' || this.plan;
      const near = this.spread > 0 && !into ? 1 - scale / (ROOM * this.spread) : 0;
      if (near > 0) {
        const n = away();
        dir = unit(dir.map((x, a) => x + n[a] * near * 0.8));
      }
      const yaw = Math.atan2(dir[0], -dir[2]);
      const most = this.plan ? PITCH_PLAN : PITCH_MAX;
      const pitch = Math.max(-most, Math.min(most, Math.asin(dir[1])));
      // (Toward a point nearly straight up or down, which way it is round
      // about hardly matters, and is no steady guide: turn little.)
      const level = Math.min(1, Math.hypot(dir[0], dir[2]) / 0.3);
      const ey = level * Math.atan2(Math.sin(yaw - controls.yaw), Math.cos(yaw - controls.yaw));
      const ep = pitch - controls.pitch;
      // (Pure pursuit: the turn that would bring us to the point on an arc.)
      want[0] = Math.max(-TURN, Math.min(TURN, (2 * ey) / STEER));
      want[1] = Math.max(-TILT, Math.min(TILT, (2 * ep) / STEER));
      err = Math.acos(Math.max(-1, Math.min(1, dot(dir, fwd))));
    }
    // (Turning eased only enough not to jerk.)
    const ease = 1 - Math.exp(-dt / 0.2);
    this.rate = this.rate.map((r, a) => r + (want[a] - r) * ease);
    controls.yaw += this.rate[0] * dt;
    const most = this.plan ? PITCH_PLAN : Math.max(PITCH_MAX, Math.abs(controls.pitch));
    controls.pitch = Math.max(-most, Math.min(most, controls.pitch + this.rate[1] * dt));
    // How fast: CRUISE of the space, a little less turning back on
    // ourselves (a tighter circle); no faster than what is in front lets
    // us; changed gradually, by a factor at a time.
    const open = flight?.opened > 0 ? flight.opened : Infinity;
    const goal = Math.min(CRUISE * size * (err > Math.PI / 2 ? 0.6 : 1), open / BRAKE);
    const grow = Math.log(Math.max(goal, 1e-30) / v0);
    const v = v0 * Math.exp(Math.max(-dt / SLACKEN, Math.min(dt / QUICKEN, grow)));
    // (Whatever happens, never on at a wall faster than twice that.)
    this.v = Math.min(v, (2 * open) / BRAKE);
    // Flight goes at its pace (level-F cells per second, for a wish of 1),
    // so this wish comes to v.
    const pace = flight?.pace > 0 ? flight.pace : scale;
    const go = (controls.speed * this.v) / pace;
    return fwd.map((x) => x * go);
  }
}
