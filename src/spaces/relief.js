// The relief cut into the masses' faces, as listed pieces of air (plan
// .claude/design/relief-cover.md): every box the relief's decisions can make
// (each face's rectangles at both levels, as rectangle() and rectDepth()
// tile and cut it, and each ridge's rows' notches, as ridgeRow() cuts them),
// worked out once, as whole-number planes on the carried coordinates, and
// listed for the cells of the table they meet. Both copies of the relief
// (the shader's and the JavaScript's: see listedPieces in arcology.js) ask a
// cell's list in one loop, from the same rows.
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
//   cuts are asked (the gate of the city's faces, as cityFaces had it).
// One level finer a piece is listed only in the skin cells of its face (as
// its face's bit in the table says); where it meets a cell it may not run
// on into (deaf: deep or plain, see VOLUME), it is listed instead, in each
// cell it is asked in, cut to that cell's run-on (one box, or three: see
// runOn in arcology.js), as the cell asked it before.
//
// The rows (one RGBA32I texture, rows of four ints, ROW_WIDTH to a texture
// row; every reference to another row, or to an int, from the first row):
// - per table cell (from row 0), (first, count | n << 16) for the city's
//   level and the same one level finer: its list's first int and length,
//   and n the cells to the nearest cell with a list (Chebyshev; 0 for one
//   with a list, at most 15): what the list leaves out is no nearer than the
//   cell's sides and n - 1 cells more;
// - the lists, ints: each piece's row;
// - per piece two rows: (its first plane's int, how many, its level, its
//   source) and its bounds, in finer units from the building's origin,
//   +32768, low and high halves of x, y, z;
// - the pieces' planes, ints: each plane's row;
// - per plane (direction | sign << 8 | fade << 9, K at the piece's level,
//   fz's bits, 0): fade 0 none, 1 a back (it rises by fr fz as the finer
//   level fades, and grows by fg fz), 2 a terrace's floor or ceiling (it
//   grows by fg fz, as the back's).
// The directions (an id into DIRS): each an axis (0 to 2) or a slant
// (3 on), with its whole-number m; a plane's n is sign m.
export const ROW_WIDTH = 1024;

// The relief's directions, from its faces alone (so that they are known
// before anything is built): the axes; 4 y and 12 y (the city's heights in
// quarters, its terraces' floors in twelfths); each face's t, n and n_h; and
// each face's notches' edges at its two ridges, each by the least whole
// multiple its planes need. Each as m, its first part over 0: the arcology
// carries each that is not an axis as a slant (see listedPieces).
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
// listedPieces there): R, ORIGIN, FACES, T (RELIEF_ROWS), VOLUME and its
// bits, the decisions (rectangle, rectDepth, cutOf, ridgeRow, depthN and
// their state RS), hashCell, TILE_SALT, and DIRS (reliefDirections').
export function buildRelief(ctx) {
  const { R, ORIGIN: O, FACES, T, VOLUME: V, BITS, decide, RS, hashCell, TILE_SALT, DIRS } = ctx;
  const t0 = typeof performance === 'undefined' ? 0 : performance.now();
  // A plane, as a row of the table: n . X <= K at level lv (n whole numbers),
  // its fade and fz. Equal rows are one row.
  const planeRows = [], planeAt = new Map();
  const plane = (n, K, fade = 0, fz = 0) => {
    const nz = n.find((x) => x !== 0), s = Math.sign(nz);
    // (n is a whole multiple c of its direction's m: the plane is s m . X <= K / c, K / c whole.)
    // (Of the directions n is a whole multiple of, one its K is whole along: the least multiple.)
    let id = -1, c = Infinity;
    DIRS.forEach(({ m }, i) => {
      const j = m.findIndex((x) => x !== 0), q = (s * n[j]) / m[j];
      if (Number.isInteger(q) && q > 0 && q < c && K % q === 0 && m.every((x, a) => x * q === s * n[a])) (id = i), (c = q);
    });
    if (id < 0) throw new Error(`relief: a plane across ${n} at ${K}: no direction of the relief's it is whole along`);
    const row = [id | ((s < 0 ? 1 : 0) << 8) | (fade << 9), K / c, fade ? fbits(fz) : 0, 0];
    if (Math.abs(row[1]) >= 2 ** 31) throw new Error('relief: a plane too far out for 32 bits');
    const key = row.join();
    if (!planeAt.has(key)) planeAt.set(key, planeRows.length), planeRows.push(row);
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
    // one level finer grows with the fade as its back does (fade 2), as the
    // cell had it.)
    ps.push(plane([0, -1, 0], -b.y0), plane([0, 1, 0], b.y1));
    if (b.ter) {
      const H12 = T.FTH[k * 17 + b.tH] * S, f = lv === 1 ? 2 : 0;
      if (up) ps.push(lv === 0 ? plane([0, -12, 0], -(12 * b.yin - H12), f, b.fz) : plane([0, -1, 0], -(12 * b.yin - H12) / 12, f, b.fz));
      else ps.push(lv === 0 ? plane([0, 12, 0], 12 * b.yin + H12, f, b.fz) : plane([0, 1, 0], (12 * b.yin + H12) / 12, f, b.fz));
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
    return ps;
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
    pieces.push({ b, pl, fp, bb, src });
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
  const rows = []; // (pieces as listed: { pl, bb, flags, src })
  const listed = (p, pl = p.pl, bb = p.bb) => rows.push({ pl, bb, lv: p.b.lv, src: p.src }) - 1;
  let deafCut = 0;
  for (const p of pieces) {
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
      continue;
    }
    // (One level finer: a cell it may be in (skin, its face's bit), one it
    // may run on into (open, or out of the table: the city's air), or deaf.)
    const ok = [], deaf = [];
    for (const [x, y, z] of cells) {
      const ci = cellIndex(x, y, z);
      if (ci >= 0 && skinOf[b.k].has(ci)) ok.push(ci);
      else if (ci >= 0 && !V.open[ci]) deaf.push(ci);
    }
    if (!ok.length) continue;
    if (!deaf.length) { const i = listed(p); for (const ci of ok) lists[1][ci].push(i); continue; }
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
        lists[1][ci].push(listed(p, pl, cb));
      }
    }
  }
  // (Each list in a stable order: by source.)
  for (const ls of lists) for (const l of ls) l.sort((i, j) => rows[i].src - rows[j].src || i - j);
  // The omitted bound: the cells to the nearest cell with a list (Chebyshev, at most 15).
  const mOf = (ls) => {
    const m = new Uint8Array(NC).fill(15);
    const queue = [];
    for (let ci = 0; ci < NC; ci++) if (ls[ci].length) (m[ci] = 0), queue.push(ci);
    for (let h = 0; h < queue.length; h++) {
      const ci = queue[h], x = ci % vsz[0], y = Math.floor(ci / vsz[0]) % vsz[1], z = Math.floor(ci / vsz[0] / vsz[1]);
      if (m[ci] >= 15) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= vsz[0] || Y >= vsz[1] || Z >= vsz[2]) continue;
        const cj = X + vsz[0] * (Y + vsz[1] * Z);
        if (m[cj] > m[ci] + 1) (m[cj] = m[ci] + 1), queue.push(cj);
      }
    }
    return m;
  };
  const m0 = mOf(lists[0]), m1 = mOf(lists[1]);

  // --- The rows: the cells', the lists', the pieces', their planes' ints and the planes', in turn.
  const at = {}, nRows = (n) => Math.ceil(n / 4);
  let nList = 0, nRun = 0;
  for (const ls of lists) for (const l of ls) nList += l.length;
  for (const r of rows) (r.first = nRun), (nRun += r.pl.length);
  at.LIST0 = NC;
  at.PIECE0 = at.LIST0 + nRows(nList);
  at.RUN0 = at.PIECE0 + 2 * rows.length;
  at.PLANE0 = at.RUN0 + nRows(nRun);
  const total = at.PLANE0 + planeRows.length, H = Math.ceil(total / ROW_WIDTH);
  const data = new Int32Array(ROW_WIDTH * H * 4);
  let li = 4 * at.LIST0;
  for (let ci = 0; ci < NC; ci++) for (let lv = 0; lv < 2; lv++) {
    const l = lists[lv][ci];
    data[4 * ci + 2 * lv] = li;
    data[4 * ci + 2 * lv + 1] = l.length | ((lv ? m1 : m0)[ci] << 16);
    for (const i of l) data[li++] = at.PIECE0 + 2 * i;
  }
  const e16 = (v) => { const x = Math.floor(v) + 32768; if (x < 0 || x > 65535) throw new Error('relief: bounds beyond 16 bits'); return x; };
  rows.forEach((r, i) => {
    const o = 4 * (at.PIECE0 + 2 * i);
    data.set([4 * at.RUN0 + r.first, r.pl.length, r.lv, r.src], o);
    for (let a = 0; a < 3; a++) data[o + 4 + a] = e16(r.bb[a][0] - 1) | (e16(Math.ceil(r.bb[a][1]) + 1) << 16);
    r.pl.forEach((pi, k) => (data[4 * at.RUN0 + r.first + k] = at.PLANE0 + pi));
  });
  planeRows.forEach((r, i) => data.set(r, 4 * (at.PLANE0 + i)));
  if (4 * total >= 2 ** 31) throw new Error('relief: too many rows');
  const ms = typeof performance === 'undefined' ? 0 : performance.now() - t0;
  return {
    data, size: [ROW_WIDTH, H], at, dirs: DIRS,
    stats: { boxes: boxes.length, pieces: pieces.length, rows: rows.length, planes: planeRows.length, deafCut, refs: [lists[0].reduce((s, l) => s + l.length, 0), lists[1].reduce((s, l) => s + l.length, 0)], ms: Math.round(ms) },
    // (For the checks: each listed piece's planes and bounds, and the lists.)
    _pieces: rows.map((r) => ({ lv: r.lv, src: r.src, planes: r.pl.map((pi) => floatOf(pi, r.lv)), rows: r.pl.map((pi) => planeRows[pi]), bb: r.bb })), _lists: lists, fval,
  };
}
