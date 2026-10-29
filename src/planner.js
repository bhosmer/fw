// Ways through the halls, found from what the world is, not from what is in
// view: the tour (pilot.js) asks for one when it has somewhere it wants to
// be, and flies it as a list of points.
//
// A room is a built cell of some level's lattice (see hallsRoom in
// spaces/halls.js); an opening in a face joins it to the cell beyond
// (hallsOpenings). Beyond is another room of the same level, or air of a
// coarser level (the cell lies in its parent's room, or its parent's
// parent's...), or solid (an opening into an unbuilt cell is a niche). And
// a room's walls, floor and ceiling are cells of the next level down, some
// of them rooms opening into it. So from a room there are ways across (to
// rooms of its level), in (to rooms of the next level, in its walls) and
// up (to the coarser room some opening comes out into).
//
// Rooms are named by level and cell, the cell as an offset from ours at
// that level (see frame), and points in them are in that level's lattice
// units across from the corner of our cell, until they are turned into
// offsets from us in level-F cells for the pilot.

import { M } from './spaces/halls.js';
import { levelSeed, wrapId } from './util.js';

const PAST = M + 1; // how far either side of an opening its points are (a unit past its walls)
const ACROSS = 60; // most rooms of one level looked through, from one
const TRIES = 12; // most ways into the walls tried, looking for a way through them
const UP = 4; // most levels up looked, for the air a cell is in
// How much a plan may look at (rooms, and steps along lines of sight):
// about 18 ms on the machine this was tried on. (Counted, not timed, so
// that the same place plans the same way every time.)
const BUDGET = 30000;
const LONGEST = 30; // most points in a way through a wall worth going

export class Planner {
  constructor(flight) {
    this.flight = flight;
    this.R = flight.R;
    this.frames = new Map();
    // What has been worked out about cells, for the plan being made (by
    // cell: see cell): the same ones are asked about over and over.
    this.rooms = new Map();
    this.airs = new Map();
  }

  // Each search starts afresh (we will have moved), and may look at only
  // so much (see BUDGET): searching longer would hold up the frame it is
  // done in. (One that runs out finds nothing, and is tried again later.)
  begin(budget = this.budget ?? BUDGET) {
    this.frames.clear();
    this.rooms.clear();
    this.airs.clear();
    this.work = 0;
    this.until = budget;
  }
  late() {
    return this.work > this.until;
  }

  // Our level-k cell: where we are in it, in its lattice units; its id;
  // and its index in its parent.
  frame(k) {
    let fr = this.frames.get(k);
    if (fr !== undefined) return fr;
    const { pos, space } = this.flight;
    fr = null;
    if (space.planned?.(k) ?? true) {
      const rec = pos.levels(Math.min(k, pos.F), Math.max(k, pos.F)).find((r) => r.level === k);
      if (rec) {
        const R = this.R;
        fr = {
          k,
          seed: levelSeed(k),
          here: rec.L.map((x, a) => x + rec.f[a]),
          sig: rec.sig,
          id: rec.id,
          own: rec.id.map((x) => ((x % R) + R) % R),
        };
      }
    }
    this.frames.set(k, fr);
    return fr;
  }

  // The cell at offset c from ours at level k: its id, a name for it, and
  // its room (if it has one).
  id(k, c) {
    return wrapId(this.frame(k).id.map((x, a) => x + c[a]), this.R);
  }
  key(k, c) {
    return k + ':' + this.id(k, c).join();
  }
  room(k, c) {
    const n = this.cell(k, c);
    let r = this.rooms.get(n);
    if (r === undefined) {
      this.work++;
      const id = this.id(k, c);
      r = this.flight.space.notRoom?.(k, id) ? null : this.flight.space.room(id, this.frame(k).seed, this.flight.space.roomRule);
      this.rooms.set(n, r);
    }
    return r;
  }
  // A number for cell c of level k (ids repeat with period R^2).
  cell(k, c) {
    const id = this.frame(k).id, P = this.R * this.R;
    const w = (a) => (((id[a] + c[a]) % P) + P) % P;
    return ((k + 4096) * P + w(2)) * P * P + w(1) * P + w(0);
  }

  // The parent of cell c of level k (an offset at level k - 1), and the
  // cell's index in it.
  parent(k, c) {
    const R = this.R, own = this.frame(k).own;
    const p = c.map((x, a) => Math.floor((own[a] + x) / R));
    return { c: p, i: c.map((x, a) => own[a] + x - p[a] * R) };
  }

  // The coarsest air that cell c of level k lies in: the room it is in
  // ({ k, c } at some coarser level; c null for air that is not of the
  // halls, such as the arcology's city), or 'sky', or null if none. (In a
  // room's box, that is: its furniture and its own openings are not looked
  // at.)
  air(k, c) {
    const n = this.cell(k, c);
    let a = this.airs.get(n);
    if (a === undefined) this.airs.set(n, (a = this.airOf(k, c)));
    return a;
  }
  airOf(k, c) {
    const f = this.flight;
    const atMiddle = (j, x) => this.toUs(this.frame(j), x.map((y) => y * this.R + this.R / 2));
    let found = null;
    for (let j = k, x = c; j > k - UP; j--) {
      if (!this.frame(j - 1)) {
        // Coarser than the levels that are halls: ask the world itself.
        const v = atMiddle(j, x);
        if (f.sky + v[1] > 0) return 'sky';
        if (f.here.some((r) => r.level < j && f.airAt(r, v) < 0)) found = { k: j - 1, c: null };
        break;
      }
      const { c: p, i } = this.parent(j, x);
      const r = this.room(j - 1, p);
      if (r && i[0] >= M && i[0] < this.R - M && i[2] >= M && i[2] < this.R - M && i[1] >= M && i[1] < M + r.H) found = { k: j - 1, c: p };
      x = p;
    }
    // Above the ground there is only sky.
    if (!found && f.sky + atMiddle(k, c)[1] > 0) return 'sky';
    return found;
  }

  // A point of level k (lattice units across from the corner of our cell)
  // as an offset from us in level-F cells; and the same with, fourth, the
  // clearance there (so that the pilot knows when it is there: in a small
  // room, by being well inside it).
  toUs(fr, p) {
    return p.map((x, a) => (x - fr.here[a]) / fr.sig);
  }
  point(k, p) {
    const f = this.flight, v = this.toUs(this.frame(k), p);
    return [...v, Math.max(f.sky + v[1], ...f.here.map((r) => -f.airAt(r, v) / r.sig))];
  }

  // Is the way straight from a to b (offsets from us, level-F cells) in air?
  // Stepped along by the clearance at each point (which no surface is
  // nearer than), so that a surface however near is found; not if it would
  // take too many steps (grazing one).
  clear(a, b) {
    const f = this.flight, len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const at = (t) => a.map((x, k) => x + ((b[k] - x) * t) / len);
    const room = (v) => Math.max(f.sky + v[1], ...f.here.map((r) => -f.airAt(r, v) / r.sig));
    let t = 0;
    for (let i = 0; i < 48 && !this.late(); i++) {
      this.work += 8;
      const c = room(at(t));
      if (!(c > 0)) return false;
      t += c;
      if (t >= len) return room(b) > 0;
    }
    return false;
  }

  // The middle of the room r at c, in level-k units.
  middle(c, r) {
    return c.map((x, a) => x * this.R + r.middle[a]);
  }

  // The points of going through opening o of the room at c (level k), in
  // level-k units: out in front of it, then beyond it, each also in the
  // lane down the middle of the room it is in (doors, and the outer
  // windows and arches, are in line with the piers that may stand in a
  // room; the lanes between them are clear).
  through(c, o) {
    const R = this.R, C = R / 2;
    const at = c.map((x, a) => x * R + o.at[a]);
    const front = at.map((x, a) => x - o.e[a] * PAST), beyond = at.map((x, a) => x + o.e[a] * PAST);
    const d = c.map((x, a) => x + o.e[a]);
    // (Only in a room with piers: elsewhere, nothing is in the way.)
    const lane = (p, x, k) => (this.room(k, x)?.piers ? [p.map((v, a) => (o.e[a] !== 0 || a === 1 ? v : x[a] * R + C))] : []);
    return [lane(front, c, o.k), [front], [beyond], lane(beyond, d, o.k)];
  }

  // The points of a list of steps ({ k, c, o, up }: through opening o of
  // the room at c of level k), ending in the middle of the last room come
  // into, or, coming up into coarser air, a little way into it.
  stepPoints(steps) {
    const pts = [];
    for (const s of steps) {
      const [lane0, [front], [beyond], lane1] = this.through(s.c, { ...s.o, k: s.k });
      for (const p of [...lane0, front, beyond]) pts.push([s.k, p]);
      if (s.up) pts.push([s.k, beyond.map((x, a) => x + s.o.e[a] * 2 * PAST)]);
      else for (const p of lane1) pts.push([s.k, p]);
    }
    const s = steps.at(-1);
    if (s && !s.up) {
      const d = s.c.map((x, a) => x + s.o.e[a]), r = this.room(s.k, d);
      if (r) pts.push([s.k, this.middle(d, r)]);
    }
    return pts;
  }

  // Ways in from the room at c of level k (through its face only, if
  // given: [0, 0, 1] its ceiling, and so on): for each room of the next
  // level with an opening onto it, the way through that: points, and the
  // room got to ({ k: k + 1, c }).
  waysIn(k, c, only = null) {
    const sub = this.frame(k + 1), r = this.frame(k) && this.room(k, c);
    if (!sub || !r) return [];
    const R = this.R, C = R / 2;
    const lo = [M, M, M], hi = [R - M, M + r.H, R - M];
    const ways = [];
    for (const a of [0, 1, 2]) for (const side of [-1, 1]) {
      if ((only && only[a] !== side) || this.late()) continue;
      // The layer of cells just outside this face of the room, and which
      // way from them is into it.
      const at = side < 0 ? lo[a] - 1 : hi[a];
      const e = [0, 0, 0];
      e[a] = -side;
      const [b, d] = [0, 1, 2].filter((x) => x !== a);
      for (let u = lo[b]; u < hi[b]; u++) for (let w = lo[d]; w < hi[d]; w++) {
        const i = [0, 0, 0];
        i[a] = at;
        i[b] = u;
        i[d] = w;
        // Its offset at level k + 1 (see parent).
        const cc = i.map((x, q) => c[q] * R + x - sub.own[q]);
        const rr = this.room(k + 1, cc);
        if (!rr) continue;
        const o = this.flight.space.openings(this.id(k + 1, cc), sub.seed, this.flight.space.roomRule).find((o) => o.e[a] === e[a]);
        if (!o) continue;
        // Its points, in level-k units: out in front of the mouth (in our
        // lane), just inside, in its own lane, its middle.
        const base = c.map((x, q) => x * R + i[q]);
        const mouth = base.map((x, q) => x + o.at[q] / R);
        const front = mouth.map((x, q) => x + e[q] * 1.5);
        const inside = mouth.map((x, q) => x - (e[q] * PAST) / R);
        const lane = inside.map((x, q) => (e[q] !== 0 || q === 1 ? x : base[q] + C / R));
        const mid = base.map((x, q) => x + rr.middle[q] / R);
        const face = [0, 0, 0];
        face[a] = side;
        const points = rr.piers ? [[k, front], [k, inside], [k, lane], [k, mid]] : [[k, front], [k, inside], [k, mid]];
        ways.push({ points, to: { k: k + 1, c: cc }, down: a === 1, face });
      }
    }
    return ways;
  }

  // What each opening of the room at c of level k leads to: another room
  // of its level (across), or coarser air (up: see air); niches left out.
  around(k, c) {
    const out = [];
    for (const o of this.flight.space.openings(this.id(k, c), this.frame(k).seed, this.flight.space.roomRule)) {
      const d = c.map((x, a) => x + o.e[a]);
      const air = this.air(k, d);
      if (air) out.push({ o, d, up: air });
      else if (this.room(k, d)) out.push({ o, d, across: true });
    }
    return out;
  }

  // The rooms of level k next to the room at c: the ways to their middles.
  waysAcross(k, c) {
    return this.around(k, c)
      .filter((w) => w.across)
      .map((w) => ({ points: this.stepPoints([{ k, c, o: w.o }]), to: { k, c: w.d }, down: w.o.e[1] !== 0 }));
  }

  // Search the rooms of level k from the room at c (breadth first, the
  // order of openings shuffled by rnd; at most ACROSS rooms) for a way up
  // into air for which good(air) holds. Returns the way as steps (see
  // stepPoints), or null; and how each room looked through was reached.
  searchUp(k, c, rnd, good) {
    const seen = new Map([[this.key(k, c), null]]);
    const queue = [c];
    for (let n = 0; queue.length && n < ACROSS && !this.late(); n++) {
      const x = queue.shift();
      const ways = shuffle(this.around(k, x), rnd);
      for (const w of ways) {
        if (w.up) {
          if (!good(w.up)) continue;
          const steps = [{ k, c: x, o: w.o, up: w.up }];
          for (let s = seen.get(this.key(k, x)); s; s = seen.get(this.key(k, s.c))) steps.unshift(s);
          return { steps, seen };
        }
        const key = this.key(k, w.d);
        if (seen.has(key)) continue;
        seen.set(key, { k, c: x, o: w.o });
        queue.push(w.d);
      }
    }
    return { steps: null, seen };
  }

  // A way out of the room at c of level k, up into air not named in been
  // (a Set of keys; air that is not a room of the halls is always good):
  // through the rooms of its level; or, failing that, through the wall of
  // one of those rooms into a room of our level beyond it that we have not
  // been in (through the rooms of the next level in the wall); or, failing
  // both, up anywhere (back the way we came). Returns the way's points
  // ([level, point] pairs) and the air it comes out in, or null.
  wayOut(k, c, been, rnd) {
    const fresh = (air) => air === 'sky' || !air.c || !been.has(this.key(air.k, air.c));
    const near = this.searchUp(k, c, rnd, fresh);
    if (near.steps) return { points: this.stepPoints(near.steps), to: near.steps.at(-1).up };
    // (A way through a wall is long, and slow to go: as often as not, and
    // if it is very long, up the way we came instead.)
    const through = rnd() < 0.5 && this.throughWall(k, c, near.seen, been, rnd);
    if (through && through.points.length <= LONGEST) return through;
    const any = this.searchUp(k, c, rnd, () => true);
    return any.steps ? { points: this.stepPoints(any.steps), to: any.steps.at(-1).up } : null;
  }

  // Through a wall: from the rooms of level k reached from the room at c
  // (seen, as searchUp leaves it), into the wall between one of them and a
  // room of its level beyond it, not reached and not in been; through the
  // rooms of the next level in the wall, looking nearest first toward that
  // room; and out into it. (Between two neighbouring rooms there is almost
  // always such a way.) Returns as wayOut does, or null.
  throughWall(k, c, seen, been, rnd) {
    // The walls of the nearest rooms first (seen is in the order they were
    // reached), each room's in no particular order.
    const walls = [];
    for (const name of [...seen.keys()].slice(0, 12)) {
      const x = this.find(name), these = [];
      for (const a of [0, 1, 2]) for (const side of [-1, 1]) {
        const e = [0, 0, 0];
        e[a] = side;
        const d = x.c.map((v, q) => v + e[q]);
        const key = this.key(k, d);
        if (seen.has(key) || been.has(key) || !this.room(k, d)) continue;
        these.push({ x, e, d, key });
      }
      walls.push(...shuffle(these, rnd));
    }
    // Of the ways found through the first few walls, the shortest.
    let best = null;
    for (const { x, e, d, key } of walls.slice(0, 6)) {
      if (this.late()) break;
      // The ways in from x's side of that wall: a few, from all along it.
      const ins = shuffle(this.waysIn(k, x.c, e), rnd).slice(0, 4);
      for (const w of ins) {
        const steps = this.toward(k + 1, w.to.c, k, d, key, rnd);
        if (!steps) continue;
        // Across our level's rooms to x, into the wall, and on through.
        const back = [];
        for (let s = seen.get(this.key(k, x.c)); s; s = seen.get(this.key(k, s.c))) back.unshift(s);
        const points = [...this.stepPoints(back), ...w.points, ...this.stepPoints(steps)];
        if (!best || points.length < best.points.length) best = { points, to: { k, c: d } };
      }
      if (best) break;
    }
    return best;
  }

  // From the room at c of level j, through the rooms of that level, nearest
  // first to the room box of the room at d of level k (= j - 1), to an
  // opening up into that room (named key). At most ACROSS rooms. Returns
  // the steps, or null.
  toward(j, c, k, d, key, rnd) {
    const R = this.R, own = this.frame(j).own, box = this.room(k, d);
    // How far a cell of level j is from the room's box, in level-j cells.
    const lo = d.map((v, a) => v * R + M), hi = d.map((v, a) => v * R + (a === 1 ? M + box.H : R - M));
    const far = (x) => x.reduce((s, v, a) => s + Math.max(0, lo[a] - (own[a] + v), own[a] + v + 1 - hi[a]), 0);
    const seen = new Map([[this.key(j, c), null]]);
    let open = [c];
    for (let n = 0; open.length && n < ACROSS && !this.late(); n++) {
      open.sort((p, q) => far(p) - far(q));
      const x = open.shift();
      for (const w of shuffle(this.around(j, x), rnd)) {
        if (w.up) {
          if (w.up === 'sky' || !w.up.c || this.key(w.up.k, w.up.c) !== key) continue;
          const steps = [{ k: j, c: x, o: w.o, up: w.up }];
          for (let s = seen.get(this.key(j, x)); s; s = seen.get(this.key(j, s.c))) steps.unshift(s);
          return steps;
        }
        const name = this.key(j, w.d);
        if (seen.has(name)) continue;
        seen.set(name, { k: j, c: x, o: w.o });
        open.push(w.d);
      }
    }
    return null;
  }

  // A way's points as the pilot wants them: offsets from us with the
  // clearance at each. If the first is not in plain sight (we may be in an
  // opening, not in our room proper), by way of the middle of the room
  // `via` ({ k, c }) if that is; null if neither is, or if any point is not
  // in air (furniture can stand over a way in through a floor). from: where
  // the way sets out from, if not from us (the end of a way it carries on).
  points(way, via, from = [0, 0, 0]) {
    const pts = way.points.map(([k, p]) => this.point(k, p));
    if (pts.some((p) => !(p[3] > 0))) return null;
    if (this.clear(from, pts[0])) return pts;
    const r = via && this.frame(via.k) && this.room(via.k, via.c);
    if (!r) return null;
    const middle = this.point(via.k, this.middle(via.c, r));
    return middle[3] > 0 && this.clear(from, middle) && this.clear(middle, pts[0]) ? [middle, ...pts] : null;
  }

  // Out in air that is not a room of the halls (the arcology's city, or a
  // gallery in it): the level of the halls rooms that open onto it, if the
  // world says where they do (see ENTRANCES in spaces/arcology.js).
  outdoors() {
    const { space, sky } = this.flight, k = space.entrances?.level;
    if (k === undefined || sky > 0 || !this.frame(k) || this.here()) return null;
    return k;
  }

  // From out there, the ways into those rooms whose openings face us: in
  // line with the opening a few cells out, out in front of it, just inside,
  // the room's middle (and its lane, if piers stand in it). As waysIn has
  // them; nearest first, at most n.
  waysFromCity(n = 24) {
    const { space } = this.flight, k = space.entrances.level, fr = this.frame(k);
    const R = this.R, P = R * R;
    const near = [];
    for (const { id, e, at: o } of space.entrances.list) {
      const c = id.map((x, a) => ((((x - fr.id[a]) % P) + P + P / 2) % P) - P / 2);
      const at = c.map((x, a) => x * R + o[a]);
      const us = fr.here.map((x, a) => x - at[a]);
      const ahead = us[0] * e[0] + us[2] * e[2];
      if (ahead <= 0) continue;
      near.push({ c, e, at, far: Math.hypot(...us) });
    }
    near.sort((a, b) => a.far - b.far);
    const ways = [];
    for (const { c, e, at } of near.slice(0, n)) {
      const r = this.room(k, c);
      if (!r) continue;
      const out = at.map((x, a) => x + e[a] * 3 * R), front = at.map((x, a) => x + e[a] * PAST), inside = at.map((x, a) => x - e[a] * PAST);
      const lane = inside.map((x, a) => (e[a] !== 0 || a === 1 ? x : c[a] * R + R / 2));
      const points = [out, front, inside, ...(r.piers ? [lane] : []), this.middle(c, r)].map((p) => [k, p]);
      ways.push({ points, to: { k, c }, down: false, face: e.map((x) => -x) });
    }
    return ways;
  }

  // Are we inside the room at c of level k, at least margin units from its
  // walls?
  inside(k, c, margin = 1) {
    const fr = this.frame(k), r = fr && this.room(k, c);
    if (!r) return false;
    const R = this.R;
    return [0, 1, 2].every((a) => {
      const lo = c[a] * R + M + margin, hi = c[a] * R + (a === 1 ? M + r.H : R - M) - margin;
      return fr.here[a] > lo && fr.here[a] < hi;
    });
  }

  // The room we are in, as { k, c }, if we are in a room of the halls (not
  // in an opening or niche, nor out under the sky).
  here() {
    const k = this.flight.room;
    if (k === null || this.flight.sky > 0 || !this.frame(k)) return null;
    return this.room(k, [0, 0, 0]) ? { k, c: [0, 0, 0] } : null;
  }

  // The room named (see key), as { k, c } from where we are now.
  find(name) {
    const [k, id] = name.split(':');
    const fr = this.frame(+k);
    if (!fr) return null;
    const P = this.R * this.R;
    return { k: +k, c: id.split(',').map((x, a) => ((((+x - fr.id[a]) % P) + P + P / 2) % P) - P / 2) };
  }
}

function shuffle(list, rnd) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
