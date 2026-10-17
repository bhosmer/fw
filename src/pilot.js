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

const PACE = 0.45; // of the open way ahead per second (hand flying: 1)
const CAP = 200; // open space counts up to this many clearances
const TURN = 0.45; // most yaw, radians per second
const TILT = 0.35; // most pitch, radians per second
const PITCH_MAX = 1.2;
const PITCH_PLAN = 1.5; // ...following a way planned, which can go straight up or down
const KEEP = 0.8; // how much better somewhere else has to look to change course
const TAKE = 0.2; // ...when that is an opening, and we are only heading at a surface
const OUTWARD = 0.6; // how much more, going out, a way counts for going the way out than across it
const SMALLER = -1.5; // log of how much smaller than ours a space has to be to be one going out passes by
const OPENING = Math.log(1.3); // how much further off than the surface round it an opening is
const DEEP = 2; // ...or how much deeper than it looks wide
const SLANT = 0.5; // diving, how much an opening seen at a slant counts against it
const SPANS = 15; // going in, how many ways in are looked into for a way out elsewhere
const PLAN_EVERY = 1; // seconds between tries at planning a way, when there is none
const STALLED = 8; // seconds getting no nearer the next point before giving up the way
const NEAREST = 2; // clearances: a target closer than this is reached
// Closer than this to a surface, for the space in view, we keep away from it
// (skimming a surface is slow, and shows little).
const ROOM = 0.3;

const unit = (v) => {
  const l = Math.hypot(...v);
  return l > 0 ? v.map((x) => x / l) : v;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
    this.planned = 0; // when we last tried to plan (seconds of touring)
    this.time = 0;
    this.closest = Infinity; // nearest we have come to the next point, and when
    this.closer = 0;
    // The tour's course: diving to some level finer than where it began,
    // lingering there a room or two, coming up to some level coarser, and
    // diving again.
    // (this.count, if set, is told of what becomes of ways planned, for
    // looking into what the tour does.)
    this.phase = 'dive';
    this.goal = null;
    this.linger = 0;
    this.going = null; // the room the way planned goes to (see Planner.key)
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
  decide() {
    const P = this.planner, rnd = Math.random;
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    P.begin();
    const at = P.here() ?? (this.going && P.find(this.going));
    if (!at || !P.frame(at.k) || !P.room(at.k, at.c)) {
      if (this.phase === 'surface') (this.phase = 'dive'), (this.goal = null);
      this.way = 'in';
      return;
    }
    const k = at.k, name = P.key(k, at.c);
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
      }
    }
    this.way = this.phase === 'dive' ? 'in' : 'out';
    let ways;
    if (this.phase === 'surface') {
      const out = P.wayOut(k, at.c, this.passed, rnd);
      ways = out ? [{ points: out.points, to: out.to }] : [];
    } else if (this.linger) ways = P.waysAcross(k, at.c);
    else ways = rnd() < 0.2 ? P.waysAcross(k, at.c) : P.waysIn(k, at.c);
    if (!ways.length) ways = P.waysIn(k, at.c);
    if (!ways.length) return;
    // The nearer, and the more nearly ahead, the likelier; going straight
    // up or down through a floor or ceiling, less so.
    const fwd = this.fwd ?? [0, 0, -1];
    for (const w of ways) w.at = P.toUs(P.frame(w.points[0][0]), w.points[0][1]);
    const far = (w) => Math.hypot(...w.at);
    const near = Math.min(...ways.map(far));
    // (Going in, ways into a wall with a room we have not been in behind it,
    // likelier still: through it, coming back up, is another room.)
    const behind = (w) => w.face && w.to?.k === k + 1 && !w.down && P.room(k, at.c.map((x, a) => x + w.face[a])) && !this.passed.has(P.key(k, at.c.map((x, a) => x + w.face[a])));
    const weight = new Map(ways.map((w) => [w, (1.2 + dot(unit(w.at), fwd)) * Math.exp(-far(w) / (3 * near)) * (w.down ? 0.4 : 1) * (0.3 + rnd())]));
    ways.sort((a, b) => weight.get(b) - weight.get(a));
    // Going in, of the likeliest, the first whose rooms reach a way up into
    // a room other than this one (and not one passed): coming back up, that
    // is a way out somewhere else.
    if (this.phase === 'dive' && !this.linger) {
      const fresh = (air) => air === 'sky' || !air.c || (P.key(air.k, air.c) !== name && !this.passed.has(P.key(air.k, air.c)));
      const i = ways.slice(0, SPANS).findIndex((w) => !P.late() && w.to?.k === k + 1 && P.searchUp(k + 1, w.to.c, rnd, fresh).steps);
      if (i > 0) ways.unshift(...ways.splice(i, 1));
      this.count?.(i >= 0 ? 'spans' : 'spans none');
    }
    // (The likeliest that can be got to from here.)
    let plan = null, way = null;
    for (const w of ways.slice(0, 6)) {
      plan = P.points(w, at);
      if (plan) {
        way = w;
        break;
      }
    }
    if (!plan) return;
    this.plan = plan;
    this.going = way.to && way.to !== 'sky' && way.to.c ? P.key(way.to.k, way.to.c) : null;
    this.kind = 'plan';
    this.closest = Infinity;
    this.closer = this.time;
    this.closerF = this.planner.flight.pos.F;
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
      this.closest *= k;
      this.spread *= k;
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
    // (Following a way planned, there is nothing to look for.)
    if (this.plan) return;
    const { w, h, dist } = look;
    const k = Math.pow(this.R, F - lookF);
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
    // How big the space in view is: the median distance to what is in it.
    const seen = Float32Array.from(D.filter((_, m) => dist[m] >= 0)).sort();
    this.spread = seen.length ? seen[seen.length >> 1] : 0;

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

  // Turn toward the target, keeping off surfaces: away() gives the way
  // directly away from the nearest. While steered (the view is being turned
  // by hand) it only flies on the way we face, and looks for somewhere to go
  // afresh once that stops. Returns the velocity wished for, as from the keys.
  fly(dt, controls, scale, away, steered) {
    this.time += dt;
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
    if (this.plan) {
      // On past each point once near it: as near as the clearance there
      // (so that in a small room, we are well inside it), or for one far
      // from the next, further, so that we round it rather than turn
      // sharply at it.
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const off = (p) => Math.hypot(p[0], p[1], p[2]);
      while (this.plan.length) {
        const [p, q] = this.plan;
        // (Or, near it, if the next is in plain sight from here: hanging
        // about to come within its clearance, in a tight place, we could
        // circle it for a while. Looked at a few times a second.)
        let seen = false;
        if (q && off(p) < 3 * p[3] && this.time - (this.glanced ?? -1) > 0.25) {
          this.glanced = this.time;
          seen = this.planner.clear([0, 0, 0], q);
        }
        if (!seen && off(p) > Math.max(p[3], q ? 0.3 * dist(p, q) : 0)) break;
        this.plan.shift();
        this.closest = Infinity;
        this.closer = this.time;
        this.closerF = this.planner.flight.pos.F;
      }
      if (!this.plan.length) (this.plan = null), (this.planned = -Infinity), this.count?.('done');
      else {
        // Getting no nearer for a while (stopped against something), give
        // it up and plan again.
        const d = off(this.plan[0]);
        const F = this.planner.flight.pos.F;
        // (Nearer by a tenth, or, going slowly through a tight place toward
        // a point far off, by half our clearance.)
        if (d < Math.max(0.9 * this.closest, this.closest - 0.5 * scale)) (this.closest = d), (this.closer = this.time), (this.closerF = F);
        // (Nor if we have come so close to something on the way that we
        // are two levels finer than when we last got nearer.)
        if (this.time - this.closer > STALLED || F - this.closerF >= 2) {
          if (this.count) this.count((this.time - this.closer > STALLED ? 'stalled' : 'pressed') + (this.planner.clear([0, 0, 0], this.plan[0]) ? ' in sight' : ' hidden') + ' ' + (off(this.plan[0]) / this.plan[0][3]).toFixed(0) + 'x');
          (this.plan = null), (this.target = null);
        }
        else this.target = this.plan[0].slice(0, 3);
      }
    }
    if (!this.plan && this.target && (Math.hypot(...this.target) < NEAREST * scale || dot(this.target, fwd) < 0)) this.target = null;
    let err = 0;
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
      const ease = 1 - Math.exp(-dt / 0.6);
      const turn = this.plan ? 2 * TURN : TURN, tilt = this.plan ? 2 * TILT : TILT;
      this.rate[0] += (Math.max(-turn, Math.min(turn, ey * 0.9)) - this.rate[0]) * ease;
      this.rate[1] += (Math.max(-tilt, Math.min(tilt, ep * 0.9)) - this.rate[1]) * ease;
      err = Math.acos(Math.max(-1, Math.min(1, dot(dir, fwd))));
    } else {
      this.rate = this.rate.map((r) => r * Math.exp(-dt / 0.6));
    }
    controls.yaw += this.rate[0] * dt;
    const most = this.plan ? PITCH_PLAN : Math.max(PITCH_MAX, Math.abs(controls.pitch));
    controls.pitch = Math.max(-most, Math.min(most, controls.pitch + this.rate[1] * dt));
    // Slow down while turning hard, and to a crawl while looking about for
    // somewhere to go (rather than on into whatever is ahead: going in,
    // that is where to go anyway).
    const looking = this.kind === 'aside' || (!this.target && this.way === 'out');
    // (Following a way planned, we turn toward a point off to the side
    // before going on much: going on, we would circle it.)
    const turning = this.plan ? Math.max(0.05, Math.cos(err)) ** 3 : 0.3 + 0.7 * Math.max(0, Math.cos(err));
    const go = PACE * controls.speed * turning * (looking ? 0.25 : 1);
    return controls.basis().fwd.map((x) => x * go);
  }
}
