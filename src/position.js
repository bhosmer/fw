// A position in a world that is infinite in both scale directions.
//
// Space is a hierarchy of cubic cells: every level-k cell is divided into R^3
// level-(k+1) cells. There is no top level and no bottom level, so a position
// cannot be a vector from an origin. Instead it is:
//
//   F       the level we are currently "working at" (any integer)
//   frac    where we are inside our level-F cell, each component in [0,1)
//   digits  for each level j <= F, the index (0..R-1 per axis) of our level-j
//           cell within its level-(j-1) parent
//
// Digits above the ones we have touched are filled in lazily by
// defaultDigit(level), a pure function, so the world extends upward forever
// and is the same every time you return to it. Levels below F have no stored
// state at all: they are just further digits of frac.

export const ALMOST_ONE = 1 - 2 ** -53;

// The pairs of axes whose sum and difference are tracked: (x, y), (z, y), (x, z).
export const DIAGONALS = [[0, 1], [2, 1], [0, 2]];

export class Position {
  // slants: whole-number directions (other than the axes and DIAGONALS) whose
  // planes a space needs exactly, at any depth: see levels.
  constructor(R, defaultDigit, frac = [0.5, 0.5, 0.5], slants = []) {
    this.R = R;
    this.defaultDigit = defaultDigit;
    this.slants = slants;
    this.F = 0;
    this.frac = frac.slice();
    this.digits = new Map();
  }

  digit(j) {
    let d = this.digits.get(j);
    if (!d) {
      d = this.defaultDigit(j).slice();
      this.digits.set(j, d);
    }
    return d;
  }

  // Move by a displacement given in level-F cell units. (One that is no
  // number would carry for ever: better to fail.)
  move(delta) {
    if (!delta.every(Number.isFinite)) throw new Error(`no such move: ${delta}`);
    for (let a = 0; a < 3; a++) {
      let x = this.frac[a] + delta[a];
      const n = Math.floor(x);
      if (n !== 0) {
        x -= n;
        this.carry(this.F, a, n);
      }
      this.frac[a] = Math.min(x, ALMOST_ONE);
    }
  }

  carry(j, a, n) {
    const R = this.R;
    while (n !== 0) {
      const d = this.digit(j);
      const v = d[a] + n;
      n = Math.floor(v / R);
      d[a] = v - n * R;
      j--;
    }
  }

  // Work one level finer: our level-F cell becomes the parent.
  refine() {
    const R = this.R;
    const d = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const t = this.frac[a] * R;
      d[a] = Math.min(R - 1, Math.floor(t));
      this.frac[a] = Math.min(t - d[a], ALMOST_ONE);
    }
    this.F++;
    this.digits.set(this.F, d);
  }

  // Work one level coarser: our level-F digit folds back into frac.
  coarsen() {
    const R = this.R;
    const d = this.digit(this.F);
    for (let a = 0; a < 3; a++) {
      this.frac[a] = Math.min((d[a] + this.frac[a]) / R, ALMOST_ONE);
    }
    this.digits.delete(this.F);
    this.F--;
  }

  // Describe where we are relative to each level in [lo, hi], in the form the
  // shaders need. For level k, lengths are measured in "lattice units" = the
  // size of a level-(k+1) cell, so a level-k cell spans 0..R.
  //
  //   L    nearest lattice point to us inside our level-k cell (ints, 0..R)
  //   f    our offset from that lattice point, in [-0.5, 0.5]
  //   id   which cell this is, as far as variation is concerned: its index in
  //        its parent plus R times the parent's index in the grandparent
  //   sig  lattice units of this level per level-F cell
  //
  // The split into L and f is what keeps everything exact. All architecture is
  // anchored at lattice points, so a distance to a nearby feature is
  // (L - anchor) + f: an exact integer, usually zero, plus a small float.
  // f is computed without ever subtracting nearly-equal numbers (u and its
  // complement cu are carried separately), so it stays accurate however close
  // we are to a surface of a level far coarser than F.
  levels(lo, hi) {
    const R = this.R;
    const F = this.F;
    const dg = new Map();
    const u = new Map();
    const cu = new Map();

    u.set(F, this.frac);
    cu.set(F, this.frac.map((x) => 1 - x));
    for (let j = F + 1; j <= hi + 1; j++) {
      const prev = u.get(j - 1);
      const d = [0, 0, 0];
      const uu = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const t = prev[a] * R;
        d[a] = Math.min(R - 1, Math.floor(t));
        uu[a] = t - d[a];
      }
      dg.set(j, d);
      u.set(j, uu);
      cu.set(j, uu.map((x) => 1 - x));
    }
    for (let j = Math.min(F, hi + 1); j >= lo - 2; j--) dg.set(j, this.digit(j));
    for (let j = F - 1; j >= lo + 1; j--) {
      const d = dg.get(j + 1);
      const un = u.get(j + 1);
      const cn = cu.get(j + 1);
      u.set(j, [0, 1, 2].map((a) => (d[a] + un[a]) / R));
      cu.set(j, [0, 1, 2].map((a) => (R - 1 - d[a] + cn[a]) / R));
    }

    const out = [];
    for (let k = lo; k <= hi; k++) {
      const d = dg.get(k + 1);
      const uu = u.get(k + 1);
      const cc = cu.get(k + 1);
      const own = dg.get(k);
      const par = dg.get(k - 1);
      const gpar = dg.get(k - 2);
      const L = [0, 0, 0];
      const f = [0, 0, 0];
      const id = [0, 0, 0];
      const pid = [0, 0, 0]; // the parent cell's id
      for (let a = 0; a < 3; a++) {
        const up = uu[a] >= 0.5;
        L[a] = d[a] + (up ? 1 : 0);
        f[a] = up ? -cc[a] : uu[a];
        id[a] = own[a] + R * par[a];
        pid[a] = par[a] + R * gpar[a];
      }
      out.push({ level: k, L, f, id, pid, sig: Math.pow(R, k + 1 - F) });
    }

    // Diagonal surfaces need the same care. How far we are from the plane
    // x + y = c is (Lx + Ly - c) + (fx + fy), and close to one the two
    // offsets cancel, leaving nothing of a distance much smaller than they
    // are. So each sum and difference of two coordinates is carried as its
    // own lattice number and small offset: Lp + fp and Lm + fm, for the axis
    // pairs in DIAGONALS. At the finest level they come from L and f. Going
    // coarser, a position is its digit plus an Rth of the position one
    // level finer, so a sum is the digits' sum plus an Rth of the
    // finer sum: whenever the finer lattice number divides evenly, the small
    // offset is carried up scaled and never added to anything large.
    for (let i = out.length - 1; i >= 0; i--) {
      const rec = out[i];
      const finer = out[i + 1];
      const d = dg.get(rec.level + 1);
      rec.Lp = [0, 0, 0];
      rec.fp = [0, 0, 0];
      rec.Lm = [0, 0, 0];
      rec.fm = [0, 0, 0];
      DIAGONALS.forEach(([a, b], p) => {
        for (const [sign, Ls, fs] of [[1, 'Lp', 'fp'], [-1, 'Lm', 'fm']]) {
          let n, g;
          if (!finer) {
            n = rec.L[a] + sign * rec.L[b];
            g = rec.f[a] + sign * rec.f[b];
          } else {
            const q = Math.round(finer[Ls][p] / R);
            const m = finer[Ls][p] - q * R;
            n = d[a] + sign * d[b] + q;
            g = m === 0 ? finer[fs][p] / R : (m + finer[fs][p]) / R;
          }
          const r = Math.round(g);
          rec[Ls][p] = n + r;
          rec[fs][p] = g - r;
        }
      });
      // And the same for each slant m: m . (L + f), carried as Ls + fs. (A
      // plane across m is then exact however close we are to it, as the
      // diagonals' are.)
      rec.Ls = this.slants.map(() => 0);
      rec.fs = this.slants.map(() => 0);
      this.slants.forEach((m, k) => {
        let n, g;
        if (!finer) {
          n = m[0] * rec.L[0] + m[1] * rec.L[1] + m[2] * rec.L[2];
          g = m[0] * rec.f[0] + m[1] * rec.f[1] + m[2] * rec.f[2];
        } else {
          const q = Math.round(finer.Ls[k] / R);
          const mm = finer.Ls[k] - q * R;
          n = m[0] * d[0] + m[1] * d[1] + m[2] * d[2] + q;
          g = mm === 0 ? finer.fs[k] / R : (mm + finer.fs[k]) / R;
        }
        const r = Math.round(g);
        rec.Ls[k] = n + r;
        rec.fs[k] = g - r;
      });
    }
    return out;
  }
}

// A level's record (rec, of Position.levels) as one S times finer would
// see it, where everything of the level within reach of us (level-F cells)
// is one corner of it: the point where the level's planes that pass within
// reach meet (p0), its point scaled about p0 by S. So drawn, a level too
// coarse for the shader's numbers is drawn as it is, near us: every face of
// a level is on a plane of a family carried exactly (an axis, a diagonal, or
// one of the slants) at a whole-number offset (see pieces.js), so within
// reach the level is a cone about p0, and scaling about its point leaves a
// cone as it was. Out to valid (level-F cells) from us, that is: past it the
// zoomed level shows other planes than the level's own (a plane through
// p0's neighbourhood that does not pass through p0 itself, S times nearer
// than it is), and no ray is to go further (see uValid in shaders.js).
// Returns { rec, valid }: the record, its sig S times rec's and its
// offsets from the planes moved; and valid, no more than reach (0: it holds
// nowhere). least: how near the level's nearest surface is (level-F cells);
// slanted: whether the level is cut by the slants at all (if not, they are
// no planes of its, and do not bound valid).
export function zoomed(rec, slants, S, reach, { least = 0, slanted = true } = {}) {
  const sig = rec.sig;
  // Each family: its whole-number normal n, the whole-number offset K of
  // its plane nearest us (n . x = K), and our offset from it f, as rec has
  // them (the diagonals' sums and differences, and the slants, each carried
  // apart from the axes: see levels); and whether the level has planes of it.
  const fams = [];
  for (let a = 0; a < 3; a++) fams.push({ n: AXES[a], K: rec.L[a], f: rec.f[a], its: true });
  DIAGONALS.forEach(([a, b], p) => {
    fams.push({ n: AXES[a].map((x, i) => x + AXES[b][i]), K: rec.Lp[p], f: rec.fp[p], its: true });
    fams.push({ n: AXES[a].map((x, i) => x - AXES[b][i]), K: rec.Lm[p], f: rec.fm[p], its: true });
  });
  slants.forEach((m, k) => fams.push({ n: m, K: rec.Ls[k], f: rec.fs[k], its: slanted }));
  for (const F of fams) F.len = Math.hypot(...F.n);
  const its = fams.filter((F) => F.its);
  // The planes within r of us that meet in one point, nearest first: each
  // added unless it misses where those before it meet (decided exactly, in
  // whole numbers: see meets); and of the rest, any that passes through
  // where they meet after all. Where we are from that point, p0 (u, level-F
  // cells: the least that is on all of them, n . u = f / sig). And how far
  // from us the zoom holds: no further than reach (no ray goes further), nor
  // than the nearest plane not through p0 (of a family through it, the next
  // one along; of another, the nearer of the two either side of p0), less
  // what single precision may round its offset by in the shader, as moved
  // (see MOVED_ROUNDING).
  const about = (r) => {
    const met = [], basis = [];
    for (const F of its.filter((F) => Math.abs(F.f) / (F.len * sig) < r).sort((a, b) => Math.abs(a.f) / a.len - Math.abs(b.f) / b.len)) {
      if (independent(basis, F)) basis.push(F), met.push(F);
      else if (meets(basis, F)) met.push(F);
    }
    for (const F of its) if (!met.includes(F) && basis.length && !independent(basis, F) && meets(basis, F)) met.push(F);
    const u = leastOn(basis.map((F) => F.n), basis.map((F) => F.f / sig));
    let near = Infinity;
    for (const F of its) {
      if (met.includes(F)) near = Math.min(near, 1 / F.len);
      else {
        const g = sig * (F.n[0] * u[0] + F.n[1] * u[1] + F.n[2] * u[2]), o = F.f - g, w = Math.abs(o - Math.round(o));
        near = Math.min(near, (Math.min(w, 1 - w) - MOVED_ROUNDING * Math.abs(F.f + (S - 1) * g)) / F.len);
      }
    }
    return { met, u, valid: Math.min(reach, Math.max(near / (sig * S) - Math.hypot(...u), 0)) };
  };
  // (Asking about planes as far as reach, the zoom can hold less far than
  // that: a plane further off, not through where the nearer meet, comes S
  // times nearer zoomed; or a point where they meet is far from us. Then
  // about planes further off, ten times as far and so on, which bring it in
  // to meet where they do (as long as their meeting is no further than the
  // zoom could hold); and nearer, a tenth as far and so on, whose meeting is
  // nearer, but no nearer than least (nearer than the level's nearest
  // surface, there is nothing to ask about). The best of those.)
  let best = about(reach);
  for (let r = reach * 10, k = 0; best.valid < reach && k < 20; r *= 10, k++) {
    const next = about(r);
    if (next.valid > best.valid) best = next;
  }
  for (let r = reach / 10, k = 0; best.valid < reach && r >= least && k < 40; r /= 10, k++) {
    const next = about(r);
    if (next.valid > best.valid) best = next;
  }
  const { met, u, valid } = best;
  const along = (F) => F.n[0] * u[0] + F.n[1] * u[1] + F.n[2] * u[2];
  // Each offset, as at p0 + S (us - p0).
  const moved = (F) => (met.includes(F) ? S * F.f : F.f + (S - 1) * sig * along(F));
  let k = 0;
  const f = [0, 1, 2].map(() => moved(fams[k++]));
  const fp = [0, 0, 0], fm = [0, 0, 0];
  for (let p = 0; p < 3; p++) (fp[p] = moved(fams[k++])), (fm[p] = moved(fams[k++]));
  const fs = slants.map(() => moved(fams[k++]));
  return { rec: { ...rec, f, fp, fm, fs, sig: sig * S }, valid };
}
// How far, as a fraction of a moved offset, the shader may have the point
// off a plane it does not pass through (see zoomed): single precision holds
// the offset to half a unit in the last place (2^-24 of it), and the offset
// plus the way to the point (no more than the offset again, within valid)
// to another half of what that sum comes to; 2^-21 is twice those three
// halves and more, for the rounding of what the cell works out from them.
const MOVED_ROUNDING = 2 ** -21;
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Whole-number vectors, as BigInts: cross and dot products, determinants.
const big = (v) => v.map((x) => BigInt(x));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const det = (a, b, c) => dot(a, cross(b, c));
// Whether plane F's normal is independent of those of the planes b (no
// more than three, themselves independent).
function independent(b, F) {
  const n = big(F.n), N = b.map((P) => big(P.n));
  if (N.length === 0) return n.some((x) => x !== 0n);
  if (N.length === 1) return cross(N[0], n).some((x) => x !== 0n);
  if (N.length === 2) return dot(n, cross(N[0], N[1])) !== 0n;
  return false;
}
// Whether plane F (n . x = K), its normal not independent of those of the
// planes b, passes through where they meet. Exactly: its normal as a
// combination of theirs, and its offset the same combination of theirs.
function meets(b, F) {
  const n = big(F.n), K = BigInt(F.K), N = b.map((P) => big(P.n)), Ks = b.map((P) => BigInt(P.K));
  if (N.length === 1) {
    const i = N[0].findIndex((x) => x !== 0n);
    return K * N[0][i] === Ks[0] * n[i];
  }
  if (N.length === 2) {
    const c = cross(N[0], N[1]);
    return K * dot(c, c) === dot(cross(n, N[1]), c) * Ks[0] + dot(cross(N[0], n), c) * Ks[1];
  }
  const D = det(N[0], N[1], N[2]);
  return K * D === det(n, N[1], N[2]) * Ks[0] + det(N[0], n, N[2]) * Ks[1] + det(N[0], N[1], n) * Ks[2];
}
// The least u with n_i . u = g_i for independent rows n (at most three).
function leastOn(n, g) {
  const r = n.length;
  if (!r) return [0, 0, 0];
  // u = n^T (n n^T)^-1 g
  const A = n.map((a) => n.map((b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const y = g.slice();
  for (let i = 0; i < r; i++) {
    for (let j = i + 1; j < r; j++) {
      const t = A[j][i] / A[i][i];
      for (let c = i; c < r; c++) A[j][c] -= t * A[i][c];
      y[j] -= t * y[i];
    }
  }
  const w = Array(r).fill(0);
  for (let i = r - 1; i >= 0; i--) {
    let s = y[i];
    for (let c = i + 1; c < r; c++) s -= A[i][c] * w[c];
    w[i] = s / A[i][i];
  }
  return [0, 1, 2].map((a) => n.reduce((s, row, i) => s + row[a] * w[i], 0));
}
