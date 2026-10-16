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
// Diving into openings takes it to finer scales and heading for open space
// to coarser ones. It keeps to a band of scales around where the tour began,
// and goes through moods: a while of drifting through big spaces, a while of
// diving into small ones.

const PACE = 0.45; // of the open way ahead per second (hand flying: 1)
const CAP = 200; // open space counts up to this many clearances
const TURN = 0.45; // most yaw, radians per second
const TILT = 0.35; // most pitch, radians per second
const PITCH_MAX = 1.2;
const KEEP = 0.8; // how much better somewhere else has to look to change course
const BAND = [-3, 5]; // levels coarser and finer than the start the tour keeps to
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
    this.on = false;
  }

  start(F) {
    this.on = true;
    this.home = F;
    this.target = null; // where we are going: a point relative to us, in level-F cells
    this.F = F; // the level target is measured in
    this.rate = [0, 0]; // yaw and pitch rates, eased
    this.spread = 0; // how far off things in view typically are, level-F cells
    this.mood = 'drift';
    this.moodLeft = 15;
    this.held = null; // a mood kept to by choice (see choose), or null
  }

  // Cycle through: moods by turns (within the band of scales), drifting only,
  // diving only. A mood kept to by choice goes on past the band.
  choose(F) {
    this.held = this.held === null ? 'drift' : this.held === 'drift' ? 'dive' : null;
    if (this.held) this.mood = this.held;
    else {
      this.home = F;
      this.moodLeft = 15;
    }
  }

  stop() {
    this.on = false;
  }

  // Bring the target to level F's units, then account for having moved by
  // delta (level-F cells).
  moved(delta, F) {
    if (!this.target) return;
    if (F !== this.F) {
      const k = Math.pow(this.R, F - this.F);
      this.target = this.target.map((x) => x * k);
      this.spread *= k;
      this.F = F;
    }
    this.target = this.target.map((x, a) => x - delta[a]);
  }

  // A new look (from Renderer.seen): a grid of distances in level-lookF cells,
  // -1 for nothing, taken with camera basis b and half-height tan, every
  // stride-th pixel of a canvas res pixels in size. F, scale (our clearance)
  // and sky (how high we are above the ground) are as of now.
  see(look, b, lookF, tan, res, stride, { F, scale, sky }) {
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

    // The mood we are in: kept to by choice, or by turns unless we have
    // strayed out of the band of scales.
    const depth = F - this.home;
    const diving = this.held ? this.held === 'dive'
      : depth > BAND[1] ? false : depth < BAND[0] ? true : this.mood === 'dive';

    // How good going toward grid point (i, j) looks, and how far along it to
    // aim.
    const fwd = b.fwd;
    const score = (i, j, jitter) => {
      const m0 = j * w + i;
      const d = D[m0];
      if (d < 1.5 * scale) return { s: -Infinity };
      const dx = dirs[m0 * 3], dy = dirs[m0 * 3 + 1], dz = dirs[m0 * 3 + 2];
      const turn = Math.acos(Math.max(-1, Math.min(1, dx * fwd[0] + dy * fwd[1] + dz * fwd[2])));
      // (Steep views are avoided, except diving down at the ground.)
      const pitch = Math.max(0, Math.abs(dy) - (diving && sky > 0 && dy < 0 ? 0.9 : 0.45)) * 3;
      // Off into an empty sky is no tour.
      const away = dist[m0] < 0 && dy > 0.15 ? 2 : 0;
      const base = -1.2 * turn - pitch - away + jitter;
      let s = -Infinity, aim = 0;
      if (!diving) {
        // Drifting: out into open space.
        s = base + Math.log(d / scale);
        aim = 0.6 * d;
      } else if (dist[m0] >= 0) {
        // Diving: at a surface (coming close to one, finer openings show).
        s = base + 0.5;
        aim = 0.85 * d;
      }
      // Out over the ground, a way down into it is an opening too (seen
      // nearly edge on, a pit is not much deeper than the ground beyond it).
      if (sky > 0 && dy < 0) {
        const below = -(sky + dy * d);
        if (below > 0.3 * scale) {
          // (Diving, the nearer the better.)
          const down = sky / -dy;
          const t = base + (diving ? 2.4 * Math.min(2, Math.log(1 + below / scale)) - 0.5 * Math.log(down / scale)
                                   : 0.8 * Math.min(3, Math.log(1 + below / scale)));
          if (t > s) {
            s = t;
            aim = down + 0.5 * (d - down);
          }
        }
      }
      for (let r = 2; r <= 8; r *= 2) {
        const m = ring(i, j, r);
        if (m < 0 || d < 1.3 * m) continue;
        // How clearly it is an opening, and how big the space beyond it is
        // for us: diving looks for small spaces, drifting for big ones.
        const hole = Math.min(2, Math.log(d / m));
        const beyond = Math.log(Math.max(d - m, 1e-30) / scale);
        const t = base + (diving ? 1 + 1.5 * hole - 0.9 * Math.max(beyond, 0) - 0.3 * Math.log(m / scale)
                                 : 0.7 * hole + 0.4 * beyond);
        if (t > s) {
          s = t;
          // Aim past the mouth, halfway to what lies beyond it.
          aim = m + 0.5 * (d - m);
        }
      }
      return { s, aim };
    };

    let best = null;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const { s, aim } = score(i, j, 0.15 * Math.random());
      if (s > -Infinity && (!best || s > best.s)) {
        const o = (j * w + i) * 3;
        best = { s, go: [dirs[o] * aim, dirs[o + 1] * aim, dirs[o + 2] * aim] };
      }
    }

    // How the current target looks now, if it is still in view and clear.
    let current = null;
    if (this.target) {
      const len = Math.hypot(...this.target);
      const dir = this.target.map((x) => x / len);
      const z = dot(dir, b.fwd);
      if (z > 0.2 && len > 2 * scale) {
        const u = dot(dir, b.right) / z / tan, v = dot(dir, b.up) / z / tan;
        const i = Math.floor((u * res[1] + res[0]) / 2 / stride), j = Math.floor((v * res[1] + res[1]) / 2 / stride);
        if (i >= 1 && j >= 1 && i < w - 1 && j < h - 1) {
          let clear = 0, s = -Infinity;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            clear = Math.max(clear, at(i + di, j + dj));
            s = Math.max(s, score(i + di, j + dj, 0.15).s);
          }
          if (clear > 0.8 * len && s > -Infinity) current = s;
        }
      }
    }

    if (current !== null && !(best && best.s > current + KEEP)) return;
    if (best && best.s > -1.5) {
      this.target = best.go;
      this.chose = best; // (for looking into what it does)
      this.F = F;
      this.picks = (this.picks || 0) + 1;
      return;
    }
    // Nothing worth going to in sight: turn toward the more open side.
    let left = 0, right = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) (i < w / 2 ? (left += Math.log(at(i, j))) : (right += Math.log(at(i, j))));
    const side = left > right ? -1 : 1;
    this.target = [0, 1, 2].map((a) => (b.fwd[a] * 0.5 + b.right[a] * side) * 4 * scale);
    this.F = F;
  }

  // Turn toward the target, keeping off surfaces: away() gives the way
  // directly away from the nearest. While steered (the view is being turned
  // by hand) it only flies on the way we face, and looks for somewhere to go
  // afresh once that stops. Returns the velocity wished for, as from the keys.
  fly(dt, controls, scale, away, steered) {
    if (steered) {
      this.target = null;
      this.rate = [0, 0];
    }
    this.moodLeft -= dt;
    if (!this.held && this.moodLeft <= 0) {
      this.mood = this.mood === 'dive' ? 'drift' : 'dive';
      this.moodLeft = this.mood === 'dive' ? 10 + 10 * Math.random() : 15 + 15 * Math.random();
    }
    const { fwd } = controls.basis();
    if (this.target && (Math.hypot(...this.target) < 2 * scale || dot(this.target, fwd) < 0)) this.target = null;
    let err = 0;
    if (this.target) {
      let dir = unit(this.target);
      const near = this.spread > 0 ? 1 - scale / (ROOM * this.spread) : 0;
      if (near > 0) {
        const n = away();
        dir = unit(dir.map((x, a) => x + n[a] * near * 0.8));
      }
      const yaw = Math.atan2(dir[0], -dir[2]);
      const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(dir[1])));
      const ey = Math.atan2(Math.sin(yaw - controls.yaw), Math.cos(yaw - controls.yaw));
      const ep = pitch - controls.pitch;
      const ease = 1 - Math.exp(-dt / 0.6);
      this.rate[0] += (Math.max(-TURN, Math.min(TURN, ey * 0.9)) - this.rate[0]) * ease;
      this.rate[1] += (Math.max(-TILT, Math.min(TILT, ep * 0.9)) - this.rate[1]) * ease;
      err = Math.acos(Math.max(-1, Math.min(1, dot(dir, fwd))));
    } else {
      this.rate = this.rate.map((r) => r * Math.exp(-dt / 0.6));
    }
    controls.yaw += this.rate[0] * dt;
    controls.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, controls.pitch + this.rate[1] * dt));
    // Slow down while turning hard.
    const go = PACE * controls.speed * (0.3 + 0.7 * Math.max(0, Math.cos(err)));
    return controls.basis().fwd.map((x) => x * go);
  }
}
