import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHalls, R } from '../../src/spaces/halls.js';
import arcology, { CITY } from '../../src/spaces/arcology.js';
import { levelSeed, hashCell, wrapId as wrapIdR } from '../../src/util.js';
import { h01 } from '../../src/pieces.js';
import { rand } from './rand.js';

// The halls the arcology is built of, as a catalogue, apart from the
// arcology: their cell alone, at the levels the arcology has halls to see
// (finer than the city's), and their parts.
const halls = makeHalls();
const P = R * R;
const wrapId = (id) => wrapIdR(id, R);
const LEVELS = 42, someLevel = (rnd) => CITY + 1 + Math.floor(rnd() * LEVELS);

// The distance at a point given as lattice coordinates q (0..R) in cell id,
// of the level whose seed it is (and for a ray, if given, how far it goes).
function air(q, id, seed, level, ray) {
  const L = q.map(Math.round);
  return halls.air(L, q.map((x, a) => x - L[a]), id, seed, null, level, ray);
}
// The same at a point anywhere along the lattice, in the cell it is in
// (lattice coordinates from cell id's corner).
function airAcross(q, id, seed, level, ray) {
  const c = q.map((x) => Math.floor(x / R));
  return air(q.map((x, a) => x - c[a] * R), wrapId(id.map((x, a) => x + c[a])), seed, level, ray);
}

// A distance that never overstates changes no faster than the point moves:
// were it to, one of the two values would be more than the true distance.
test('the halls\' cell never changes faster than the point moves', () => {
  const rnd = rand(5);
  let worst = 0;
  for (let n = 0; n < 20000; n++) {
    const id = wrapId([0, 1, 2].map(() => Math.floor(rnd() * P)));
    const level = someLevel(rnd), seed = levelSeed(level);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const step = 10 ** (rnd() * 3 - 3); // 0.001 .. 1 lattice units
    const dir = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const len = Math.hypot(...dir);
    const q2 = q.map((x, a) => Math.min(R - 0.51, Math.max(0.51, x + (dir[a] / len) * step)));
    const moved = Math.hypot(...q2.map((x, a) => x - q[a]));
    const change = Math.abs(air(q2, id, seed, level) - air(q, id, seed, level));
    worst = Math.max(worst, change / moved);
    assert.ok(change <= moved * (1 + 1e-6) + 1e-9, `changed ${change} over ${moved} at ${q} in ${id}`);
  }
  assert.ok(worst > 0.5, 'the test moves through enough surfaces to mean something');
});

// What the cell says of a ray holds: where it is in air, the ray goes no
// less far than the distance; all of the way is air (the cell's, or once
// past its sides, the next cell's: a tunnel runs on into it); the surface
// it meets faces back along it; and just past where it ends, either the
// point is solid or another of the cell's pieces takes the ray on (as the
// shader marches). Along random directions, the axes and the diagonals
// (where a plane is met exactly edge on).
test('what the halls\' cell says of a ray holds', () => {
  const rnd = rand(13);
  const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, -1], [Math.SQRT1_2, 0, Math.SQRT1_2], [0, -Math.SQRT1_2, Math.SQRT1_2]];
  let rays = 0, across = 0, onward = 0;
  for (let n = 0; n < 10000; n++) {
    const id = wrapId([0, 1, 2].map(() => Math.floor(rnd() * P)));
    const level = someLevel(rnd), seed = levelSeed(level);
    const q = [0, 1, 2].map(() => 0.6 + rnd() * (R - 1.2));
    const e = n % 10 < dirs.length ? dirs[n % 10] : [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e), dir = e.map((x) => x / m);
    const ray = { dir }, a = air(q, id, seed, level, ray), where = `at ${q} in ${id}, level ${level}, along ${dir}`;
    assert.equal(a, air(q, id, seed, level), `the distance is the same, asked with a ray or not, ${where}`);
    assert.ok(ray.known, `the halls answer every ray, ${where}`);
    assert.equal(ray.reach >= 0, a <= 0, `in air (${a}) but reach ${ray.reach}, ${where}`);
    if (ray.reach < 0) continue;
    rays++;
    assert.ok(ray.reach >= -a - 1e-9, `reach ${ray.reach} less than the distance ${-a}, ${where}`);
    assert.ok(Math.abs(Math.hypot(ray.nx, ray.ny, ray.nz) - 1) < 1e-9 && ray.nx * dir[0] + ray.ny * dir[1] + ray.nz * dir[2] <= 1e-12, `normal ${[ray.nx, ray.ny, ray.nz]}, ${where}`);
    // (Covered by balls of air, each as big as the distance says.)
    for (let t = 0, k = 0; t < ray.reach * (1 - 1e-6) && k < 4000; k++) {
      const u = q.map((x, i) => x + dir[i] * t), b = -airAcross(u, id, seed, level);
      assert.ok(b >= -1e-9, `solid (${-b}) at ${t} of reach ${ray.reach}, ${where}`);
      t += Math.max(b, ray.reach * 1e-6);
    }
    const end = q.map((x, i) => x + dir[i] * ray.reach);
    if (end.some((x) => x < 0 || x > R)) across++;
    // (Just past: a millionth of the way, or of a lattice unit.)
    const p = q.map((x, i) => x + dir[i] * (ray.reach + 1e-6 * Math.max(ray.reach, 1)));
    const next = { dir }, b = airAcross(p, id, seed, level, next);
    if (b <= 0 && next.reach > 0) onward++;
    assert.ok(next.reach < 0 || next.reach > 0, `the ray is handed over to nothing just past its end (${b}, ${next.reach}), ${where}`);
  }
  assert.ok(rays > 1500 && across > 50 && onward > 20, `${rays} rays in air, ${across} on out of their cell, ${onward} taken on by another piece: the test reaches what it means to`);
});

// Finer than level 0, where a cell sits in its parent is the halls' to say
// (the arcology's own levels say for themselves: see the worlds' tests): the
// level j cell's place in its parent, whose own place is in its parent,
// must be a child cell of the parent solid all through.
test('a cell of the halls sits somewhere solid in its parent', () => {
  for (let j = 3; j <= 30; j++) {
    const d = arcology.ancestorDigit(j);
    const up = arcology.ancestorDigit(j - 1), upper = arcology.ancestorDigit(j - 2);
    const parent = wrapId(up.map((x, a) => x + R * upper[a]));
    const centre = d.map((x) => x + 0.5);
    assert.ok(air(centre, parent, levelSeed(j - 1), j - 1) >= 0.5, `level ${j} at ${d}`);
  }
});

// Every kind the catalogue has is chosen somewhere: at the levels whose
// halls are given their own kinds, and at others. None is left out by its
// share, by those before it, or (furniture) by what it may stand under and
// over (see upTo in HALLS). Each part's kind as the halls pick it: from the
// cell's hash, salted for the part (a wall's and a floor's by the cell on
// their lower side).
test('every kind of room, wall, slab and furniture is chosen somewhere, at every level', () => {
  const { salt } = halls.spec;
  const pick = (kinds, h) => kinds.find((k) => k.to === null || h01(h) < k.to);
  for (const level of [CITY + 1, 0, 1, 9]) {
    const seed = levelSeed(level), kinds = halls.kindsAt(level), rnd = rand(17 + level);
    const seen = { rooms: new Set(), walls: new Set(), slabs: new Set(), furniture: new Set() };
    let built = 0;
    for (let n = 0; n < 4000; n++) {
      const id = wrapId([0, 1, 2].map(() => Math.floor(rnd() * P)));
      if (!halls.built(id, seed, level)) continue;
      built++;
      seen.rooms.add(pick(kinds.rooms, hashCell(id, seed)).name);
      for (const s of [salt.wallX, salt.wallZ]) seen.walls.add(pick(kinds.walls, hashCell(id, seed ^ s)).name);
      seen.slabs.add(pick(kinds.slabs, hashCell(id, seed ^ salt.slab)).name);
      const over = h01(hashCell(id, seed ^ salt.slab)), under = h01(hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab));
      const f = pick(kinds.furniture, hashCell(id, seed ^ salt.furniture));
      const allowed = Object.entries(f.upTo ?? {}).every(([side, most]) => {
        const to = kinds.slabs.find((k) => k.name === most).to;
        return to === null || (side === 'under' ? under : over) < to;
      });
      seen.furniture.add(allowed ? f.name : kinds.furniture[0].name);
    }
    assert.ok(built > 500, `level ${level}: ${built} cells with rooms sampled`);
    for (const part of Object.keys(seen)) for (const k of kinds[part]) assert.ok(seen[part].has(k.name), `level ${level}: no ${part} ${k.name} among ${built} cells`);
  }
});

// Each kind's threshold is one single precision holds exactly, so that the
// shader's literal picks just as the JavaScript's number does; and each
// picks, for every hash's number (a whole number of 2^-24ths), as the
// shares themselves say: tried at the numbers either side of it.
test('the halls\' thresholds pick alike in both languages, as the shares say', () => {
  // (At every level the arcology's halls are given their own, and the rest.)
  for (const made of [halls, makeHalls({ walls: { door: { share: 0.1 } }, slabs: { solid: { share: 0.33 } } })])
    for (const level of [null, ...Object.keys(made.spec.byLevel).map(Number)])
    for (const [part, kinds] of Object.entries(made.kindsAt(level))) {
      const spec = level === null ? made.spec : made.spec.byLevel[level];
      let sum = 0;
      for (const k of kinds) {
        if (k.to === null) continue;
        sum = +(sum + spec[part][k.name].share).toPrecision(12);
        assert.equal(Math.fround(k.to), k.to, `${part}.${k.name}: ${k.to} is not exact in single precision`);
        const at = Math.floor(sum * 2 ** 24);
        for (let n = at - 2; n <= at + 2; n++) assert.equal(n / 2 ** 24 < k.to, n / 2 ** 24 < sum, `${part}.${k.name}: the number ${n} / 2^24`);
      }
    }
});

// The halls by level: a level's changes there and nowhere else (at that
// level, as halls made with those changes; at the others, as the halls
// are); and what is refused.
test('the halls by level change only their level', () => {
  const change = { solid: 0.4, rooms: { low: { share: 0.2 } }, walls: { none: { share: 0.05 }, door: { share: 0.5 } }, furniture: { none: { share: 0.1 }, kiosk: { box: [[-3, 3], [-1, 1], [-1, 2]] } } };
  const by = makeHalls({ byLevel: { '-1': change } }), as = makeHalls(change), plain = makeHalls();
  const rnd = rand(31);
  let differ = 0, changed = 0;
  for (let i = 0; i < 20000; i++) {
    const L = [0, 1, 2].map(() => Math.floor(rnd() * 26) - 1), f = [0, 1, 2].map(() => rnd() - 0.5), id = [0, 1, 2].map(() => Math.floor(rnd() * 24)), seed = Math.floor(rnd() * 2 ** 32);
    const level = [-2, -1, 0, 1][i % 4], e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e), dir = e.map((x) => x / m);
    const want = level === -1 ? as : plain;
    const r1 = { dir }, r2 = { dir };
    const a = by.air(L, f, id, seed, null, level, r1), b = want.air(L, f, id, seed, null, level, r2);
    if (a !== b || r1.reach !== r2.reach || JSON.stringify(by.room(id, seed, level)) !== JSON.stringify(want.room(id, seed, level)) || JSON.stringify(by.openings(id, seed, level)) !== JSON.stringify(want.openings(id, seed, level))) differ++;
    if (level === -1 && a !== plain.air(L, f, id, seed, null, level)) changed++;
  }
  assert.equal(differ, 0, `${differ} answers not as their level's halls`);
  assert.ok(changed > 500, `the change made little difference (${changed}): the test sees too little`);
  // (Its shader: one copy of the cell, and of each rule, the level's own
  // numbers chosen by the level where they differ.)
  assert.match(by.glsl, /level == -1 \? /);
  assert.doesNotMatch(by.glsl, /if \(level == -1\) \{/);
  assert.equal(by.glsl.match(/float hallsCellIn\(/g).length, 1);
  // (A level's changes are to the halls as defined, with their own changes.)
  const both = makeHalls({ solid: 0.5, rooms: { low: { share: 0.2 } }, byLevel: { '-1': { furniture: { none: { share: 0.1 } } } } }).spec.byLevel['-1'];
  assert.deepEqual([both.solid, both.rooms.low.share, both.furniture.none.share], [0.5, 0.2, 0.1]);
  assert.throws(() => makeHalls({ byLevel: { '-01': { solid: 0.5 } } }), /byLevel\.-01: there are parts only for whole numbers/);
  assert.throws(() => makeHalls({ byLevel: { '1e+21': { solid: 0.5 } } }), /there are parts only for whole numbers/);
  assert.throws(() => makeHalls({ byLevel: { 2: { salt: { built: 1 } } } }), /there is no byLevel\.2\.salt/);
  assert.throws(() => makeHalls({ byLevel: { 2: { byLevel: {} } } }), /there is no byLevel\.2\.byLevel/);
  assert.throws(() => makeHalls({ byLevel: { 2: { walls: { door: { share: 0.9 } } } } }), /halls: walls: shares adding up to/);
  assert.throws(() => plain.air([1, 1, 1], [0, 0, 0], [0, 0, 0], 1, null, undefined), /halls: a cell asked at no level/);
});
