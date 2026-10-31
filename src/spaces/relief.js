// The relief cut into the masses' faces, as listed pieces of air (plan
// .claude/design/relief-cover.md): every box the relief's decisions can make
// (each face's rectangles at both levels, as rectangle() and rectDepth()
// tile and cut it, and each ridge's rows' notches, as ridgeRow() cuts them),
// worked out once, as whole-number planes on the carried coordinates, and
// listed for the cells of the table they meet. Both copies of the relief
// (the shader's and the JavaScript's: see listedCarve, and listed in
// arcology.js) ask a cell's list in one loop, from the same rows.
//
// A piece is the intersection of its planes, each n . X <= K, X in its
// level's lattice units from the building's origin (lv 0: the city's, the
// cells one level finer; lv 1: R times finer):
// - a pocket: its rectangle's sides along the face (u = t . X) and its rows
//   (y); its back: a depth plane (n . X >= K S - dn, dn floor(depth |n|), never
//   deeper), or a terrace's floor or ceiling (12 y against 12 yin -+ FTH S)
//   and wall (n_h . X >= K S - ny yin - D, D the depth plane's own whole
//   number for the part behind the city's wall: so the wall is on the
//   lattice of n_h, and never deeper); a unit past the face (n . X <= K S +
//   ceil |n|); and its face's heights (12 y at the city's level, y finer);
// - a notch: as a pocket, but from past the ridge (a unit past the other
//   face too) to its edge (the edge's own direction, whole by construction);
// - at the city's level, also the mass's box and 2 cells, where the city's
//   cuts are asked (the gate of the city's faces, as the city's cell had it
//   before the switch).
// Over the seams where the pieces meet, the cover (cover.js), pieces of its
// own, listed as the physical ones are (one level finer, where all its
// members of that level may be).
// One level finer a piece is listed only in the skin cells of its face (as
// its face's bit in the table says); where it meets a cell it may not run
// on into (deaf: deep or plain, see VOLUME), it is listed instead, in each
// cell it is asked in, cut to that cell's run-on (one box, or three: see
// runOn in arcology.js), as the cell asked it before.
//
// The rows (one RGBA32I texture, rows of four ints, ROW_WIDTH to a texture
// row; every reference to another row, or to an int, from the first row):
// - per table cell (from row 0), (first, count | n << 16 | lower << 20)
//   for the city's level and (first, count | lower' << 16) one level finer:
//   each list's first int and length; n, the cells to the nearest cell with
//   a list at the city's level (Chebyshev, 0 for one with a list, at most
//   15), and from a cell with n of 2 or more, which of the cells around it
//   have n - 1 (27 bits, lower' the high 15): what a city cell's list leaves
//   out is no nearer than n - 2 cells and the nearest of those (or one cell
//   more), and so no nearer than the bound a cell next to it gives, where
//   they meet (so that the distance changes no faster than the point
//   moves); one level finer, no nearer than the cell's sides;
// - per table cell (from row NC), (first, count) of its seam groups' rows,
//   for each level as above;
// - the lists, ints: each piece's row (a cell's list holds the pieces asked
//   always: the physical ones, and the cover's joining the levels; each
//   seam group's list, its cover pieces with that seam, see cover.js),
//   a cell's groups' lists after its own, in turn;
// - per seam group a row: (its seam plane's direction | sign << 8 and K,
//   as the plane's row has them, its list's length, 0);
// - per piece a row: (its first plane's int | how many << 24, and its
//   bounds, in finer units from the building's origin, +32768, low and high
//   halves of x, y, z);
// - the pieces' planes, ints: each plane's row;
// - per plane (direction | sign << 8 | fade << 9, K at the piece's level,
//   fz's bits, 0): fade 0 none, 1 a back (it rises by fr fz as the finer
//   level fades, and grows by fg fz). A terrace's floor or ceiling is the
//   city terrace's, and stays as the finer level fades (relief-cover.md
//   3.6, rev 2 H1: so that no plane the cover drops or shares moves).
// The directions (an id into DIRS): each an axis (0 to 2) or a slant
// (3 on), with its whole-number m; a plane's n is sign m.
import * as twin from '../twin.js';
import { coverOf, coverBuiltBy, touching } from './cover.js';

export const ROW_WIDTH = 1024;
// What the rows are built by, for the key they are kept by (see stored in
// util.js): the builder's own text, and the format's, which changes by hand
// with anything else the rows depend on that the key does not name.
export const RELIEF_FORMAT = 1;
export const builtBy = () => [String(RELIEF_FORMAT), String(ROW_WIDTH), String(COVER_SRC), buildRelief.toString(), writeRows.toString(), reliefDirections.toString(), edgeDirection.toString(), ...coverBuiltBy()];
// (A cover piece's source: after every physical piece's.)
const COVER_SRC = 0x40000000;

// The relief's directions, from its faces alone (so that they are known
// before anything is built): the axes; 4 y and 12 y (the city's heights in
// quarters, its terraces' floors in twelfths); each face's t, n and n_h; and
// each face's notches' edges at its two ridges, each by the least whole
// multiple its planes need. Each as m, its first part over 0: the arcology
// carries each that is not an axis as a slant (see RELIEF_DIRS).
export function reliefDirections({ FACES, T, R }) {
  const out = [];
  const add = (m) => {
    const s = Math.sign(m.find((x) => x !== 0)), v = m.map((x) => x * s);
    if (!out.some((e) => e.join() === v.join())) out.push(v);
  };
  add([1, 0, 0]), add([0, 1, 0]), add([0, 0, 1]), add([0, 4, 0]), add([0, 12, 0]);
  FACES.forEach((F, k) => {
    add(F.tv), add(F.n), add([F.n[0], 0, F.n[2]]);
    for (let e = 0; e < 2; e++) add(edgeDirection(F, T.FEDGE[k * 2 + e], T.FWT, k, e, R).m);
  });
  return out.map((m) => ({ m }));
}
// (A notch's edge at face k's e-th ridge: sg sd (E.x t . X - E.y y) <= W |E.x|
// + sg sd S E.z for each row's W and either level's S; its direction is the
// least whole multiple of (E.x t, -E.y) that all those planes are whole in.)
function edgeDirection(F, E, FWT, k, e, R) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const s = (E[3] > 0 ? 1 : -1) * (E[0] > 0 ? 1 : -1);
  const n = [s * E[0] * F.tv[0], -s * E[1], s * E[0] * F.tv[2]];
  let g = gcd(gcd(n[0], n[1]), n[2]);
  for (let lv = 0; lv < 2; lv++) for (let t = 0; t <= 16; t++) g = gcd(g, FWT[((k * 2 + e) * 2 + lv) * 17 + t] * Math.abs(E[0]) + s * (lv ? R : 1) * E[2]);
  return { m: n.map((x) => x / g), g, n, s };
}

// The pieces, their lists and rows. ctx: the arcology's own (see
// listed there): R, ORIGIN, FACES, T (RELIEF_ROWS), VOLUME and its
// bits, the decisions (rectangle, rectDepth, cutOf, ridgeRow, depthN and
// their state RS), hashCell, TILE_SALT, and DIRS (reliefDirections').
export function buildRelief(ctx) {
  const { R, ORIGIN: O, FACES, T, VOLUME: V, BITS, decide, RS, hashCell, TILE_SALT, DIRS, BARE } = ctx;
  const t0 = typeof performance === 'undefined' ? 0 : performance.now();
  // A plane, as a row of the table: n . X <= K at level lv (n whole numbers),
  // its fade and fz. Equal rows are one row.
  if (DIRS.length > 256) throw new Error('relief: more directions than a plane\'s row has room for');
  const planeRows = [], planeAt = new Map(), asked = new Map();
  const plane = (n, K, fade = 0, fz = 0) => {
    // (Asked before, as it is given: its row.)
    const given = `${n}|${K}|${fade}|${fade ? fz : 0}`, was = asked.get(given);
    if (was !== undefined) return was;
    const nz = n.find((x) => x !== 0), s = Math.sign(nz);
    // (n is a whole multiple c of its direction's m: the plane is s m . X <= K / c, K / c whole.)
    // (Of the directions n is a whole multiple of, one its K is whole along: the least multiple.)
    let id = -1, c = Infinity;
    DIRS.forEach(({ m }, i) => {
      const j = m.findIndex((x) => x !== 0), q = (s * n[j]) / m[j];
      if (Number.isInteger(q) && q > 0 && q < c && K % q === 0 && m.every((x, a) => x * q === s * n[a])) (id = i), (c = q);
    });
    if (id < 0) throw new Error(`relief: a plane across ${n} at ${K}: no direction of the relief's it is whole along`);
    // (A back only rises as the level fades, so that a piece only shrinks:
    // the planes a piece goes without rely on it, see buildRelief.)
    if (fade && !(fval(fbits(fz)) >= 0 && Number.isFinite(fval(fbits(fz))))) throw new Error(`relief: a plane across ${n} at ${K} fades from ${fz}`);
    const row = [id | ((s < 0 ? 1 : 0) << 8) | (fade << 9), K / c, fade ? fbits(fz) : 0, 0];
    if (Math.abs(row[1]) >= 2 ** 31) throw new Error('relief: a plane too far out for 32 bits');
    const key = row.join();
    if (!planeAt.has(key)) planeAt.set(key, planeRows.length), planeRows.push(row);
    asked.set(given, planeAt.get(key));
    return planeAt.get(key);
  };
  const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
  const fbits = (x) => ((f32[0] = x), i32[0]);
  const fval = (b) => ((i32[0] = b), f32[0]);

  // (Skin cells by face, cells from the origin; a cell's word.)
  const vlo = V.lo.map((x, a) => x - O[a]), vsz = V.size, NC = vsz[0] * vsz[1] * vsz[2];
  const cellIndex = (x, y, z) => { const a = x - vlo[0], b = y - vlo[1], c = z - vlo[2]; return a < 0 || b < 0 || c < 0 || a >= vsz[0] || b >= vsz[1] || c >= vsz[2] ? -1 : a + vsz[0] * (b + vsz[1] * c); };
  const word = (ci, w = 0) => V.data[V.words * ci + w];

  // Each face's frame: X (finer units) from (u, y, w), the inverse of [t; ey; n].
  const frames = FACES.map((F) => {
    const M = [F.tv, [0, 1, 0], F.n], inv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const D = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = M.filter((_, a) => a !== j).map((row) => row.filter((_, b) => b !== i));
      inv[i][j] = (((i + j) % 2 ? -1 : 1) * (m[0][0] * m[1][1] - m[0][1] * m[1][0])) / D;
    }
    return inv;
  });
  const toX = (inv, u, y, w) => [inv[0][0] * u + inv[0][1] * y + inv[0][2] * w, inv[1][0] * u + inv[1][1] * y + inv[1][2] * w, inv[2][0] * u + inv[2][1] * y + inv[2][2] * w];

  // The cut's back as cutOf has it (RS.C*), with the wall's whole depth.
  const cut = (k, lv, y0, y1, t, fl, cy0, cy1) => {
    const S = lv === 0 ? 1 : R;
    decide.cutOf(k, lv, S, y0, y1, t, fl, cy0, cy1);
    if (RS.Cter) {
      const x = t - fl, D = lv === 0 || RS.Cback === 0 ? 0 : decide.depthN(k, S, [Math.trunc(x / 3), x - 3 * Math.trunc(x / 3)]);
      const nh = Math.hypot(FACES[k].n[0], FACES[k].n[2]);
      return { ter: true, yin: RS.Cyin, tH: lv === 0 ? t : fl, D, fz: lv === 1 ? D / nh : 0 };
    }
    return { ter: false, dn: RS.Cdn, fz: lv === 1 ? RS.Cdn / FACES[k].nl : 0 };
  };
  // A box's planes (see the head of this file), as rows, and its bounds in
  // finer units (from its frame, over its rows, back and out; a notch's
  // from its vertices).
  const boxPlanes = (b) => {
    const { k, lv } = b, F = FACES[k], S = lv === 0 ? 1 : R, nh = [F.n[0], 0, F.n[2]], ny = F.n[1], up = ny > 0;
    const ps = [];
    if (b.e < 0) ps.push(plane(F.tv.map((x) => -x), -b.A), plane(F.tv, b.B));
    else ps.push(plane(b.edgeN, b.edgeK));
    // (Rows, floors and ceilings: at the city's level in 12 y, the floors
    // being on twelfths; one level finer in y. A terrace's floor or ceiling
    // stays as the finer level fades: it is the city terrace's. One that lies
    // on the piece's own row is that row's plane.)
    ps.push(plane([0, -1, 0], -b.y0), plane([0, 1, 0], b.y1));
    if (b.ter) {
      const H12 = T.FTH[k * 17 + b.tH] * S;
      if (up) ps.push(lv === 0 ? plane([0, -12, 0], -(12 * b.yin - H12)) : plane([0, -1, 0], -(12 * b.yin - H12) / 12));
      else ps.push(lv === 0 ? plane([0, 12, 0], 12 * b.yin + H12) : plane([0, 1, 0], (12 * b.yin + H12) / 12));
    }
    if (b.ter) ps.push(plane(nh.map((x) => -x), -(F.K * S - ny * b.yin - b.D), lv === 1 ? 1 : 0, b.fz));
    else ps.push(plane(F.n.map((x) => -x), -(F.K * S - b.dn), lv === 1 ? 1 : 0, b.fz));
    ps.push(plane(F.n, F.K * S + Math.ceil(F.nl)));
    if (b.g !== k) { const G = FACES[b.g]; ps.push(plane(G.n, G.K * S + Math.ceil(G.nl))); }
    const lo4 = T.FQY[k][2], hi4 = T.FQY[k][3];
    if (lv === 0) ps.push(plane([0, -4, 0], -lo4), plane([0, 4, 0], hi4));
    else ps.push(plane([0, -1, 0], -Math.trunc((lo4 * R) / 4)), plane([0, 1, 0], Math.trunc((hi4 * R) / 4)));
    if (lv === 0) {
      const lo = F.solid.lo.map((x, a) => x - O[a] - 2), hi = F.solid.hi.map((x, a) => x - O[a] + 2);
      for (let a = 0; a < 3; a++) { const e = [0, 0, 0]; e[a] = 1; ps.push(plane(e, hi[a]), plane(e.map((x) => -x), -lo[a])); }
    }
    return [...new Set(ps)];
  };

  // --- The rectangles, by flood: one call of rectangle() per rectangle.
  const flood = (lv, k, uq0, nU, yq0, nY, q, qy, tile, oU, oY) => {
    const seen = new Uint8Array(nU * nY), out = [];
    for (let j = 0; j < nY; j++) for (let i = 0; i < nU; i++) {
      if (seen[i + nU * j]) continue;
      decide.rectangle(lv, k, (uq0 + i) * q - oU + Math.floor(q / 2), 0.25, (yq0 + j) * qy - oY + Math.floor(qy / 2), 0.25, tile);
      const r = { U0: RS.U0 + oU, U1: RS.U1 + oU, Y0: RS.Y0 + oY, Y1: RS.Y1 + oY, j: RS.Depth };
      for (let jj = Math.max(0, r.Y0 / qy - yq0); jj < Math.min(nY, r.Y1 / qy - yq0); jj++) for (let ii = Math.max(0, r.U0 / q - uq0); ii < Math.min(nU, r.U1 / q - uq0); ii++) seen[ii + nU * jj] = 1;
      out.push(r);
    }
    return out;
  };
  // (Skin cells by face, for whether finer rectangles are wanted at all.)
  const skinOf = FACES.map(() => new Set());
  for (let ci = 0; ci < NC; ci++) { const w = word(ci); if ((w & 3) !== BITS.SKIN) continue; const f = (w >> BITS.FACE_AT) & 63; for (let k = 0; k < FACES.length; k++) if (f & (1 << k)) skinOf[k].add(ci); }
  const boxMeetsSkin = (k, bb) => { for (let x = Math.floor(bb[0][0] / R); x <= Math.floor(bb[0][1] / R); x++) for (let y = Math.floor(bb[1][0] / R); y <= Math.floor(bb[1][1] / R); y++) for (let z = Math.floor(bb[2][0] / R); z <= Math.floor(bb[2][1] / R); z++) { const ci = cellIndex(x, y, z); if (ci >= 0 && skinOf[k].has(ci)) return true; } return false; };
  const span = (k) => {
    const F = FACES[k], lo = F.solid.lo.map((x, a) => x - O[a] - 2), hi = F.solid.hi.map((x, a) => x - O[a] + 2), us = [];
    for (let i = 0; i < 8; i++) us.push(F.tv[0] * (i & 1 ? hi[0] : lo[0]) + F.tv[1] * (i & 2 ? hi[1] : lo[1]) + F.tv[2] * (i & 4 ? hi[2] : lo[2]));
    return { u0: Math.min(...us), u1: Math.max(...us), y0: Math.floor(T.FQY[k][2] / 4), y1: Math.ceil(T.FQY[k][3] / 4) };
  };
  const boxes = [];
  for (let k = 0; k < FACES.length; k++) {
    const F = FACES[k], inv = frames[k], sp = span(k), q0 = T.FQY[k][0], q1 = T.FQY[k][1];
    const u0q = Math.floor(sp.u0 / q0) - 4, u1q = Math.ceil(sp.u1 / q0) + 4;
    for (const c of flood(0, k, u0q, u1q - u0q, sp.y0, sp.y1 - sp.y0, q0, 1, 0, 0, 0)) {
      c.t = decide.rectDepth(k, 0, c.U0, c.U1, c.Y0, c.Y1, c.j, 0, 0, 0);
      if (c.t > 0) boxes.push({ kind: 0, k, lv: 0, e: -1, g: k, A: c.U0, B: c.U1, y0: c.Y0, y1: c.Y1, t: c.t, fl: 0, ...cut(k, 0, c.Y0, c.Y1, c.t, 0, 0, 0) });
      // (One level finer only where a skin cell of the face could meet the
      // city rectangle's prism, to the deepest finer cut and a unit out.)
      const wlo = (F.K - 1) * R - (16 * R * F.nl) / 12, whi = (F.K + 2) * R, cs = [];
      for (const u of [c.U0 * R, c.U1 * R]) for (const y of [c.Y0 * R, c.Y1 * R]) for (const w of [wlo, whi]) cs.push(toX(inv, u, y, w));
      if (!boxMeetsSkin(k, [0, 1, 2].map((a) => [Math.min(...cs.map((X) => X[a])), Math.max(...cs.map((X) => X[a]))]))) continue;
      const tile = hashCell([c.U0, c.Y0, k], TILE_SALT >>> 0);
      for (const f of flood(1, k, (c.U0 * R) / q1, ((c.U1 - c.U0) * R) / q1, (c.Y0 * R) / 2, ((c.Y1 - c.Y0) * R) / 2, q1, 2, tile, c.U0 * R, c.Y0 * R)) {
        f.t = decide.rectDepth(k, 1, f.U0, f.U1, f.Y0, f.Y1, f.j, c.t, c.Y0, c.Y1);
        if (f.t > c.t) boxes.push({ kind: 0, k, lv: 1, e: -1, g: k, A: f.U0, B: f.U1, y0: f.Y0, y1: f.Y1, t: f.t, fl: c.t, ...cut(k, 1, f.Y0, f.Y1, f.t, c.t, R * c.Y0, R * c.Y1) });
      }
    }
    // The ridges' notches, both levels.
    for (let e = 0; e < 2; e++) {
      const r = T.FER[k * 2 + e], E = T.FEDGE[k * 2 + e], wi = (lv) => ((k * 2 + e) * 2 + lv) * 17, ed = edgeDirection(F, E, T.FWT, k, e, R);
      for (const lv of [0, 1]) {
        const S = lv === 0 ? 1 : R;
        for (let y = (lv ? R : 1) * (sp.y0 - 2); y < (lv ? R : 1) * (sp.y1 + 2); ) {
          decide.ridgeRow(r, lv, y);
          const row = { y0: RS.RY0, y1: RS.RY1, RT: RS.RT, RTC: RS.RTC, RCY0: RS.RCY0, RCY1: RS.RCY1 };
          y = Math.max(row.y1, y + 1);
          if (row.RT === 0 || (lv === 1 && row.RT === row.RTC)) continue;
          const W = T.FWT[wi(lv) + row.RT] * Math.abs(E[0]);
          boxes.push({ kind: 1, k, lv, e, g: T.FEG[k * 2 + e], y0: row.y0, y1: row.y1, t: row.RT, fl: lv ? row.RTC : 0, edgeN: ed.n, edgeK: W + ed.s * S * E[2], ...cut(k, lv, row.y0, row.y1, row.RT, lv ? row.RTC : 0, row.RCY0, row.RCY1) });
        }
      }
    }
  }

  // --- Bounds (finer units) and planes; the pieces that are anything.
  const solve3 = (A, b) => {
    const [a0, a1, a2] = A[0], [b0, b1, b2] = A[1], [c0, c1, c2] = A[2];
    const m0 = b1 * c2 - b2 * c1, m1 = b2 * c0 - b0 * c2, m2 = b0 * c1 - b1 * c0, D = a0 * m0 + a1 * m1 + a2 * m2;
    if (D * D < 1e-18 * (a0 * a0 + a1 * a1 + a2 * a2) * (b0 * b0 + b1 * b1 + b2 * b2) * (c0 * c0 + c1 * c1 + c2 * c2)) return null;
    const [p, q, r] = b;
    return [(p * m0 - a1 * (q * c2 - b2 * r) + a2 * (q * c1 - b1 * r)) / D, (a0 * (q * c2 - b2 * r) + p * m1 + a2 * (b0 * r - q * c0)) / D, (a0 * (b1 * r - q * c1) - a1 * (b0 * r - q * c0) + p * m2) / D];
  };
  // (A plane row as floats in finer units: a . X <= b.)
  const floatOf = (pi, lv) => { const r = planeRows[pi], d = DIRS[r[0] & 255], s = r[0] & 256 ? -1 : 1; return { a: d.m.map((x) => s * x), b: r[1] * (lv === 0 ? R : 1) }; };
  const pieces = [];
  for (const b of boxes) {
    const pl = boxPlanes(b), fp = pl.map((pi) => floatOf(pi, b.lv));
    // (Its vertices: where three of its planes meet, inside the rest.)
    const vs = [];
    for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) for (let l = j + 1; l < fp.length; l++) {
      const X = solve3([fp[i].a, fp[j].a, fp[l].a], [fp[i].b, fp[j].b, fp[l].b]);
      if (X && fp.every((p) => p.a[0] * X[0] + p.a[1] * X[1] + p.a[2] * X[2] - p.b <= 1e-7 * Math.hypot(...p.a))) vs.push(X);
    }
    if (vs.length < 4) continue;
    const bb = [0, 1, 2].map((a) => [Math.min(...vs.map((X) => X[a])), Math.max(...vs.map((X) => X[a]))]);
    if (bb.some(([a, c]) => !(c - a > 1e-9))) continue;
    // (Source: face, level, kind and the rectangle's corner or the ridge's row.)
    const src = (((b.k * 2 + b.lv) * 2 + b.kind) << 24) ^ (b.kind ? (b.e << 20) ^ (b.y0 & 0xfffff) : hashCell([b.A, b.y0, b.k], 0x9e3779b9) & 0xffffff);
    pieces.push({ b, pl, fp, bb, src, vs });
  }

  // --- Lists. A finer piece in the skin cells of its face it meets (its
  // planes not all leaving the cell outside); cut to a cell's run-on where
  // it meets a deaf cell. A city piece in every table cell it meets.
  const meets = (fp, c0, unit) => {
    for (const q of fp) {
      let out = true;
      for (let i = 0; i < 8 && out; i++) if (q.a[0] * (c0[0] + (i & 1 ? unit : 0)) + q.a[1] * (c0[1] + (i & 2 ? unit : 0)) + q.a[2] * (c0[2] + (i & 4 ? unit : 0)) < q.b - 1e-9 * Math.hypot(q.a[0], q.a[1], q.a[2])) out = false;
      if (out) return false;
    }
    return true;
  };
  const lists = [Array.from({ length: NC }, () => []), Array.from({ length: NC }, () => [])];
  const rows = []; // (pieces as listed: { pl, bb, lv, src, seams, cross }, and its corners, vs, where it is not cut)
  const listed = (p, pl = p.pl, bb = p.bb, vs = p.vs) => rows.push({ pl, bb, lv: p.b.lv, src: p.src, seams: p.seams ?? [], cross: !!p.cross, vs }) - 1;
  // (Whether piece p may be in table cell ci one level finer: a skin cell
  // of its face, or of all its members' faces.)
  const mayBe = (b, ci) => (b.k >= 0 ? skinOf[b.k].has(ci) : (word(ci) & 3) === BITS.SKIN && ((word(ci) >> BITS.FACE_AT) & b.faces) === b.faces);
  let deafCut = 0;
  const list = (p) => {
    const { b, fp, bb } = p, unit = b.lv === 0 ? 1 : R, sc = b.lv === 0 ? 1 / R : 1;
    const cells = [];
    // (The cells its bounds meet with more than a side: x < hi, x + 1 > lo.)
    const lo = bb.map(([a]) => Math.floor((a * sc) / unit)), hi = bb.map(([, c]) => Math.ceil((c * sc) / unit) - 1);
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          if (!meets(fp, [x * R, y * R, z * R].map((v) => (b.lv === 0 ? v / unit : v)), R)) continue;
          cells.push([x, y, z]);
        }
    if (b.lv === 0) {
      let i = -1;
      for (const [x, y, z] of cells) { const ci = cellIndex(x, y, z); if (ci < 0) throw new Error(`relief: a city piece outside the table: cell ${[x, y, z]}, bounds ${JSON.stringify(p.bb)}, table ${vlo} + ${vsz}`); i = i < 0 ? listed(p) : i; lists[0][ci].push(i); }
      return;
    }
    // (One level finer: a cell it may be in (skin, its face's bit), one it
    // may run on into (open, or out of the table: the city's air), or deaf.)
    const ok = [], deaf = [];
    for (const [x, y, z] of cells) {
      const ci = cellIndex(x, y, z);
      if (ci >= 0 && mayBe(b, ci)) ok.push(ci);
      else if (ci >= 0 && !V.open[ci]) deaf.push(ci);
    }
    if (!ok.length) return;
    if (!deaf.length) { const i = listed(p); for (const ci of ok) lists[1][ci].push(i); return; }
    // Cut to each cell's run-on (as runsOn in arcology.js: the cell, and a
    // cell past each side it runs on across; three boxes, each along one
    // axis, where the word says so).
    deafCut++;
    for (const ci of ok) {
      const c = [ci % vsz[0] + vlo[0], (Math.floor(ci / vsz[0]) % vsz[1]) + vlo[1], Math.floor(ci / vsz[0] / vsz[1]) + vlo[2]];
      const open = (word(ci) >> BITS.OPEN_AT) & 63, cross = ((word(ci, 1) >> BITS.CROSS_AT) & 1) === 1;
      const lohi = (a, along) => [along && open & (2 << (2 * a)) ? -R : 0, along && open & (1 << (2 * a)) ? 2 * R : R];
      for (let axis = cross ? 0 : -1; axis < (cross ? 3 : 0); axis++) {
        const pl = [...p.pl], box = [0, 1, 2].map((a) => lohi(a, axis < 0 || axis === a).map((v) => c[a] * R + v));
        for (let a = 0; a < 3; a++) { const e = [0, 0, 0]; e[a] = 1; pl.push(plane(e, box[a][1]), plane(e.map((x) => -x), -box[a][0])); }
        const cb = p.bb.map(([lo, hi], a) => [Math.max(lo, box[a][0]), Math.min(hi, box[a][1])]);
        if (cb.some(([lo, hi]) => !(hi > lo))) continue;
        // (Nothing left of it: none of its planes touches it.)
        if (!touching(pl.map((pi) => floatOf(pi, 1)), cb.map(([lo, hi]) => [lo - 1, hi + 1])).some(Boolean)) continue;
        lists[1][ci].push(listed(p, pl, cb, null));
      }
    }
  };
  pieces.forEach(list);

  // --- The cover (see cover.js), from the physical pieces as listed (cut
  // to a cell's run-on where they would run into a deaf cell, so that what
  // such a cut meets is covered too): as pieces of their own, each with its
  // seams (the planes it was made by dropping; none for a piece joining the
  // levels, which is asked always: see listedCarve) and the faces of its
  // members of its own level (one level finer, it is listed only where all
  // of them may be: where one is not, its air there is not the cell's; a
  // member of the city's holds city air, which is air wherever the relief
  // is).
  const faceOf = (r) => (r.src >>> 24) >> 2;
  const members = rows.map((r, id) => {
    const sc = r.lv === 0 ? 1 / R : 1;
    const planes = r.pl.map((pi) => { const q = planeRows[pi], s = q[0] & 256 ? -1 : 1; return { n: DIRS[q[0] & 255].m.map((x) => s * x), K: q[1], lv: r.lv, fade: q[0] >> 9, fz: fval(q[2]) }; });
    return { id, lv: r.lv, planes, fp: planes.map((q) => ({ a: q.n, b: q.K })), box: r.bb.map(([a, c]) => [a * sc, c * sc]) };
  });
  const { cover, failed: coverFailed } = coverOf(members, { R, bare: BARE });
  cover.forEach((c, i) => {
    const lift = (q) => q.K * R ** (c.lv - q.lv);
    const pl = c.planes.map((q) => plane(q.n, lift(q), q.fade ?? 0, q.fz ?? 0));
    const seams = c.cross ? [] : c.dropped.map((q) => plane(q.n, lift(q)));
    const sc = c.lv === 0 ? R : 1, faces = c.members.reduce((m, id) => m | (rows[id].lv === c.lv ? 1 << faceOf(rows[id]) : 0), 0);
    list({ b: { lv: c.lv, k: -1, faces }, pl, fp: pl.map((pi) => floatOf(pi, c.lv)), bb: c.box.map(([a, d]) => [a * sc, d * sc]), vs: c.vs.map((X) => X.map((x) => x * sc)), src: COVER_SRC + i, seams, cross: c.cross });
  });
  // Each piece's planes but those that do not touch it (a member's far from
  // a join's slab, a cut's beyond what is left, a box's beyond its notch):
  // the same piece, and the same answers inside it; outside, a distance no
  // more than it was (each plane left still holds the piece, so it is still
  // no more than the true one), asked at fewer planes. As it fades it stays
  // the same piece: its backs, which move, are kept; the rest stay, or at the
  // city's level all move in alike (which takes the same from the piece
  // with them or without them).
  // (Whether a plane touches the piece: from its corners where it has them,
  // as made (a plane on which none of them is, within a margin, does not);
  // else, cut, from each side's polygon: see touching in cover.js.)
  for (const r of rows) {
    const fp = r.pl.map((pi) => floatOf(pi, r.lv));
    const on = r.vs ? fp.map((q) => { const l = Math.hypot(...q.a); return r.vs.some((X) => Math.abs(q.a[0] * X[0] + q.a[1] * X[1] + q.a[2] * X[2] - q.b) <= 1e-6 * l); }) : touching(fp, r.bb.map(([lo, hi]) => [lo - 1, hi + 1]));
    const keep = on.map((t, m) => t || planeRows[r.pl[m]][0] >> 9 !== 0);
    if (keep.filter(Boolean).length >= 4) (r.gone = r.pl.filter((_, m) => !keep[m])), (r.pl = r.pl.filter((_, m) => keep[m]));
    delete r.vs;
  }
  // Each piece's planes in the order that ends its asking soonest (carve
  // stops at the first plane the point is past by the clearance found so
  // far): of the points of a grid over its bounds (4 to a side) outside
  // it, first the plane most are past, then the one most of the rest are
  // past, and so on; the rest as they were. (The same air, and the same
  // answers but where two planes tie for a ray's way out.)
  // (The grid's 64 points as two words of bits.)
  const bits = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  for (const r of rows) {
    const n = r.pl.length, lo = new Uint32Array(n), hi = new Uint32Array(n);
    const [[x0, x1], [y0, y1], [z0, z1]] = r.bb;
    for (let m = 0; m < n; m++) {
      const { a, b } = floatOf(r.pl[m], r.lv);
      for (let g = 0; g < 64; g++) {
        const x = x0 + (((g & 3) + 0.5) / 4) * (x1 - x0), y = y0 + ((((g >> 2) & 3) + 0.5) / 4) * (y1 - y0), z = z0 + (((g >> 4) + 0.5) / 4) * (z1 - z0);
        if (a[0] * x + a[1] * y + a[2] * z > b) g < 32 ? (lo[m] |= 1 << g) : (hi[m] |= 1 << (g - 32));
      }
    }
    let leftLo = 0, leftHi = 0;
    for (let m = 0; m < n; m++) (leftLo |= lo[m]), (leftHi |= hi[m]);
    const order = [], taken = new Uint8Array(n);
    while (leftLo || leftHi) {
      let best = -1, most = 0;
      for (let m = 0; m < n; m++) { const c = taken[m] ? 0 : bits(lo[m] & leftLo) + bits(hi[m] & leftHi); if (c > most) (best = m), (most = c); }
      order.push(best), (taken[best] = 1), (leftLo &= ~lo[best]), (leftHi &= ~hi[best]);
    }
    for (let m = 0; m < n; m++) if (!taken[m]) order.push(m);
    r.pl = order.map((m) => r.pl[m]);
  }
  // (Each list in a stable order: by source.)
  for (const ls of lists) for (const l of ls) l.sort((i, j) => rows[i].src - rows[j].src || i - j);
  const { data, size, at } = writeRows({ lists, rows, planeRows, size: vsz });
  const ms = typeof performance === 'undefined' ? 0 : performance.now() - t0;
  return {
    data, size, at, dirs: DIRS,
    stats: { boxes: boxes.length, pieces: pieces.length, cover: cover.length, coverFailed, rows: rows.length, planes: planeRows.length, deafCut, refs: [lists[0].reduce((s, l) => s + l.length, 0), lists[1].reduce((s, l) => s + l.length, 0)], ms: Math.round(ms) },
    // (For the checks: each listed piece's planes and bounds, and the lists.)
    _pieces: rows.map((r) => ({ lv: r.lv, src: r.src, cover: r.src >= COVER_SRC, cross: r.cross, planes: r.pl.map((pi) => floatOf(pi, r.lv)), rows: r.pl.map((pi) => planeRows[pi]), bb: r.bb, gone: (r.gone ?? []).map((pi) => floatOf(pi, r.lv)) })), _lists: lists, fval,
    // (And what the rows are written from, so that the checks can write them
    // again from the same air divided otherwise: see writeRows.)
    _built: { lists, rows, planeRows, size: vsz },
  };
}

// The rows (see the head of this file), from the pieces as listed (rows: each
// { pl, bb, seams }, pl its planes' rows, seams its seam planes'), the
// planes' rows, and each level's lists for the table's cells (size: the
// table's, in cells): the cells', the lists', the pieces', their planes'
// ints and the planes', and what a city cell's list leaves out, from which
// cells have lists.
export function writeRows({ lists, rows, planeRows, size: vsz }) {
  const NC = vsz[0] * vsz[1] * vsz[2];
  // What a city cell's list leaves out (see the head of this file): n,
  // the cells to the nearest with a list (Chebyshev; as if every cell past
  // the table were one past a list, the table's bounds being where the
  // relief's own distance is that to the table), at most 15; and from a cell
  // with n of 2 or more, the cells around it with n - 1 (by index (x + 1) +
  // 3 (y + 1) + 9 (z + 1), not those past a nearer one of them along the
  // same sides: no nearer than it).
  const n0 = new Uint8Array(NC).fill(15), lower = new Uint32Array(NC);
  const around = (ci, f) => {
    const x = ci % vsz[0], y = Math.floor(ci / vsz[0]) % vsz[1], z = Math.floor(ci / vsz[0] / vsz[1]);
    for (let o = 0; o < 27; o++) {
      if (o === 13) continue;
      const X = x + (o % 3) - 1, Y = y + (Math.floor(o / 3) % 3) - 1, Z = z + Math.floor(o / 9) - 1;
      f(o, X < 0 || Y < 0 || Z < 0 || X >= vsz[0] || Y >= vsz[1] || Z >= vsz[2] ? -1 : X + vsz[0] * (Y + vsz[1] * Z));
    }
  };
  {
    const byN = Array.from({ length: 16 }, () => []);
    for (let ci = 0; ci < NC; ci++) {
      if (lists[0][ci].length) n0[ci] = 0;
      else around(ci, (o, cj) => { if (cj < 0) n0[ci] = 2; });
      byN[n0[ci]].push(ci);
    }
    for (let n = 0; n < 15; n++) for (const ci of byN[n]) if (n0[ci] === n) around(ci, (o, cj) => { if (cj >= 0 && n0[cj] > n + 1) (n0[cj] = n + 1), byN[n + 1].push(cj); });
    // (o' is along o's sides, and no further: each part of it 0 or o's.)
    const within = (q, o) => [1, 3, 9].every((u) => { const a = (Math.floor(q / u) % 3) - 1, b = (Math.floor(o / u) % 3) - 1; return a === 0 || a === b; });
    for (let ci = 0; ci < NC; ci++) {
      if (n0[ci] < 2) continue;
      const n = n0[ci], at = [];
      around(ci, (o, cj) => { if ((cj < 0 ? 1 : n0[cj]) === n - 1) at.push(o); });
      for (const o of at) if (!at.some((q) => q !== o && within(q, o))) lower[ci] |= 1 << o;
    }
  }

  // --- The rows: the cells', the cells' seam groups', the lists', the
  // groups', the pieces', their planes' ints and the planes', in turn. Each
  // cell's list at a level holds its pieces asked always (the physical ones,
  // and the cover's joining the levels); its other cover pieces are in
  // groups by seam plane, each group asked only where its seam is near (see
  // listedCarve), a piece of several seams in each of their groups.
  const always = [0, 1].map(() => []), grouped = [0, 1].map(() => []);
  let nList = 0, nGroup = 0, nRun = 0;
  for (let lv = 0; lv < 2; lv++)
    for (let ci = 0; ci < NC; ci++) {
      const a = [], g = new Map();
      for (const i of lists[lv][ci]) {
        if (!rows[i].seams?.length) a.push(i);
        else for (const pi of rows[i].seams) (g.get(pi) ?? g.set(pi, []).get(pi)).push(i);
      }
      always[lv].push(a);
      grouped[lv].push([...g]);
      nList += a.length;
      for (const [, items] of g) (nList += items.length), nGroup++;
    }
  const firsts = rows.map((r) => ((nRun += r.pl.length), nRun - r.pl.length));
  const at = {}, nRows = (n) => Math.ceil(n / 4);
  at.GCELL0 = NC;
  at.LIST0 = 2 * NC;
  at.GROUP0 = at.LIST0 + nRows(nList);
  at.PIECE0 = at.GROUP0 + nGroup;
  at.RUN0 = at.PIECE0 + rows.length;
  at.PLANE0 = at.RUN0 + nRows(nRun);
  const total = at.PLANE0 + planeRows.length, H = Math.ceil(total / ROW_WIDTH);
  const data = new Int32Array(ROW_WIDTH * H * 4);
  let li = 4 * at.LIST0, gi = at.GROUP0;
  for (let ci = 0; ci < NC; ci++)
    for (let lv = 0; lv < 2; lv++) {
      const l = always[lv][ci], gs = grouped[lv][ci];
      data[4 * ci + 2 * lv] = li;
      if (l.length > 65535) throw new Error('relief: a list too long');
      data[4 * ci + 2 * lv + 1] = l.length | (lv ? (lower[ci] >>> 12) << 16 : (n0[ci] << 16) | ((lower[ci] & 4095) << 20));
      for (const i of l) data[li++] = at.PIECE0 + i;
      data[4 * (at.GCELL0 + ci) + 2 * lv] = gi;
      data[4 * (at.GCELL0 + ci) + 2 * lv + 1] = gs.length;
      for (const [pi, items] of gs) {
        if (planeRows[pi][0] >> 9) throw new Error('relief: a seam that fades');
        data.set([planeRows[pi][0], planeRows[pi][1], items.length, 0], 4 * gi++);
        for (const i of items) data[li++] = at.PIECE0 + i;
      }
    }
  const e16 = (v) => { const x = Math.floor(v) + 32768; if (x < 0 || x > 65535) throw new Error('relief: bounds beyond 16 bits'); return x; };
  rows.forEach((r, i) => {
    const o = 4 * (at.PIECE0 + i), first = 4 * at.RUN0 + firsts[i];
    if (first >= 1 << 24 || r.pl.length >= 128) throw new Error('relief: a piece\'s planes beyond its row');
    data[o] = first | (r.pl.length << 24);
    for (let a = 0; a < 3; a++) data[o + 1 + a] = e16(r.bb[a][0] - 1) | (e16(Math.ceil(r.bb[a][1]) + 1) << 16);
    r.pl.forEach((pi, k) => (data[4 * at.RUN0 + firsts[i] + k] = at.PLANE0 + pi));
  });
  planeRows.forEach((r, i) => data.set(r, 4 * (at.PLANE0 + i)));
  if (4 * total >= 2 ** 31) throw new Error('relief: too many rows');
  return { data, size: [ROW_WIDTH, H], at };
}

// The relief at level lv where the point is, from its table cell's list, in
// either language (js: true, or GLSL), written once: the shader's reading
// the rows from the texture uRelief (reliefRow, reliefInt), the
// JavaScript's from their Int32Array (the same functions, given). Each
// plane's direction from RDM (m, and its axis, or 3 + its slant) and RDI
// (1 / |m|). (Where the languages differ, beyond what twin.writer writes:
// the cell from the point, and vectors part by part.)
export function listedCarve(js) {
  // (S is the level's scale here, as in the shader: the pieces' state is PS.)
  const { decl, loop, indent: ins, shaderOnly, slant, vadd, vsub, D, RAY, REACH, keep, O, A } = twin.writer(js, 'PS');
  const W1 = ROW_WIDTH - 1, WB = Math.log2(ROW_WIDTH);
  // (The point's distance outside plane row p (the names of its parts and
  // of what is worked out from it given): its direction m; along it, the
  // whole part w and the rest r, along an axis the point's own, along a
  // slant as carried and the cell's corner's; its sign sg, 1 / |m| inv, and
  // the distance s.)
  const across = (n) => [
    decl('ivec4', `${n.m} = RDM[${n.p}.x & 255]`),
    ...(js ? [`let ${n.w}, ${n.r};`] : [`int ${n.w};`, `float ${n.r};`]),
    `if (${n.m}.w < 3) {`,
    ...ins([`${n.w} = ${n.m}.w == 0 ? W.x : ${n.m}.w == 1 ? W.y : W.z;`, `${n.r} = ${n.m}.w == 0 ? f.x : ${n.m}.w == 1 ? f.y : f.z;`]),
    '} else {',
    ...ins([...slant(`${n.m}.w - 3`, n.w).whole, `${n.r} = ${slant(`${n.m}.w - 3`, n.w).rest};`, `${n.w} += ${n.m}.x * base.x + ${n.m}.y * base.y + ${n.m}.z * base.z;`]),
    '}',
    decl('int', `${n.sg} = (${n.p}.x & 256) != 0 ? -1 : 1`),
    decl('float', `${n.inv} = RDI[${n.p}.x & 255]`),
    decl('float', `${n.s} = (float(${n.sg} * ${n.w} - ${n.p}.y) + float(${n.sg}) * ${n.r}) * ${n.inv}`, !!n.changing),
  ];
  // (A plane's fz: in the shader from its row's bits; in JavaScript read as
  // a float from the rows themselves, reliefFloat.)
  const FZ = js ? 'reliefFloat(4 * qr + 2)' : 'intBitsToFloat(p.z)';
  // (Its right shifts are of ints, as twin.unsigned writes them in
  // JavaScript as of uints: each is masked after, so that both agree.)
  // (How far past a piece's bounds along axis a, in units one level finer.)
  const past = (a, b) => `max(float((h.${b} & 65535) - 32768) - X.${a}, X.${a} - float(((h.${b} >> 16) & 65535) - 32768))`;
  const lines = [
    ...shaderOnly(
      '// The relief\'s rows (see relief.js): row i, and the j-th int from the first.',
      `ivec4 reliefRow(int i) { return texelFetch(uRelief, ivec2(i & ${W1}, i >> ${WB}), 0); }`,
      'int reliefInt(int j) { ivec4 t = reliefRow(j >> 2); int c = j & 3; return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w; }',
      'int gCarve;',
      'ivec3 gCarveBase;',
      'float gCarveE;',
    ),
    "// The relief at level lv (0 the city's, 1 the next) where the point is",
    "// (base: its cell's corner from the building's origin, in the level's",
    "// units), united with d: the pieces its table cell lists, and, no nearer",
    "// than the cell's sides and n - 1 cells more (n the cells to the nearest",
    "// list), the rest. For a ray, how far it goes in them. Asked after from one",
    "// place (see cell): what asks for it leaves the level (or -1), the base and",
    "// the cell's own bound in the carve's state (the shader's gCarve globals,",
    "// the JavaScript's CELL).",
    js ? 'function carve(lv, L, f, base, d, ray) {' : 'float carve(int lv, ivec3 L, vec3 f, ivec3 base, float d, bool ray, inout float reach, inout vec3 nrm) {',
    ...ins([
      '// With distance (see the march), the relief one level finer fades by',
      "// getting shallower: each piece's back rises by fr of its fading depth",
      '// (fz, in its plane\'s row), growing by fg of it for each unit the ray',
      "// goes; its other planes stay (a terrace's floor or ceiling is the city",
      "// terrace's).",
      "// (Not by the uniform shrinking of the rest of the level's air, which",
      '// would fill in shallow relief long before deep, and leave slivers where',
      "// pieces meet: cell() takes that out again for map.) The city's keeps the",
      "// uniform shrinking, gO, growing by gA, on every plane (B43).",
      decl('float', `fo = ${O}, fa = ${A}, fr = lv == 1 ? ${O} / (CLOSE * float(R)) : 0.0, fg = lv == 1 ? ${A} / (CLOSE * float(R)) : 0.0`),
      `if (lv == 1) { ${O} = 0.0; ${A} = 0.0; }`,
      decl('int', 'S = lv == 0 ? 1 : R'),
      decl('ivec3', `W = ${vadd('base', 'L')}`),
      "// (Its table cell: at the city's level, the one the point is in; one",
      '// level finer, the one whose corner base is.)',
      js
        ? 'const cell = lv == 0 ? [W[0] - (f[0] < 0.0 ? 1 : 0), W[1] - (f[1] < 0.0 ? 1 : 0), W[2] - (f[2] < 0.0 ? 1 : 0)] : [int(base[0] / R), int(base[1] / R), int(base[2] / R)];'
        : 'ivec3 cell = lv == 0 ? W - ivec3(lessThan(f, vec3(0.0))) : base / R;',
      decl('ivec3', `v = ${vsub(vadd('cell', 'ORIGIN'), 'VOL_LO')}`),
      "// (Outside the table, which only the city's level asks: no nearer than the table.)",
      'if (any(lessThan(v, ivec3(0))) || any(greaterThanEqual(v, VOL_SIZE))) {',
      ...ins([
        decl('ivec3', `u = ${vsub(vadd('W', 'ORIGIN'), 'VOL_LO')}`),
        js ? 'const q = [0, 1, 2].map((a) => max(-(float(u[a]) + f[a]), float(u[a] - VOL_SIZE[a]) + f[a]));' : 'vec3 q = max(-(vec3(u) + f), vec3(u - VOL_SIZE) + f);',
        `${O} = fo; ${A} = fa;`,
        'return min(d, max(max(q.x, q.y), q.z));',
      ]),
      '}',
      decl('ivec4', 'c = reliefRow(v.x + VOL_SIZE.x * (v.y + VOL_SIZE.y * v.z))'),
      decl('int', 'first = lv == 0 ? c.x : c.z, count = (lv == 0 ? c.y : c.w) & 65535, n = lv == 0 ? (c.y >> 16) & 15 : 0'),
      js ? 'const Y = [0, 1, 2].map((a) => float(W[a] - S * cell[a]) + f[a]);' : 'vec3 Y = vec3(W - S * cell) + f;',
      "// (What the list leaves out: no nearer than the cell's sides; from a city",
      '// cell with n of 2 or more, than n - 2 cells and the nearest of the cells',
      '// around it with n - 1, or a cell more. See the head of relief.js.)',
      decl('float', 'e = min(min(min(Y.x, float(S) - Y.x), min(Y.y, float(S) - Y.y)), min(Y.z, float(S) - Y.z))', true),
      'if (n >= 2) {',
      ...ins([
        decl('float', 'h = 1.0', true),
        `for (${js ? 'let' : 'uint'} mm = (uint(c.y) >> 20) | ((uint(c.w) >> 16) << 12); mm != 0u; mm &= mm - 1u) {`,
        ...ins([
          decl('int', `o = lowBit(mm), ox = o % 3 - 1, oy = ${js ? 'int(o / 3)' : 'o / 3'} % 3 - 1, oz = ${js ? 'int(o / 9)' : 'o / 9'} - 1`),
          'h = min(h, max(max(ox == 0 ? 0.0 : ox > 0 ? 1.0 - Y.x : Y.x, oy == 0 ? 0.0 : oy > 0 ? 1.0 - Y.y : Y.y), oz == 0 ? 0.0 : oz > 0 ? 1.0 - Y.z : Y.z));',
        ]),
        '}',
        'e = float(n - 2) + h;',
      ]),
      '}',
      'd = min(d, max(e, 0.0));',
      "// (The point in units one level finer, as the pieces' bounds are.)",
      js ? 'const X = [0, 1, 2].map((a) => (float(W[a]) + f[a]) * float(R / S));' : 'vec3 X = (vec3(W) + f) * float(R / S);',
      decl('float', 'bs = float(S) / float(R)'),
      '// Its list, then each seam group whose seam is near: within the clearance',
      "// found so far, or for a ray, crossed within its reach (a little over: where",
      '// the ray leaves a member through the seam, the two are one). Elsewhere a',
      "// group's pieces take a ray no further than their members, nor, in air,",
      '// are they nearer (see cover.js); in solid (d not below 0) none is asked',
      '// but on its seam.',
      decl('ivec4', `g = reliefRow(${js ? 'VOL_SIZE[0] * VOL_SIZE[1] * VOL_SIZE[2]' : 'VOL_SIZE.x * VOL_SIZE.y * VOL_SIZE.z'} + v.x + VOL_SIZE.x * (v.y + VOL_SIZE.y * v.z))`),
      "// (A cell's groups' lists follow its own, in turn: gl, the next group's.)",
      decl('int', 'gi = lv == 0 ? g.x : g.z, gn = lv == 0 ? g.y : g.w, at = first, left = count, gl = first + count', true),
      'while (true) {',
      ...ins([
        'if (left == 0) {',
        ...ins([
          decl('bool', 'found = false', true),
          'while (gn > 0) {',
          ...ins([
            decl('ivec4', 'gr = reliefRow(gi)'),
            'gi++;',
            'gn--;',
            '// (Its seam plane is its row\'s first two ints, as a plane\'s row has them.)',
            ...across({ p: 'gr', m: 'mq', w: 'wq', r: 'rq', sg: 'sq', inv: 'iq', s: 'sd' }),
            decl('float', `dt = float(sq) * iq * ${js ? '(mq[0] * PS.dx + mq[1] * PS.dy + mq[2] * PS.dz)' : 'dot(vec3(mq.xyz), gDir)'}`),
            "// (A ray in a member shrunk at the city's level, by O and growing by A",
            '// as it goes, leaves it so much sooner than at its seam.)',
            `if (abs(sd) <= -d || (ray && sd * dt < 0.0 && (abs(sd) - ${O}) / (abs(dt) + ${A}) <= ${REACH} * 1.0001 + 1e-4)) {`,
            ...ins(['at = gl;', 'left = gr.z;', 'found = true;']),
            '}',
            'gl += gr.z;',
            'if (found) {',
            ...ins(['break;']),
            '}',
          ]),
          '}',
          'if (!found) break;',
        ]),
        '}',
        decl('int', 'pr = reliefInt(at)'),
        'at++;',
        'left--;',
        decl('ivec4', 'h = reliefRow(pr)'),
        decl('int', 'pf = h.x & 16777215, pn = (h.x >> 24) & 255'),
        "// (Past its bounds by d or more, it is no nearer; a ray, only from inside them.)",
        decl('float', `far = max(max(${past('x', 'y')}, ${past('y', 'z')}), ${past('z', 'w')}) * bs`),
        'if (far >= d && (!ray || far > 0.0)) continue;',
        `${RAY} = false;`,
        decl('float', 'gd = 1e9', true),
        loop('pass', 0, 2),
        ...ins([
          'airPiece();',
          loop('k', 0, 'pn'),
          ...ins([
            // (In JavaScript, the plane's row qr, to read its fz as a float.)
            js ? 'const qr = reliefInt(pf + k), p = reliefRow(qr);' : 'ivec4 p = reliefRow(reliefInt(pf + k));',
            ...across({ p: 'p', m: 'm', w: 'w', r: 'r', sg: 'sg', inv: 'inv', s: 's', changing: true }),
            decl('int', 'fc = (p.x >> 9) & 3'),
            `if (fc == 1) s += fr * ${FZ};`,
            `if (lv == 1) ${A} = fc == 1 ? fg * ${FZ} : 0.0;`,
            js ? 'airPlane(s, sg * m[0] * inv, sg * m[1] * inv, sg * m[2] * inv);' : 'airPlane(s, float(sg) * inv * vec3(m.xyz));',
            `if (pass == 0 && ${D} >= d && (!ray || ${D} + ${O} > 0.0)) break;`,
          ]),
          '}',
          `if (lv == 1) ${A} = 0.0;`,
          'if (pass == 0) {',
          ...ins([
            "// (Its distance no less than its bounds' (so that the bounds leaving it",
            "// out leaves the distance as it is): in its air, its planes' alone.)",
            `gd = max(${D}, far);`,
            `if (!ray || gd + ${O} > 0.0) break;`,
            `${RAY} = true;`,
          ]),
          '} else {',
          ...ins([`${RAY} = false;`, keep]),
          '}',
        ]),
        '}',
        'd = min(d, gd);',
      ]),
      '}',
      `${O} = fo; ${A} = fa;`,
      'return d;',
    ]),
    '}',
  ];
  const text = lines.join('\n');
  return js ? twin.unsigned(twin.arrays(text, ['c', 'g', 'gr', 'v', 'q', 'Y', 'X', 'W', 'f', 'h', 'p', 'm', 'mq', 'base', 'VOL_SIZE'])) : text;
}
