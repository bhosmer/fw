import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { CITY, ROW_ID, ROWS, VOLUME, _V2 } from '../../src/spaces/arcology.js';
import { levelSeed, wrapId as wrapIdR } from '../../src/util.js';
import { rand } from './rand.js';
import { Flight } from '../../src/flight.js';

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

// Where a city cell meets the hall under it, the two say the same about
// what is air (the light wells go through), and neither says air is further
// off than the other finds it. (Half of them in the ring of city cells
// round the building's: light wells, and halls under the ground, are only
// there.)
test('the city and the halls under it agree where they meet', () => {
  const rnd = rand(8);
  let wells = 0;
  for (let n = 0; n < 20000; n++) {
    // (The ring of city cells round the building's own, _V2.BUILT_CELLS.)
    const near = () => {
      const [a, b] = _V2.BUILT_CELLS[Math.floor(rnd() * _V2.BUILT_CELLS.length)], ring = [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => [a + x, b + z])).filter(([x, z]) => !_V2.BUILT_CELLS.some(([p, q]) => p === x && q === z));
      const [x, z] = ring.length ? ring[Math.floor(rnd() * ring.length)] : [a + 2, b];
      return wrapId([R * (R / 2) + R / 2 + x, ROW_ID, R * (R / 2) + R / 2 + z]);
    };
    const id = n % 2 ? near() : anywhere(rnd, ROW_ID);
    const below = wrapId([id[0], id[1] - 1, id[2]]);
    const x = 0.6 + rnd() * (R - 1.2), z = 0.6 + rnd() * (R - 1.2);
    const up = air([x, 0.01, z], id), down = air([x, R - 0.01, z], below);
    if (up < -0.03 || down < -0.03) wells++;
    assert.ok(Math.abs(up - down) <= 0.02 + 1e-9, `at ${x}, ${z} in ${id}: ${up} above, ${down} below`);
  }
  assert.ok(wells > 100, `the test meets light wells (${wells} times)`);
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

// Just what Flight needs of the controls.
const controls = () => ({ yaw: 0, pitch: 0, boost: () => 1 });
// Fly straight ahead (yaw 0, level) n steps from somewhere in the city,
// given as the digits of our level -2 and -1 cells.
function flyFrom(d2, d1, frac, n, each) {
  const flight = new Flight(arcology, controls());
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
    if (i >= 300) moved += Math.hypot(...f.lastMove) * Math.pow(R, -1 - f.pos.F);
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
const outside = (c, p) => {
  const X = c.map((x, a) => x + p[a] / R - _V2.ORIGIN[a]);
  return _V2.SOLID_PL.every((pl) => pl.some(([nx, ny, nz, K]) => nx * X[0] + ny * X[1] + nz * X[2] > K));
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
  const flight = new Flight(arcology, controls());
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
