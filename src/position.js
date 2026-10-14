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

const ALMOST_ONE = 1 - 2 ** -53;

// The pairs of axes whose sum and difference are tracked: (x, y), (z, y), (x, z).
export const DIAGONALS = [[0, 1], [2, 1], [0, 2]];

export class Position {
  constructor(R, defaultDigit, frac = [0.5, 0.5, 0.5]) {
    this.R = R;
    this.defaultDigit = defaultDigit;
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

  // Move by a displacement given in level-F cell units.
  move(delta) {
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
    for (let j = Math.min(F, hi + 1); j >= lo - 1; j--) dg.set(j, this.digit(j));
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
      const L = [0, 0, 0];
      const f = [0, 0, 0];
      const id = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const up = uu[a] >= 0.5;
        L[a] = d[a] + (up ? 1 : 0);
        f[a] = up ? -cc[a] : uu[a];
        id[a] = own[a] + R * par[a];
      }
      out.push({ level: k, L, f, id, sig: Math.pow(R, k + 1 - F) });
    }

    // Diagonal surfaces need the same care. How far we are from the plane
    // x + y = c is (Lx + Ly - c) + (fx + fy), and close to one the two
    // offsets cancel, leaving nothing of a distance much smaller than they
    // are. So each sum and difference of two coordinates is carried as its
    // own lattice number and small offset: Lp + fp and Lm + fm, for the axis
    // pairs in DIAGONALS. At the finest level they come from L and f. Going
    // coarser, a position is its digit plus a twenty-fourth of the position
    // one level finer, so a sum is the digits' sum plus a twenty-fourth of the
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
    }
    return out;
  }
}
