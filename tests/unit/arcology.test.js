import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { makeArcology, ARCOLOGY, CITY, ROW_ID, ROWS, G, VOLUME, _V2 } from '../../src/spaces/arcology.js';
import { levelSeed, wrapId as wrapIdR, hashCell } from '../../src/util.js';
import { rand } from './rand.js';
import { Flight, UP, DOWN } from '../../src/flight.js';
import { airAt } from '../../src/air.js';
import { INSIDE } from './inside.js';
import { rayHolds } from './rays.js';
import { clippedRays } from './clipped.js';
import { M } from '../../src/spaces/halls.js';
// (The world's own _V2, where a test's variant has its own.)
const V2 = _V2;

const R = arcology.R;
const P = R * R;
const wrapId = (id) => wrapIdR(id, R);
const seed = levelSeed(CITY);

// The distance at a point given as lattice coordinates q (0..R) in cell id
// of the city's level.
function air(q, id) {
  const L = q.map(Math.round);
  return arcology.cellAir(L, q.map((x, a) => x - L[a]), id, seed, undefined, CITY);
}
const anywhere = (rnd, row) => wrapId([Math.floor(rnd() * P), row, Math.floor(rnd() * P)]);

// (As for the halls: a distance that never overstates changes no faster
// than the point moves.) In the city, the halls under it and the sky over it.
test('the city never changes faster than the point moves', () => {
  const rnd = rand(7);
  let worst = 0;
  for (let n = 0; n < 30000; n++) {
    const id = anywhere(rnd, ROW_ID + [-1, 0, 0, 1, 2][n % 5]);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const step = 10 ** (rnd() * 3 - 3);
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...dir);
    const q2 = q.map((x, a) => Math.min(R - 0.51, Math.max(0.51, x + (dir[a] / len) * step)));
    const moved = Math.hypot(...q2.map((x, a) => x - q[a]));
    const change = Math.abs(air(q2, id) - air(q, id));
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${id}`);
  }
  assert.ok(worst > 0.5, 'the test moves through enough surfaces to mean something');
});

// Above the city there is only sky: a cell there says how far down the city
// is, which is never more than how far down its air is.
test('over the city, a cell says no more than how far down it is', () => {
  const rnd = rand(9);
  for (let n = 0; n < 2000; n++) {
    const id = anywhere(rnd, ROW_ID + ROWS + Math.floor(rnd() * 3));
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const down = q[1] + R * (id[1] - ROW_ID - ROWS);
    assert.ok(Math.abs(air(q, id) - down) < 1e-9);
  }
});

test('coarser than the city, all is solid', () => {
  for (const level of [CITY - 1, CITY - 5]) {
    assert.ok(arcology.cellAir([12, 12, 12], [0, 0, 0], [0, ROW_ID, 0], levelSeed(level), undefined, level) >= 1e8);
  }
});

// Fly straight ahead (yaw 0, level) n steps from somewhere in the city,
// given as the digits of our level -2 and -1 cells.
function flyFrom(d2, d1, frac, n, each) {
  const flight = new Flight(arcology);
  flight.pos.F = -1;
  flight.pos.frac = frac;
  flight.pos.digits.set(-2, d2);
  flight.pos.digits.set(-1, d1);
  flight.begin();
  for (let i = 0; i < n; i++) {
    flight.step(1 / 60, [0, 0, -1]);
    each(flight, i);
  }
}

test('flying level just over the city goes as fast as its buildings are clear', () => {
  // (Not by how far over the sky's plane we are: half a cell over it, that
  // was about a cell a second.)
  let moved = 0;
  flyFrom([12, ROW_ID % R + ROWS, 12], [12, 0, 0], [0.5, 0.5, 0.5], 600, (f, i) => {
    if (i >= 300) moved += Math.hypot(...f.lastMove.delta) * Math.pow(R, -1 - f.lastMove.F);
  });
  assert.ok(moved > 10, `${moved} cells in 5 s`);
});

test('pressed against a building many levels down, flight stays out of it', () => {
  // (Toward the face of a shaft of the great hexahedron, from just in front.)
  flyFrom([12, ROW_ID % R, 12], [9, 3, 8], [0.13, 0.18, 0.5], 6000, (f) => assert.ok(f.clearance > 0, `F ${f.pos.F}: ${f.clearance}`));
});

// The cells the relief table says something of (see VOLUME), as cells of
// level CITY + 1 measured from the middle city cell's corner; and the
// distance at a point in one (lattice units q, 0..R), as cellAir has it.
const C = R / 2, seed1 = levelSeed(CITY + 1);
const reliefCells = (() => {
  const { lo, size, data } = VOLUME, out = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++)
    if (data[_V2.BITS.WORDS * (x + size[0] * (y + size[1] * z))]) out.push([x + lo[0], y + lo[1], z + lo[2]]);
  return out;
})();
function air1(v, q) {
  const id = wrapId([v[0] + R * C, v[1] + (ROW_ID % R) * R, v[2] + R * C]);
  const up = wrapId([0, 1, 2].map((a) => (a === 1 ? ROW_ID : C + R * C) + Math.floor(v[a] / R)));
  const L = q.map(Math.round);
  return arcology.cellAir(L, q.map((x, a) => x - L[a]), id, seed1, undefined, CITY + 1, up);
}

test('the buildings\' relief never changes faster than the point moves', () => {
  const rnd = rand(11);
  let worst = 0;
  assert.ok(reliefCells.length > 5000, `${reliefCells.length} cells with relief`);
  for (let n = 0; n < 40000; n++) {
    const v = reliefCells[Math.floor(rnd() * reliefCells.length)];
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const step = 10 ** (rnd() * 3 - 2);
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...dir);
    const q2 = q.map((x, a) => Math.min(R - 0.51, Math.max(0.51, x + (dir[a] / len) * step)));
    const moved = Math.hypot(...q2.map((x, a) => x - q[a]));
    const change = Math.abs(air1(v, q2) - air1(v, q));
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${v}`);
  }
  assert.ok(worst > 0.5, 'the test moves through enough surfaces to mean something');
});

// (A cell clear of every solid is the city's air, whatever this level says;
// and so is a point p of cell c outside every solid: the levels' air adds up.)
const clear = (c) => {
  const { lo, at, within, open, kind } = VOLUME, t = c.map((x, a) => x - lo[a]);
  return within(t) && open[at(t)] && !kind[at(t)];
};
// (Exactly, one level finer: n . (R (c - ORIGIN) + p) > R K, for some plane
// of every solid, as planeAt has the planes. It only says which points to
// leave out, so it catches a plane set too far out, not one too far in.)
const outside = (c, p) => {
  const X = c.map((x, a) => R * (x - _V2.ORIGIN[a]) + p[a]);
  return _V2.SOLID_PI.every((pl) => pl.some(([nx, ny, nz, RK]) => nx * X[0] + ny * X[1] + nz * X[2] > RK));
};
test('where relief crosses from one cell to the next, both cells say so', () => {
  const rnd = rand(12);
  let crossed = 0;
  for (let n = 0; n < 40000; n++) {
    const v = reliefCells[Math.floor(rnd() * reliefCells.length)];
    const a = Math.floor(rnd() * 3), side = rnd() < 0.5 ? 1 : -1;
    const u = v.slice();
    u[a] += side;
    if (clear(v) || clear(u)) continue;
    // A point on the face between them, as each has it.
    const q = [0, 1, 2].map(() => 0.5 + rnd() * (R - 1));
    q[a] = side > 0 ? R : 0;
    const p = q.slice();
    p[a] = side > 0 ? 0 : R;
    const here = air1(v, q), there = air1(u, p);
    if (here < -0.05 || there < -0.05) crossed++;
    assert.ok(!(here < -0.05 && there > 0.05) && !(there < -0.05 && here > 0.05), `${v} says ${here}, ${u} says ${there}, at ${q}`);
  }
  assert.ok(crossed > 100, `${crossed} points in air on a face`);
});

// A skin cell's pockets one level finer, and a cell's openings, run on into
// the cells past the sides the table opens (see runOn in arcology.js):
// wherever they say air there, the cell the point is in says so too, or the
// point is the city's air.
const { WORDS, OPEN_AT, CROSS_AT } = _V2.BITS;
// (Which cells, and where their run-on is: the pockets' in the first and
// second words, the openings' in the fourth.)
for (const [what, which, ow, cw] of [['a skin cell\'s pockets', (w) => (w[0] & 3) === 2, 0, 1], ['a cell\'s openings', (w) => w[2], 3, 3]])
test(`where ${what} run on, the cells they run into say so`, () => {
  const { lo, at, data } = VOLUME, rnd = rand(13);
  const skin = reliefCells.filter((c) => { const i = WORDS * at(c.map((x, a) => x - lo[a])); return which(data.subarray(i, i + WORDS)); });
  let tried = 0;
  for (let n = 0; n < 40000; n++) {
    const v = skin[Math.floor(rnd() * skin.length)];
    const i = WORDS * at(v.map((x, a) => x - lo[a])), open = (data[i + ow] >>> OPEN_AT) & 63, cross = (data[i + cw] >>> CROSS_AT) & 1;
    // A point in the run-on box (or, run on as three pieces, in one of them),
    // outside the cell.
    const only = cross ? Math.floor(rnd() * 3) : -1;
    const q = [0, 1, 2].map((a) => {
      const on = (side) => open & (side << (2 * a)) && (only < 0 || only === a);
      const lo1 = on(2) ? -R : 0, hi1 = on(1) ? 2 * R : R;
      return lo1 + 0.5 + rnd() * (hi1 - lo1 - 1);
    });
    const o = q.map((x) => Math.floor(x / R));
    if (o.every((x) => x === 0)) continue;
    const u = v.map((x, a) => x + o[a]), p = q.map((x, a) => x - o[a] * R);
    const here = air1(v, q);
    if (!(here < -0.05) || clear(u) || outside(u, p)) continue;
    tried++;
    const there = air1(u, p);
    assert.ok(there < 0.05, `${v} says ${here} at ${q}, ${u} says ${there}`);
  }
  assert.ok(tried > 100, `${tried} points in air past ${what}`);
});

// A sloped face is exact however close we are to it (see Position.levels):
// a point 24^-12 of a city lattice unit outside the upper's face toward -z
// (its plane 52 y - 90 z = 1781 from the building's origin), at a place on
// it where L and f each say much and their sum nearly nothing.
test('close to a sloped face, many levels down, its distance keeps its precision', () => {
  const flight = new Flight(arcology);
  const pos = flight.pos, deep = 12;
  // (0, 30.5, -2 - 4/24) is on the face; the building's origin is (12, 2, 12)
  // in the middle city cell, so in lattice units it is (12, 32.5, 9 + 20/24):
  // y in the row above, 8.5 into it. Less 24^-12 along z: z's digits are 9,
  // 19, and then 23s.
  pos.F = CITY + 1 + deep;
  pos.digits.set(CITY, [12, (ROW_ID % R) + 1, 12]);
  pos.digits.set(CITY + 1, [12, 8, 9]);
  pos.digits.set(CITY + 2, [0, 12, 19]);
  for (let j = 3; j <= deep + 1; j++) pos.digits.set(CITY + j, [0, 0, 23]);
  pos.frac = [0, 0, 0];
  flight.begin?.();
  const rec = pos.levels(CITY, pos.F).find((r) => r.level === CITY);
  const got = flight.airAt(rec);
  const want = -(90 * Math.pow(R, -deep)) / Math.hypot(52, 90);
  assert.ok(Math.abs(got - want) < 1e-3 * Math.abs(want), `${got} against ${want}`);
});

// The masses have a skin (cells with pockets and no rooms), rooms deeper in,
// and some cells left plain; none of the three is ever empty.
test('the building has skin, deep and plain cells', () => {
  const count = [0, 0, 0, 0];
  for (const k of VOLUME.kind) count[k]++;
  assert.ok(count[1] > 500 && count[2] > 1000 && count[3] > 500, `deep ${count[1]}, skin ${count[2]}, plain ${count[3]}`);
});

// The town's boxes (see TOWN in arcology.js): each stands far enough inside
// its lot that its distance is at least the margin on the lot's edge at every
// height (the town asks only the point's own lot).
test('the town\'s buildings keep their margin within their lots', () => {
  const { TOWN, TOWN_PLANS, townShape, boxDist } = _V2;
  if (!TOWN) return;
  const rnd = rand(13);
  let worst = Infinity, shapes = 0;
  for (let it = 0; it < 600; it++) {
    const h = Math.floor(rnd() * 2 ** 32), h2 = Math.floor(rnd() * 2 ** 32 / 100) * 100;
    for (const plan of TOWN_PLANS) for (const r of plan) for (let k = 0; k < _V2.TOWN_SHAPES; k++) {
      const s = townShape(h, h2, r, 100, k);
      if (!s) continue;
      shapes++;
      assert.ok(s[0] >= r[0] + 1 && s[2] >= r[1] + 1 && s[3] <= r[2] - 1 && s[5] <= r[3] - 1 && s[1] >= 0 && s[4] <= TOWN.H && s[0] < s[3] && s[1] < s[4] && s[2] < s[5], `${s} in ${r}`);
      for (let y = 0; y <= TOWN.H; y += 0.5) for (let t = 0; t <= 1; t += 1 / 24)
        for (const p of [[r[0] + t * (r[2] - r[0]), y, r[1]], [r[0] + t * (r[2] - r[0]), y, r[3]], [r[0], y, r[1] + t * (r[3] - r[1])], [r[2], y, r[1] + t * (r[3] - r[1])]])
          worst = Math.min(worst, boxDist(s, p));
    }
  }
  assert.ok(shapes > 1000, `${shapes} boxes`);
  assert.ok(worst >= 1 - 1e-9, `a box ${worst} from its lot's edge`);
});

// Set back from the band's edge (town.setback, ledger F15): the strip of the
// band's floor within `by` of its upright faces is air at every height of the
// town, where with no setback (by 0) buildings stand in it; and buildings
// still stand inside it.
test('set back from the band\'s edge, the town\'s buildings keep off the strip', () => {
  const by = 2, v = makeArcology({ town: { setback: { by } } }), { lo, size, data } = v.VOLUME, { ORIGIN, TOWN, BITS } = v._V2;
  const at = (s) => (c, q) => {
    const id = wrapId([c[0] + R * C, c[1] + (ROW_ID % R) * R, c[2] + R * C]);
    const up = wrapId([0, 1, 2].map((a) => (a === 1 ? ROW_ID : C + R * C) + Math.floor(c[a] / R)));
    const L = q.map(Math.round);
    return s.cellAir(L, q.map((x, a) => x - L[a]), id, seed1, undefined, CITY + 1, up);
  };
  const mine = at(v.arcology), theirs = at(makeArcology({ town: { setback: { by: 0 } } }).arcology);
  // (A point's distance inside each of the band's upright faces, in units.)
  const faces = TOWN.solid.planes.filter((p) => p.n[1] === 0);
  const inside = (c, q) => faces.map(({ n, K }) => (R * (K - n[0] * (c[0] - ORIGIN[0]) - n[2] * (c[2] - ORIGIN[2])) - n[0] * q[0] - n[2] * q[2]) / Math.hypot(n[0], n[2]));
  const rnd = rand(61);
  let strip = 0, stood = 0, standing = 0;
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    if (!((data[BITS.WORDS * (x + size[0] * (y + size[1] * z))] >>> BITS.TOWN_AT) & 1)) continue;
    const c = [x + lo[0], y + lo[1], z + lo[2]];
    for (let k = 0; k < 300; k++) {
      const q = [rnd() * R, 0.05 + rnd() * (TOWN.H - 0.1), rnd() * R], ds = inside(c, q);
      if (!ds.every((d) => d > 0.02)) continue;
      const d = mine(c, q);
      if (Math.min(...ds) < by - 0.02) {
        strip++;
        assert.ok(d < 0, `solid at ${q} in ${c}, ${Math.min(...ds)} inside the band's edge`);
        stood += theirs(c, q) > 0;
      } else standing += d > 0;
    }
  }
  assert.ok(strip > 1000 && stood > 100 && standing > 1000, `${strip} points in the strip (${stood} in buildings, set to the edge), ${standing} in buildings inside it`);
});

// And which boxes stand, exactly: over every box of the town, for several
// setbacks, a box stands just when a square `least` units a side, at its
// corner furthest in, is past the line `by` units in from each of the band's
// upright faces (here in floats, from all four corners). Asked of the space
// at a point inside each box near that corner: solid just where some box
// that stands holds it, past the lines.
test('set back from the band\'s edge, a box stands just when a square past the line fits at its corner', () => {
  let solid = 0, air = 0, near = 0, dropped = 0;
  // (Setbacks under which some box is one short of standing, just stands,
  // or stands by one, on some face.)
  for (const [by, least] of [[2, 2], [2, 1], [5, 1], [1, 2], [6, 3], [3, 2]]) {
    const v = makeArcology({ town: { setback: { by, least } } }), { lo, size, data } = v.VOLUME;
    const { ORIGIN, TOWN, BITS, TOWN_PLANS, TOWN_DENSITY, TOWN_SALT, townShape } = v._V2, PICK = v.def.town.pick;
    const faces = TOWN.solid.planes.filter((p) => p.n[1] === 0).map(({ n, K }) => ({ n: [n[0], n[2]], K, len: Math.hypot(n[0], n[2]) }));
    const at = (c, q) => {
      const id = wrapId([c[0] + R * C, c[1] + (ROW_ID % R) * R, c[2] + R * C]);
      const up = wrapId([0, 1, 2].map((a) => (a === 1 ? ROW_ID : C + R * C) + Math.floor(c[a] / R)));
      const L = q.map(Math.round);
      return v.arcology.cellAir(L, q.map((x, a) => x - L[a]), id, seed1, undefined, CITY + 1, up);
    };
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      if (!((data[BITS.WORDS * (x + size[0] * (y + size[1] * z))] >>> BITS.TOWN_AT) & 1)) continue;
      const c = [x + lo[0], y + lo[1], z + lo[2]], b = c.map((q, a) => q - ORIGIN[a]);
      // (A point's depth inside each face's line, in units: p in units in the cell.)
      const depth = (p) => faces.map(({ n, K, len }) => (R * (K - n[0] * b[0] - n[1] * b[2]) - n[0] * p[0] - n[1] * p[2]) / len - by);
      const corners = (s) => [[s[0], s[2]], [s[3], s[2]], [s[0], s[5]], [s[3], s[5]]].map(([u, w]) => [u, 0, w]);
      const hc = hashCell([Math.floor(b[0] / 2), Math.floor(b[2] / 2), 9], TOWN_SALT), hl = hashCell([b[0], b[2], 11], TOWN_SALT);
      const dens = TOWN_DENSITY[hc % TOWN_DENSITY.length];
      TOWN_PLANS[PICK[hl % PICK.length]].forEach((r, i) => {
        const h = hashCell([b[0] * 16 + i, b[2], 7], TOWN_SALT), h2 = hashCell([b[0] * 16 + i, b[2], 8], TOWN_SALT);
        const boxes = [];
        for (let k = 0; k < v._V2.TOWN_SHAPES; k++) {
          const s = townShape(h, h2, r, dens, k);
          if (!s) continue;
          // (Each face's corner furthest in, of all four, and the square's room past the line there.)
          const room = faces.map(({ n, len }, f) => Math.max(...corners(s).map((p) => depth(p)[f])) - (least * (Math.abs(n[0]) + Math.abs(n[1]))) / len);
          if (room.some((m) => Math.abs(m) < 1e-9)) near++;
          boxes.push({ s, stands: room.every((m) => m >= -1e-9) });
        }
        for (const { s, stands } of boxes) {
          dropped += !stands;
          // (Inside the box by half a unit from its corner furthest in from the face it is nearest.)
          const f = faces.map((_, j) => j).sort((j, l) => Math.min(...corners(s).map((p) => depth(p)[j])) - Math.min(...corners(s).map((p) => depth(p)[l])))[0];
          const cin = corners(s).sort((p, q) => depth(q)[f] - depth(p)[f])[0];
          const p = [cin[0] + (cin[0] === s[0] ? 0.5 : -0.5), (s[1] + s[4]) / 2, cin[2] + (cin[2] === s[2] ? 0.5 : -0.5)];
          const past = depth(p);
          if (past.some((d) => Math.abs(d) < 1e-6)) continue;
          const held = past.every((d) => d > 0) && boxes.some((o) => o.stands && p[0] > o.s[0] && p[0] < o.s[3] && p[1] > o.s[1] && p[1] < o.s[4] && p[2] > o.s[2] && p[2] < o.s[5]);
          const d = at(c, p);
          assert.equal(d > 0, held, `setback ${by}, ${least}: at ${p} in ${c} (box ${s}, ${stands ? 'standing' : 'dropped'}), ${d}`);
          held ? solid++ : air++;
        }
      });
    }
  }
  assert.ok(solid > 2000 && air > 300 && dropped > 200, `${solid} points in boxes that stand, ${air} in air, ${dropped} boxes dropped (${near} on the line exactly)`);
});

// Rays in the buildings' openings (see openings) and the town (see
// townAir): from points in each skin or plain cell with openings or town of
// the city's own cell, along the axes and diagonals and two others, what a
// level says of a ray holds (see rayHolds); and many more points where two
// or more solids' openings are (they may overlap, or one run on through
// another), and in the town (among its lots' boxes).
test('what the openings and the town say of a ray holds', () => {
  const { TOWN_AT, SKIN, PLAIN, WIN_AT, SOLID_BITS, OPEN_AT } = _V2.BITS;
  const rnd = rand(19);
  const s = Math.SQRT1_2;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [-s, 0, s], [s, 0, -s], [-s, 0, -s], [0, s, s], [s, -s, 0], [2, 0, 1], [1, 0, -2]];
  let cells = 0, shared = 0, towns = 0, inAir = 0, townAir = 0, corners = 0;
  const flight = new Flight(arcology);
  // (The camera at frac in cell x, y, z; its record of the level.)
  const at = (x, y, z, frac) => {
    Object.assign(flight.pos, { F: CITY + 1, frac, digits: new Map([[CITY + 1, [x, y, z]]]) });
    return mine();
  };
  const mine = () => flight.pos.levels(CITY + 1, Math.max(CITY + 1, flight.pos.F)).find((q) => q.level === CITY + 1);
  for (let x = 0; x < R; x++) for (let y = 0; y < R; y++) for (let z = 0; z < R; z++) {
    const r0 = at(x, y, z, [0.5, 0.5, 0.5]);
    const [m, , wins] = _V2.relief(r0.id.map((q) => ((q % P) + P) % P), r0.pid);
    const kind = m & 3;
    const town = kind === PLAIN && (m >>> TOWN_AT) & 1;
    if (!(kind === SKIN || kind === PLAIN) || !(wins || town)) continue;
    cells++;
    const solids = WIN_AT.filter((b) => (wins >>> b) & ((1 << SOLID_BITS) - 1)).length;
    shared += solids > 1;
    towns += town;
    // (From a point, along each of es: how many in air.)
    const ask = (frac, es) => {
      at(x, y, z, frac.slice());
      flight.sense();
      const r = mine();
      return es.reduce((n, e) => n + rayHolds(flight, r, [0, 0, 0], e.map((v) => v / Math.hypot(...e)), `cell ${[x, y, z]} frac ${frac}`).inAir, 0);
    };
    for (let k = 0; k < (solids > 1 || town ? 40 : 1); k++) {
      const said = ask([rnd(), rnd(), rnd()], k ? [dirs[k % dirs.length]] : dirs);
      inAir += said;
      if (town) townAir += said;
    }
    // (And in the town, toward each corner it cuts off aslant: into the
    // square across it, which is not the town's.)
    const open = (m >>> OPEN_AT) & 63, cut = (m >>> (TOWN_AT + 1)) & 15;
    if (town) [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz], c) => {
      if (!(open & (sx > 0 ? 1 : 2) && open & (sz > 0 ? 16 : 32) && !(cut & (1 << c)))) return;
      for (let k = 0; k < 12; k++) {
        const frac = [rnd(), rnd(), rnd()];
        const to = [sx > 0 ? 1 + rnd() * 0.05 : -rnd() * 0.05, rnd(), sz > 0 ? 1 + rnd() * 0.05 : -rnd() * 0.05];
        corners += ask(frac, [to.map((v, a) => v - frac[a])]);
      }
    });
  }
  assert.ok(cells > 1000 && shared > 50 && towns > 20 && inAir > 2000 && townAir > 1000 && corners > 150, `${cells} cells (${shared} with openings of more than one solid, ${towns} with town), ${inAir} rays in air (${townAir} in the town, ${corners} toward its corners): the test reaches the openings and the town`);
});

// Rays at the city's level (see city and cell in the shader): from points
// in the plaza's air round the buildings (both rows), along the axes and
// diagonals and toward the buildings' middle; in the city's pockets in the
// faces; and up from the top row into the sky. What a level says of a ray
// holds (see rayHolds).
// (Where the plaza does not fade, too: its pieces are then the whole height
// of the city's rows, and far out one piece: see plaza.)
for (const fades of [true, false]) {
  test(`what the city says of a ray holds, where the plaza ${fades ? 'fades' : 'does not fade'}`, () => {
    const { arcology: space, _V2 } = fades === ARCOLOGY.plaza.fades ? { arcology, _V2: V2 } : makeArcology({ plaza: { fades } });
    const rnd = rand(23);
    const s = Math.SQRT1_2;
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [-s, 0, s], [s, 0, -s], [-s, 0, -s], [0, s, s], [s, -s, 0], [2, 0, 1], [1, 0, -2]];
    const { lo, size, kind, at: cellAt } = VOLUME;
    const middle = lo.map((x, a) => x + size[a] / 2);
    const flight = new Flight(space);
    // (From x, lattice units of the city's level over the middle city cell's
    // corner, along each of es: how many in air at that level.)
    const ask = (x, es) => {
      Object.assign(flight.pos, { F: CITY - 1, frac: x.map((v) => (12 + v / R) / R), digits: new Map() });
      flight.sense();
      const r = flight.pos.levels(CITY, Math.max(CITY, flight.pos.F)).find((q) => q.level === CITY);
      return es.reduce((n, e) => n + rayHolds(flight, r, [0, 0, 0], e.map((u) => u / Math.hypot(...e)), `city point ${x}`).inAir, 0);
    };
    const count = { plaza: 0, pockets: 0, bare: 0, clipped: 0, sky: 0 };
    // (The plaza's air round the buildings, both rows.)
    for (const key of _V2.NEAR.keys()) {
      const [a, b, c] = key.split(',').map(Number);
      for (let k = 0; k < 60; k++) {
        const x = [(a + rnd()) * R, (b + rnd()) * R, (c + rnd()) * R];
        count.plaza += ask(x, [dirs[k % dirs.length], middle.map((m, i) => m - x[i])]);
      }
    }
    // (The pockets: round the buildings' skin, a few units in or out.)
    const skin = [];
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++)
      if (kind[cellAt([x, y, z])] === 2) skin.push([x + lo[0], y + lo[1], z + lo[2]]);
    for (let k = 0; k < 1500; k++) {
      const x = skin[Math.floor(rnd() * skin.length)].map((v) => v + 0.5 + (2 * rnd() - 1) * 6);
      count.pockets += ask(x, [dirs[k % dirs.length], middle.map((m, i) => i === 1 ? 0 : m - x[i])]);
    }
    // (Round the solids without relief, a few units off, toward them: where
    // the pockets' rays must stop at them.)
    for (const [blo, bhi] of _V2.BARE_BOX) {
      const [l, h] = [blo, bhi].map((b) => b.map((x, a) => x + _V2.ORIGIN[a]));
      for (let k = 0; k < 150; k++) {
        const x = [0, 1, 2].map((a) => (a === 1 ? l[a] + rnd() * (h[a] - l[a]) : l[a] - 6 + rnd() * (h[a] - l[a] + 12)));
        const mid = [0, 1, 2].map((a) => (l[a] + h[a]) / 2 + (2 * rnd() - 1));
        count.bare += ask(x, [mid.map((m, i) => m - x[i])]);
      }
    }
    // (And the rays the pockets take that those solids stop, found among many
    // close by them toward points inside them: few, so asked about only once
    // found.)
    const stopped = clippedRays(rnd, 6000);
    for (const [x, e] of stopped) count.clipped += ask(x, [e]);
    // (Up from the top row, into the sky.)
    for (let k = 0; k < 300; k++) {
      const x = [middle[0] + (2 * rnd() - 1) * 2 * R, (ROWS - rnd() * 0.5) * R, middle[2] + (2 * rnd() - 1) * 2 * R];
      count.sky += ask(x, [[rnd() - 0.5, 1, rnd() - 0.5]]);
    }
    assert.ok(count.plaza > 1000 && count.pockets > 500 && count.bare > 300 && count.clipped >= 10 && count.sky > 200, `rays in air: ${JSON.stringify(count)}: the test reaches what it means to`);
  });
}

// The ridges' rows, as both copies look them up (the table, RIDGE_ROWS), are
// the rows as the table was made from (ridgeRow): at every height it holds.
test('the ridges\' rows looked up are the rows as made', () => {
  const { built, looked, from, n } = _V2.ridgeRows;
  let compared = 0;
  for (let r = 0; r < _V2.RIDGES.length; r++)
    for (let lv = 0; lv < 2; lv++) {
      // (Outside the table, a height is held to its first or last row.)
      assert.deepEqual(looked(r, lv, from[lv] - 5), looked(r, lv, from[lv]), `ridge ${r}, level ${lv}: under the table`);
      assert.deepEqual(looked(r, lv, from[lv] + n[lv] + 5), looked(r, lv, from[lv] + n[lv] - 1), `ridge ${r}, level ${lv}: over the table`);
      for (let y = from[lv]; y < from[lv] + n[lv]; y++) {
        const a = built(r, lv, y), b = looked(r, lv, y);
        for (const k of ['y0', 'y1', 't', 'tc', 'cy0', 'cy1']) assert.equal(b[k], a[k], `ridge ${r}, level ${lv}, height ${y}: ${k}`);
        compared++;
      }
    }
  assert.ok(compared > 5000, `${compared} heights`);
});

// At the city's level, the relief's height planes are worked out from 4y
// along the FOUR slant (see boxPlanes in relief.js): its whole part and the rest as
// Position.levels carries them. They are the very numbers the true height
// gives, so the shader's form and the plain one agree exactly.
test("the relief's heights at the city's level: the slant's form is the true height's", () => {
  const flight = new Flight(arcology), rnd = rand(11);
  const FOUR = flight.pos.slants.findIndex((m) => m[0] === 0 && m[1] === 4 && m[2] === 0);
  assert.ok(FOUR >= 0, 'no FOUR slant');
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    const F = -2 - (i % 6);
    Object.assign(flight.pos, { F, frac: [rnd(), 0.3 + rnd() * 0.4, rnd()], digits: new Map() });
    for (const r of flight.pos.levels(F, 0)) {
      const b = Math.floor(rnd() * 40) - 20, lo4 = Math.floor(rnd() * 400) - 200, hi4 = lo4 + 4;
      const lo = (lo4 - (r.Ls[FOUR] + 4 * b) - r.fs[FOUR]) * 0.25, hi = (r.Ls[FOUR] + 4 * b - hi4 + r.fs[FOUR]) * 0.25;
      assert.ok(Object.is(lo, lo4 / 4 - b - r.L[1] - r.f[1]) && Object.is(hi, r.L[1] - (hi4 / 4 - b) + r.f[1]), `at ${JSON.stringify({ F, frac: flight.pos.frac, level: r.level })}`);
      assert.equal(r.Ls[FOUR] + r.fs[FOUR], 4 * (r.L[1] + r.f[1]));
      n++;
    }
  }
  assert.ok(n > 100000, `${n} asked`);
});

// Where the plaza does not fade (plaza.fades false: ledger B33), a city cell
// further out than one past those that hold anything else answers the
// plaza's air as one piece (see farAxis and plaza). The air is the same as
// where it fades (the same points are in it); its distance changes no faster
// than the point moves; and what it says of a ray holds, near the building,
// in the ring just past what it holds, and far off, out to the next
// building's (cell ids repeat).
test('where the plaza does not fade, its far cells are its air as one piece', () => {
  const open = makeArcology({ plaza: { fades: false } }), space = open.arcology, faded = makeArcology({ plaza: { fades: true } }).arcology;
  assert.equal(space.openAir, CITY);
  assert.equal(faded.openAir, null);
  const [x0, x1, z0, z1] = open._V2.NEAR_BOX, MID = open._V2.MID;
  const at = (s) => (q, id) => {
    const L = q.map(Math.round);
    return s.cellAir(L, q.map((x, a) => x - L[a]), id, seed, undefined, CITY);
  };
  const mine = at(space), theirs = at(faded), rnd = rand(31);
  // (Cells across from the middle one: near, in the ring just past, and far
  // out, up to where ids repeat.)
  const across = () => {
    const k = rnd();
    const pick = (lo, hi) => (k < 0.4 ? lo - 3 + Math.floor(rnd() * (hi - lo + 6)) : k < 0.7 ? (rnd() < 0.5 ? lo - 2 - Math.floor(rnd() * 3) : hi + 1 + Math.floor(rnd() * 3)) : Math.floor(rnd() * P) - MID);
    return [pick(x0, x1), pick(z0, z1)];
  };
  let worst = 0, inAir = 0;
  for (let n = 0; n < 20000; n++) {
    const [a, c] = across(), id = wrapId([MID + a, ROW_ID + [-1, 0, 1, 2][n % 4], MID + c]);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const d = mine(q, id);
    assert.equal(d <= 0, theirs(q, id) <= 0, `in air in one and not the other, at ${q} in ${id}`);
    inAir += d <= 0;
    const step = 10 ** (rnd() * 3 - 3), dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], len = Math.hypot(...dir);
    const q2 = q.map((x, i) => Math.min(R - 0.51, Math.max(0.51, x + (dir[i] / len) * step)));
    const moved = Math.hypot(...q2.map((x, i) => x - q[i])), change = Math.abs(mine(q2, id) - d);
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${id}`);
  }
  assert.ok(worst > 0.5 && inAir > 5000, `the test meets surfaces (${worst}) and air (${inAir})`);
  // (Nor does it overstate across cells: the ball its distance claims, air
  // all through or none, holds into the cells round it. Not where the city's
  // air reaches over the sky's plane, up to M, which the cells over it do not
  // count: ledger B35. X: lattice units from the middle city cell's corner.
  // As the world has the city's level: cut off at the ground, the plaza's
  // floor, as airAt cuts it: see ground in worlds.js.)
  const abs = (X) => {
    const c = X.map((x) => Math.floor(x / R));
    return Math.max(mine(X.map((x, i) => x - c[i] * R), wrapId([MID + c[0], ROW_ID + c[1], MID + c[2]])), G - X[1]);
  };
  const overSky = (X) => X[1] > ROWS * R - 1e-6 && X[1] < ROWS * R + M + 1e-6;
  let balls = 0;
  for (let n = 0; n < 4000; n++) {
    const [a, c] = across(), X = [(a + rnd()) * R, (rnd() * 3 - 1) * R, (c + rnd()) * R];
    const d = abs(X);
    if (overSky(X) || Math.abs(d) < 1e-3) continue;
    for (let k = 0; k < 40; k++) {
      const e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...e), t = Math.abs(d) * Math.cbrt(k < 10 ? 1 : rnd()) * (1 - 1e-9);
      const Y = X.map((x, i) => x + (e[i] / l) * t);
      if (overSky(Y)) continue;
      const b = abs(Y), tol = 1e-9 + 1e-9 * Math.abs(d);
      assert.ok(d > 0 ? b > -tol : b < tol, `${d} at ${X}, but ${b} at ${Y} within it`);
    }
    balls++;
  }
  assert.ok(balls > 3000, `${balls} balls asked about`);
  // (Rays, from points in the plaza's air, both rows, along the axes, the
  // diagonals, at a slant, toward the building and away.)
  const flight = new Flight(space), s = Math.SQRT1_2;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [-s, 0, -s], [0, -s, s], [0.3, 0.05, -1], [1, -0.02, 0.4], [0.2, 0.3, 1]];
  let rays = 0, far = 0;
  for (let k = 0; k < 1500; k++) {
    const [a, c] = across(), x = [(a + rnd()) * R, (rnd() * 1.9 + 0.05) * R, (c + rnd()) * R];
    // (At the city's level, in the cell x is in: its id's digits there and
    // one level coarser, and where in it x is.)
    const cell = [a, Math.floor(x[1] / R), c], id = [MID + cell[0], ROW_ID + cell[1], MID + cell[2]];
    const mod = (v) => ((v % R) + R) % R;
    Object.assign(flight.pos, { F: CITY, frac: x.map((v, i) => v / R - cell[i]), digits: new Map([[CITY, id.map(mod)], [CITY - 1, id.map((v) => mod(Math.floor(v / R)))]]) });
    flight.sense();
    const r = flight.pos.levels(CITY, Math.max(CITY, flight.pos.F)).find((q) => q.level === CITY);
    const e = k % 3 ? dirs[k % dirs.length] : [-x[0], 0, -x[2]];
    const said = rayHolds(flight, r, [0, 0, 0], e.map((u) => u / Math.hypot(...e)), `plaza point ${x}`);
    rays += said.inAir;
    const ray = { dir: e.map((u) => u / Math.hypot(...e)) };
    flight.airAt(r, [0, 0, 0], ray);
    if (ray.reach > 10 * R) far++;
  }
  assert.ok(rays > 600 && far > 100, `rays in air: ${rays}, ${far} of them far: the test reaches what it means to`);
});

// Under the ground (the plaza's floor) there is only solid, at every level
// (see ground in worlds.js): over every cell of the building's table's
// bottom row and the ring round it, on a grid, rays from just over the floor
// going down end at it, and just under it no level of the halls has air. (Before
// the ground: pits under the open cells by the building, ledger F2.)
test('no ray goes down past the floor by the building, and under it there is no air', () => {
  const flight = new Flight(arcology), { lo, size } = VOLUME, G = lo[1];
  const city = (c) => Math.floor(c / R), own = (c) => ((c % R) + R) % R;
  const grid = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95], dirs = [[0, -1, 0], [0.6, -0.8, 0], [0, -0.8, 0.6]];
  let rays = 0, points = 0;
  for (let z = -1; z <= size[2]; z++) for (let x = -1; x <= size[0]; x++) {
    const c = [x + lo[0], G, z + lo[2]];
    for (const fx of grid) for (const fz of grid) {
      Object.assign(flight.pos, { F: CITY + 1, frac: [fx, 0.02, fz], digits: new Map([[CITY, [city(c[0]) + R / 2, ROW_ID % R, city(c[2]) + R / 2]], [CITY + 1, [own(c[0]), c[1], own(c[2])]]]) });
      const r = flight.pos.levels(CITY, CITY + 1).find((q) => q.level === CITY + 1);
      for (const dir of dirs) {
        const ray = { dir };
        flight.airAt(r, [0, 0, 0], ray);
        if (ray.known && ray.reach >= 0) rays++;
        assert.ok(!(ray.known && ray.reach * -dir[1] > 0.02 * R + 1e-9), `a ray down from over the floor goes ${ray.reach * -dir[1] - 0.02 * R} units under it, at ${c} (${fx}, ${fz})`);
      }
      assert.ok(flight.airAt(r, [0, -0.03, 0]) > 0, `air under the floor at ${c} (${fx}, ${fz})`);
      points++;
    }
  }
  assert.ok(points > 50000 && rays > 1000, `${points} points, ${rays} rays in air`);
});

// And at every level around us, flying at any scale close over the floor,
// near the building and far from it: at points under the floor, no air; and
// a ray from us going down ends at the floor. (Before the ground: rooms of
// level 0 and finer under the whole plaza, their openings up through the
// floor.)
test('under the ground there is no air, at any level', () => {
  const flight = new Flight(arcology), rnd = rand(41), dirs = [];
  for (let k = 0; k < 6; k++) {
    const d = [rnd() - 0.5, -0.2 - rnd(), rnd() - 0.5], l = Math.hypot(...d);
    dirs.push(d.map((x) => x / l));
  }
  // (And over the light wells there were, by the building, until the ground
  // (ledger F2): city cells across from the middle one, each well a square of
  // 3 units each way round its cell's middle.)
  const WELLS = [[-2, 0], [-2, 1], [2, -1]];
  let asked = 0, rays = 0, wells = 0;
  for (let n = 0; n < 390; n++) {
    const well = n >= 300 ? WELLS[n % 3] : null, F = well ? CITY + (n % 3) : CITY + (n % 6), far = n % 3 === 0;
    const across = () => (far ? Math.floor(rnd() * R) : R / 2 - 4 + Math.floor(rnd() * 8)), mid = () => R / 2 - 1 + Math.floor(rnd() * 2);
    const digits = new Map(well
      ? [[CITY, [R / 2 + well[0], ROW_ID % R, R / 2 + well[1]]], [CITY + 1, [mid(), 3, mid()]]]
      : [[CITY, [across(), ROW_ID % R, across()]], [CITY + 1, [Math.floor(rnd() * R), 3, Math.floor(rnd() * R)]]]);
    for (let j = CITY + 2; j <= F; j++) digits.set(j, [Math.floor(rnd() * R), 0, Math.floor(rnd() * R)]);
    // (Points round us, across: within the well, over one; else half a cell.)
    const half = well ? Math.pow(R, F - CITY - 1) : 0.5;
    // (Our cell's bottom on the floor: at the city's level, the floor is G up its cell.)
    Object.assign(flight.pos, { F, frac: [rnd(), (F === CITY ? (G + 0.02) / R : 0.02) + 0.5 * rnd(), rnd()], digits });
    const g = flight.pos.groundHeight();
    assert.ok(g > 0 && g < 1, `the floor is ${g} under us`);
    for (const r of flight.pos.levels(F - UP, F + DOWN)) {
      for (let k = 0; k < 4; k++) {
        const v = [(2 * rnd() - 1) * half, -g - 10 ** (-4 + 4 * rnd()) * (well ? 2 * half : 1), (2 * rnd() - 1) * half];
        assert.ok(flight.airAt(r, v) > 0, `air at level ${r.level}, ${-g - v[1]} under the floor (F ${F}${well ? `, the well at ${well}` : ''})`);
        asked++;
        wells += !!well;
      }
      for (const dir of dirs) {
        const ray = { dir };
        flight.airAt(r, [0, 0, 0], ray);
        if (!(ray.known && ray.reach >= 0)) continue;
        rays++;
        assert.ok((ray.reach / r.sig) * -dir[1] <= g * (1 + 1e-9) + 1e-12, `level ${r.level}: a ray goes ${(ray.reach / r.sig) * -dir[1] - g} under the floor (F ${F})`);
      }
    }
  }
  assert.ok(asked > 10000 && rays > 1000 && wells > 2000, `${asked} points (${wells} in the wells), ${rays} rays in air`);
});

// Inside the building, far over the ground, the ground changes nothing: at
// every level around us, distances and rays are the cells' own, to the bit;
// and deeper than its height can be said in a number (see Position.groundHeight), there
// is none to cut by.
test('far over the ground, the ground changes nothing', () => {
  const flight = new Flight(arcology), rnd = rand(43);
  let compared = 0, none = 0;
  for (const F of [0, 2, 5, 9, 14, 19, 24, 30]) {
    for (let n = 0; n < 6; n++) {
      const digits = new Map(INSIDE.map(([j, d]) => [j, d.slice()]));
      for (let j = CITY + 2; j <= F; j++) digits.set(j, [Math.floor(rnd() * R), Math.floor(rnd() * R), Math.floor(rnd() * R)]);
      Object.assign(flight.pos, { F, frac: [rnd(), rnd(), rnd()], digits });
      const g = flight.pos.groundHeight();
      if (g === Infinity) none++;
      else assert.ok(g > Math.pow(R, F + 1), `the ground ${g} under us at F ${F}, inside the building`);
      for (const r of flight.pos.levels(F - UP, F + DOWN)) {
        for (let k = 0; k < 6; k++) {
          const v = [0, 1, 2].map(() => (rnd() - 0.5) * 4), d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d);
          const mine = { dir: d.map((x) => x / l) }, theirs = { dir: mine.dir };
          const a = flight.airAt(r, v, mine), b = airAt(arcology, r, v, theirs);
          assert.ok(Object.is(a, b) && Object.is(mine.reach, theirs.reach) && Object.is(mine.ny, theirs.ny), `level ${r.level} at F ${F}: ${a} and ${b}, reach ${mine.reach} and ${theirs.reach}`);
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 4000 && none >= 12, `${compared} compared, ${none} places with no ground in reach`);
});

// Pressed onto the plaza's floor at any scale, the space we are in is the
// plaza (the city's level): the ground cuts every level's air off at the
// floor, so the finer levels over it say the same room as the plaza but
// for rounding, and the coarser's is the space we are in (see roomier in
// flight.js). (Without the rule, one start in ten came out in a finer
// level's room.)
test('pressed onto the floor, the room we are in is the plaza', () => {
  const flight = new Flight(arcology), rnd = rand(51);
  for (let k = 0; k < 200; k++) {
    const F = 2 + (k % 20);
    const digits = new Map([[CITY, [Math.floor(rnd() * R), ROW_ID % R, Math.floor(rnd() * R)]], [CITY + 1, [Math.floor(rnd() * R), G, Math.floor(rnd() * R)]]]);
    for (let j = CITY + 2; j <= F; j++) digits.set(j, [Math.floor(rnd() * R), 0, Math.floor(rnd() * R)]);
    Object.assign(flight.pos, { F, frac: [rnd(), 0.02 + 0.2 * rnd(), rnd()], digits });
    flight.begin();
    assert.equal(flight.room, CITY, `at F ${flight.pos.F}, ${flight.pos.groundHeight()} over the floor`);
  }
});
