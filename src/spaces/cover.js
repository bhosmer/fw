// The relief's cover (plan .claude/design/relief-cover.md): pieces of air
// laid over the seams of its physical pieces, so that wherever two or more
// of them meet with air on both sides, one piece holds the point strictly.
// Each lies in the union of the pieces it is made from (its members), so it
// adds no air. Three kinds:
// - a bridge across each shared side (two pieces touching on a plane, with
//   area): both members' planes but the shared one;
// - a connector at each junction line (where two of a piece's shared sides
//   meet) and each vertex no piece made so far holds: every member's planes
//   but those shared, turned, with another member; certified in the union
//   by the sign cells of the shared planes (each lands in a member);
// - between the levels, both of these where the members are of both (one
//   level finer; bounded on the city member's side to a cell past the shared
//   plane), cut clear of the solids without relief, where the city's own air
//   is clipped.
// Each keeps the planes it was made by dropping (its seams): see listedCarve
// in relief.js, which asks a cover piece only where one of them is near.
// The pieces in: { id, lv, planes, fp, box } (each plane { n, K, lv, fade,
// fz }, n . X <= K in its level's units from the building's origin; fp its
// planes as { a: n, b: K }; box its bounds, in its level's units). Floats
// with margins; what the cover covers is checked exhaustively apart, at
// several fades (tests/unit/coverage.js), and that it adds no air by
// relief.test.js.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hyp = (v) => Math.hypot(v[0], v[1], v[2]);
// (Where three planes a . X = b meet, by Cramer's rule written out; null
// where they hardly do: the determinant under 1e-12, or, rel given, under
// rel times the product of the normals' lengths.)
function meet3(A, b, rel = 0) {
  const [a0, a1, a2] = A[0], [b0, b1, b2] = A[1], [c0, c1, c2] = A[2];
  const m0 = b1 * c2 - b2 * c1, m1 = b2 * c0 - b0 * c2, m2 = b0 * c1 - b1 * c0, D = a0 * m0 + a1 * m1 + a2 * m2;
  if (Math.abs(D) < (rel ? rel * hyp(A[0]) * hyp(A[1]) * hyp(A[2]) : 1e-12)) return null;
  const [p, q, r] = b;
  return [(p * m0 - a1 * (q * c2 - b2 * r) + a2 * (q * c1 - b1 * r)) / D, (a0 * (q * c2 - b2 * r) + p * m1 + a2 * (b0 * r - q * c0)) / D, (a0 * (b1 * r - q * c1) - a1 * (b0 * r - q * c0) + p * m2) / D];
}
// (A convex polygon, its corners in turn as flat x, y, z, cut to where
// a . X <= b: as Sutherland and Hodgman cut one, a margin of tol |a|
// allowed.)
function cutPolygon(poly, a, b, tol) {
  const out = [], e = tol * hyp(a), n = poly.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, P0 = poly[3 * i], P1 = poly[3 * i + 1], P2 = poly[3 * i + 2], Q0 = poly[3 * j], Q1 = poly[3 * j + 1], Q2 = poly[3 * j + 2];
    const p = a[0] * P0 + a[1] * P1 + a[2] * P2 - b, q = a[0] * Q0 + a[1] * Q1 + a[2] * Q2 - b;
    if (p <= e) out.push(P0, P1, P2);
    if ((p <= e) !== (q <= e)) {
      const t = p / (p - q);
      out.push(P0 + t * (Q0 - P0), P1 + t * (Q1 - P1), P2 + t * (Q2 - P2));
    }
  }
  return out;
}
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
// (The polygon plane s cuts from the planes fp, within box (bounds that hold
// it): its corners. The plane's square over the box, cut by the box's sides
// and then by each plane of fp but s.)
function onPlane(s, fp, box, tol = 1e-7) {
  const l = hyp(s.a), n = [s.a[0] / l, s.a[1] / l, s.a[2] / l], off = s.b / l;
  const u0 = cross3(n, Math.abs(n[0]) < 0.9 ? AXES[0] : AXES[1]), lu = hyp(u0), u = [u0[0] / lu, u0[1] / lu, u0[2] / lu], v = cross3(n, u);
  const c = [(box[0][0] + box[0][1]) / 2, (box[1][0] + box[1][1]) / 2, (box[2][0] + box[2][1]) / 2];
  const h = Math.hypot(box[0][1] - box[0][0], box[1][1] - box[1][0], box[2][1] - box[2][0]) + 1, w = dot(n, c) - off;
  // (The square about the box's middle, on the plane.)
  const m = [c[0] - n[0] * w, c[1] - n[1] * w, c[2] - n[2] * w];
  let poly = [];
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) poly.push(m[0] + h * (x * u[0] + y * v[0]), m[1] + h * (x * u[1] + y * v[1]), m[2] + h * (x * u[2] + y * v[2]));
  for (let k = 0; k < 6 && poly.length; k++) poly = cutPolygon(poly, AXES[k], k < 3 ? box[k][1] : -box[k - 3][0], 0);
  for (const p of fp) if (p !== s && poly.length) poly = cutPolygon(poly, p.a, p.b, tol);
  const out = [];
  for (let i = 0; i < poly.length; i += 3) out.push([poly[i], poly[i + 1], poly[i + 2]]);
  return out;
}
// (A convex piece's corners, within box (bounds that hold it): those of each
// of its sides' polygons.)
function vertices(fp, box, tol = 1e-7) {
  const out = [];
  for (const s of fp) for (const X of onPlane(s, fp, box, tol)) out.push(X);
  return out;
}
function aabb(vs) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], v[a])), (hi[a] = Math.max(hi[a], v[a]));
  return [0, 1, 2].map((a) => [lo[a], hi[a]]);
}
// (A piece's distance at X: the most of its planes', l each one's |a|.)
function dist(fp, X) {
  let d = -Infinity;
  for (const p of fp) d = Math.max(d, (p.a[0] * X[0] + p.a[1] * X[1] + p.a[2] * X[2] - p.b) / (p.l ?? hyp(p.a)));
  return d;
}
function rank(vs, tol = 1e-6) {
  if (vs.length < 2) return vs.length ? 0 : -1;
  const d = vs.slice(1).map((v) => v.map((x, a) => x - vs[0][a]));
  const big = d.filter((v) => Math.hypot(...v) > tol);
  if (!big.length) return 0;
  const e1 = big[0];
  const c = big.map((v) => cross3(e1, v)).find((x) => Math.hypot(...x) > tol * Math.hypot(...e1));
  if (!c) return 1;
  return big.some((v) => Math.abs(dot(c, v)) > tol * Math.hypot(...c)) ? 3 : 2;
}

// (The segment where planes s1 and s2 meet, within the planes fp: its ends.)
function onLine(s1, s2, fp, tol = 1e-7) {
  const d = cross3(s1.a, s2.a), dd = dot(d, d);
  if (dd < 1e-18 * dot(s1.a, s1.a) * dot(s2.a, s2.a)) return null;
  const X0 = meet3([s1.a, s2.a, d], [s1.b, s2.b, 0], 1e-9);
  if (!X0) return null;
  let lo = -Infinity, hi = Infinity;
  for (const p of fp) {
    if (p === s1 || p === s2) continue;
    const r = dot(p.a, d), c = p.b - dot(p.a, X0);
    if (Math.abs(r) < 1e-12 * hyp(p.a) * Math.sqrt(dd)) { if (c < -tol * hyp(p.a)) return null; continue; }
    if (r > 0) hi = Math.min(hi, c / r); else lo = Math.max(lo, c / r);
  }
  if (!(hi - lo > 1e-6)) return null;
  return [X0.map((x, a) => x + lo * d[a]), X0.map((x, a) => x + hi * d[a])];
}

// The cover of the pieces members (see the head of this file), R a level's
// cell in the finer level's units; bare, the boxes of the solids without
// relief (cells from the building's origin). Each cover piece: { lv,
// planes, fp, box, members (ids), cross (of both levels), dropped (its
// seams: the planes it was made by dropping) }; and how many connectors
// could not be made.
export function coverOf(members, { R, bare = [] }) {
  // (A plane's key, at level lv: its normal and K at that level reduced by
  // their gcd, its sign by the first part not 0, and the side apart; and
  // planes as floats at level lv.)
  const key = (p, lv = p.lv) => {
    const K = p.K * R ** (lv - p.lv), n = p.n;
    const g = gcd(gcd(gcd(n[0], n[1]), n[2]), K) || 1, s = Math.sign(n.find((x) => x !== 0));
    return { k: `${n.map((x) => (s * x) / g).join(',')}|${(s * K) / g}`, side: s };
  };
  const floatPlanes = (ps, lv) => ps.map((p) => ({ a: p.n, b: p.K * R ** (lv - p.lv), l: hyp(p.n) }));
  // (Bounds at level lv that hold the pieces H, and so any piece in their union.)
  const hull = (H, lv) => [0, 1, 2].map((a) => [Math.min(...H.map((Y) => Y.box1[a][0])) * R ** (lv - 1) - 1e-6, Math.max(...H.map((Y) => Y.box1[a][1])) * R ** (lv - 1) + 1e-6]);
  // (A seam the fade moves would break the certificate as the level fades:
  // a dropped plane must stay, in every member that has it.)
  const fixed = (H, k) => H.every((Y) => Y.planes.every((q, i) => Y.keys[i].k !== k || !q.fade));

  // Contacts: for each geometric plane (its key at lv 1), the pieces with it,
  // by side; a pair across it (opposite sides, boxes meeting) is a contact if
  // the polygon the two pieces' other planes cut from the plane has area.
  const byKey = new Map();
  for (const p of members) {
    p.keys = p.planes.map((q) => key(q, 1));
    p.fp1 = floatPlanes(p.planes, 1);
    p.box1 = p.box.map(([a, b]) => [a * R ** (1 - p.lv), b * R ** (1 - p.lv)]);
    p.keys.forEach((kk, i) => {
      if (!byKey.has(kk.k)) byKey.set(kk.k, []);
      byKey.get(kk.k).push({ p, i, side: kk.side });
    });
  }
  const overlap = (a, b, e = 1e-6) => a.every(([x0, x1], i) => x1 >= b[i][0] - e && x0 <= b[i][1] + e);
  const contacts = [], seenC = new Set();
  for (const [k, list] of byKey) {
    const pos = list.filter((x) => x.side > 0), neg = list.filter((x) => x.side < 0);
    if (!pos.length || !neg.length) continue;
    for (const a of pos)
      for (const b of neg) {
        if (a.p === b.p) continue;
        if (!overlap(a.p.box1, b.p.box1)) continue;
        const s = a.p.fp1[a.i], fp = [...a.p.fp1, ...b.p.fp1.filter((_, j) => j !== b.i)];
        const vs = onPlane(s, fp, a.p.box1.map(([x0, x1], k) => [Math.max(x0, b.p.box1[k][0]) - 1e-6, Math.min(x1, b.p.box1[k][1]) + 1e-6]));
        if (vs.length < 3 || rank(vs, 1e-6) !== 2) continue;
        const ck = `${k}|${a.p.id}|${b.p.id}`;
        if (seenC.has(ck)) continue;
        seenC.add(ck);
        contacts.push({ P: a.p, i: a.i, Q: b.p, j: b.i, key: k, vs });
      }
  }

  // Bridges: the two pieces' planes but the shared one, each side's (the pair
  // is in the union: on P's side of the plane it is in P, else in Q). One
  // level finer where either is (lv 1 owns a pair between levels), bounded
  // there to a cell beyond the shared plane on the coarse piece's side (a
  // cover plane: so that its reach fits its level).
  const cover = [];
  // (Planes as one where they are one: the same plane, side and fade.)
  const uniqAt = (ps, lv) => {
    const seen = new Set(), uniq = [];
    for (const q of ps) {
      const kk = key(q, lv), id = `${kk.k}|${kk.side}|${q.fade ?? 0}|${q.fade ? q.fz : 0}`;
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(q);
    }
    return uniq;
  };
  const coverPlane = (q) => ({ n: q.n.map((x) => -x), K: -(q.K * R - Math.ceil(hyp(q.n) * R)), lv: 1, fade: 0 });
  for (const c of contacts) {
    const lv = Math.max(c.P.lv, c.Q.lv);
    // (Every plane of either on the shared plane goes: a terrace's ceiling can lie on its row's top.)
    if (!fixed([c.P, c.Q], c.key)) throw new Error('cover: a seam that moves with the fade');
    const ps = [...c.P.planes.filter((_, i) => c.P.keys[i].k !== c.key), ...c.Q.planes.filter((_, j) => c.Q.keys[j].k !== c.key)];
    if (c.P.lv !== c.Q.lv) {
      const C = c.P.lv === 0 ? c.P : c.Q;
      ps.push(coverPlane(C.planes[C === c.P ? c.i : c.j]));
    }
    const uniq = uniqAt(ps, lv), fp = floatPlanes(uniq, lv), vs = vertices(fp, hull([c.P, c.Q], lv));
    if (vs.length < 4 || rank(vs) < 3) continue;
    cover.push({ lv, planes: uniq, fp, box: aabb(vs), members: [c.P.id, c.Q.id], cross: c.P.lv !== c.Q.lv, dropped: [c.P.planes[c.i]] });
  }

  // Junctions: for a piece P and two of its contacts on planes that meet (not
  // parallel), the segment where the two facets meet; the pieces whose
  // closures hold its middle are the junction's; if a small circle round the
  // segment there is all in them (the line is inside the union), a connector:
  // each member's planes but those it shares (turned) with another member.
  const byPiece = new Map();
  for (const c of contacts)
    for (const [X, i, Y] of [[c.P, c.i, c.Q], [c.Q, c.j, c.P]]) {
      if (!byPiece.has(X.id)) byPiece.set(X.id, []);
      byPiece.get(X.id).push({ i, Y, c });
    }
  const junc = new Map();
  let failed = 0;
  // (A connector from the pieces H holding a point: each one's planes but
  // those it shares, turned, with another of them; it must hold X (lv 1
  // units) strictly, and be certified.)
  const connectorOf = (H, X) => {
    const lv = Math.max(...H.map((x) => x.lv));
    const sides = new Map();
    for (const Y of H) Y.keys.forEach((kk) => { if (!sides.has(kk.k)) sides.set(kk.k, new Set()); sides.get(kk.k).add(kk.side); });
    const shared = new Set([...sides].filter(([, s]) => s.size === 2).map(([k]) => k));
    for (const k of shared) if (!fixed(H, k)) throw new Error('cover: a seam that moves with the fade');
    const ps = [];
    for (const Y of H) Y.planes.forEach((q, i) => { if (!shared.has(Y.keys[i].k)) ps.push(q); });
    if (new Set(H.map((x) => x.lv)).size > 1) for (const C of H.filter((x) => x.lv === 0)) C.planes.forEach((q, i) => { if (shared.has(C.keys[i].k)) ps.push(coverPlane(q)); });
    const uniq = uniqAt(ps, lv), fpc = floatPlanes(uniq, lv), vs = vertices(fpc, hull(H, lv));
    if (vs.length < 4 || rank(vs) < 3 || !(dist(fpc, X.map((x) => x / R ** (1 - lv))) < -1e-9) || !certify(fpc, vs, H, [...shared], lv, floatPlanes)) return void failed++;
    const dropped = [...shared].map((k) => { for (const Y of H) { const i = Y.keys.findIndex((kk) => kk.k === k); if (i >= 0) return Y.planes[i]; } return null; });
    const con = { lv, planes: uniq, fp: fpc, box: aabb(vs), members: H.map((x) => x.id), cross: new Set(H.map((x) => x.lv)).size > 1, dropped };
    cover.push(con);
    return con;
  };
  // (Whether a small ball (or circle square to dir) round X is in the pieces H.)
  const SPH = []; for (let i = 0; i < 40; i++) { const z = 1 - (2 * (i + 0.5)) / 40, rr = Math.sqrt(1 - z * z), th = i * 2.39996 + 0.1; SPH.push([rr * Math.cos(th), rr * Math.sin(th), z]); }
  const ballIn = (H, X, rho = 2e-6) => SPH.every((e) => H.some((Y) => dist(Y.fp1, X.map((x, a) => x + rho * e[a])) < 0));
  const verts = [], byHolders = new Map();
  for (const P of members) {
      const cs = byPiece.get(P.id) ?? [];
      for (let a = 0; a < cs.length; a++)
        for (let b = a + 1; b < cs.length; b++) {
          const ca = cs[a], cb = cs[b];
          if (ca.i === cb.i) continue;
          const s1 = P.fp1[ca.i], s2 = P.fp1[cb.i];
          const seg = onLine(s1, s2, [...P.fp1, ...ca.Y.fp1, ...cb.Y.fp1]);
          if (!seg) continue;
          // (The pieces round the line: P, the two, and the neighbours of each.)
          const near = new Set([P, ca.Y, cb.Y]);
          for (const X of [P, ca.Y, cb.Y]) for (const e of byPiece.get(X.id) ?? []) near.add(e.Y);
          const nearL = [...near];
          // (The line, from the segment's ends on: where it meets any plane of them.)
          const d = seg[1].map((x, k) => x - seg[0][k]);
          const ts = new Set([0, 1]);
          for (const X of nearL) for (const q of X.fp1) {
            const r = dot(q.a, d);
            if (Math.abs(r) < 1e-12 * hyp(q.a) * hyp(d)) continue;
            const t = (q.b - dot(q.a, seg[0])) / r;
            if (t > 1e-9 && t < 1 - 1e-9) ts.add(t);
          }
          const tl = [...ts].sort((x, y) => x - y);
          const pt = (t) => seg[0].map((x, k) => x + t * d[k]);
          const cr = cross3(s1.a, s2.a), dir = cr.map((x) => x / hyp(cr)), u = s1.a.map((x) => x / hyp(s1.a)), v = cross3(dir, u);
          for (let i = 0; i + 1 < tl.length; i++) {
            if (tl[i + 1] - tl[i] < 1e-9) continue;
            const mid = pt((tl[i] + tl[i + 1]) / 2);
            const Hall = nearL.filter((X) => dist(X.fp1, mid) < 1e-6).sort((x, y) => x.id - y.id);
            if (Hall.some((X) => dist(X.fp1, mid) < -1e-9)) continue;
            // (Each level's own holders first: so that a level asked alone has
            // no seam; then, if only both together hold the line, a joining one.)
            const groups = [Hall.filter((X) => X.lv === 1), Hall.filter((X) => X.lv === 0)].filter((H) => H.length >= 2);
            const circleIn = (H) => {
              for (let s = 0; s < 16; s++) {
                const th = (2 * Math.PI * (s + 0.37)) / 16, Y = mid.map((x, k) => x + 1e-3 * (Math.cos(th) * u[k] + Math.sin(th) * v[k]));
                if (!H.some((X) => dist(X.fp1, Y) < 0)) return false;
              }
              return true;
            };
            let ownDone = false;
            for (const H of [...groups, Hall]) {
              if (H === Hall && (ownDone || groups.some((g) => g.length === Hall.length))) break;
              const jk = H.map((x) => x.id).join(',') + '@' + s1.a.join() + '|' + s2.a.join() + '@' + mid.map((x) => x.toFixed(2)).join(',');
              if (junc.has(jk)) { if (junc.get(jk) && H !== Hall) ownDone = true; continue; }
              const inside = circleIn(H);
              junc.set(jk, inside);
              if (!inside) continue;
              if (H !== Hall) ownDone = true;
              const hk = H.map((x) => x.id).join(',');
              const c0 = byHolders.get(hk);
              if (c0 && dist(c0.fp, mid.map((x) => x / R ** (1 - c0.lv))) < -1e-9) continue;
              const con = connectorOf(H, mid);
              if (!byHolders.has(hk)) byHolders.set(hk, con);
            }
          }
          for (const t of tl) verts.push({ X: pt(t), near: nearL });
        }
    }
  // Vertices: each point where the line meets another plane, inside the
  // union, that no piece made so far holds strictly: a connector of its own.
  const coverIdx = new Map(); // (lv 1 units, cells of R)
  const cellOf = (X) => X.map((x) => Math.floor(x / R)).join();
  const addIdx = (c, i) => { const sc = R ** (1 - c.lv); const lo = c.box.map(([a]) => Math.floor((a * sc) / R)), hi = c.box.map(([, b]) => Math.floor((b * sc) / R)); for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; if (!coverIdx.has(k)) coverIdx.set(k, []); coverIdx.get(k).push(c); } };
  cover.forEach(addIdx);
  members.forEach(addIdx);
  const seenV = new Set();
  for (const { X, near } of verts) {
    const k = X.map((x) => x.toFixed(4)).join();
    if (seenV.has(k)) continue;
    seenV.add(k);
    const Hall = near.filter((Y) => dist(Y.fp1, X) < 1e-6).sort((x, y) => x.id - y.id);
    for (const H of [Hall.filter((Y) => Y.lv === 1), Hall.filter((Y) => Y.lv === 0), Hall]) {
      if (H.length < 2 || !ballIn(H, X)) continue;
      const own = H !== Hall || new Set(H.map((y) => y.lv)).size === 1;
      const held = (coverIdx.get(cellOf(X)) ?? []).some((c) => (own ? !c.cross && c.lv === H[0].lv : c.lv === 1) && dist(c.fp, X.map((x) => x / R ** (1 - c.lv))) < -1e-7);
      if (!held) { const con = connectorOf(H, X); if (con) addIdx(con); }
      if (H !== Hall) break;
    }
  }
  // The pieces joining the levels hold city air one level finer, where the
  // city's own is clipped at the solids without relief (bareIn): each that
  // meets one is replaced by its parts past each of the solid's six sides
  // (overlapping: their union is the piece less the solid).
  const BARE = bare.map(([lo, hi]) => [lo.map((x) => x * R), hi.map((x) => x * R)]);
  const clear = [];
  for (const c of cover) {
    let parts = [c];
    if (c.cross)
      for (const [lo, hi] of BARE) {
        const next = [];
        for (const p of parts) {
          if (!p.box.every(([a, b], i) => b > lo[i] && a < hi[i])) { next.push(p); continue; }
          for (let a = 0; a < 3; a++)
            for (const past of [-1, 1]) {
              // (Past the low side: x <= lo; past the high side: -x <= -hi.)
              const n = [0, 0, 0];
              n[a] = past < 0 ? 1 : -1;
              const planes = [...p.planes, { n, K: past < 0 ? lo[a] : -hi[a], lv: 1, fade: 0 }], fp = floatPlanes(planes, 1), vs = vertices(fp, p.box);
              if (vs.length >= 4 && rank(vs) === 3) next.push({ ...p, planes, fp, box: aabb(vs) });
            }
        }
        parts = next;
      }
    clear.push(...parts);
  }
  return { cover: clear, failed };
}


// Every full-dimensional sign cell of the shared planes within the connector
// (fp, its vertices vs) lands in a member: for each, some member's shared
// planes all on its own side there. Planes that do not cut the connector
// leave it on one side. (Floats, with margins: floatPlanes as coverOf's.)
function certify(fp, vs, mem, sk, lv, floatPlanes) {
  const planeOf = new Map();
  for (const X of mem) X.planes.forEach((q, i) => { const k = X.keys[i].k; if (sk.includes(k) && !planeOf.has(k)) planeOf.set(k, { q, side: X.keys[i].side }); });
  const live = [], fixed = new Map();
  for (const k of sk) {
    const { q, side } = planeOf.get(k), [p] = floatPlanes([q], lv);
    const s = vs.map((X) => (dot(p.a, X) - p.b) / hyp(p.a));
    if (s.some((x) => x > 1e-7) && s.some((x) => x < -1e-7)) live.push(k);
    else fixed.set(k, s.every((x) => x <= 1e-7) ? side : -side);
  }
  const n = live.length;
  if (n > 12) return false;
  for (let m = 0; m < 1 << n; m++) {
    const sideOf = (k) => (fixed.has(k) ? fixed.get(k) : (m >> live.indexOf(k)) & 1 ? 1 : -1);
    const extra = live.map((k) => {
      const { q, side } = planeOf.get(k), flip = sideOf(k) === side ? 1 : -1;
      return { n: q.n.map((x) => flip * x), K: flip * q.K, lv: q.lv };
    });
    const cv = vertices([...fp, ...floatPlanes(extra, lv)], aabb(vs).map(([a, b]) => [a - 1e-6, b + 1e-6]), 1e-7);
    if (cv.length < 4 || rank(cv, 1e-6) < 3) continue;
    if (!mem.some((X) => X.keys.every((kk) => !sk.includes(kk.k) || sideOf(kk.k) === kk.side))) return false;
  }
  return true;
}

// (What the cover is built by, for the key the relief's rows are kept by:
// see builtBy in relief.js.)
export const coverBuiltBy = () => [coverOf, certify, cutPolygon, onPlane, onLine, meet3, vertices, aabb, dist, rank, dot, gcd, cross3, hyp, JSON.stringify(AXES)].map(String);
