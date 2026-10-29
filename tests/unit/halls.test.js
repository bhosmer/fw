import { test } from 'node:test';
import assert from 'node:assert/strict';
import halls, { makeHalls } from '../../src/spaces/halls.js';
import { levelSeed, wrapId as wrapIdR } from '../../src/util.js';
import { rand } from './rand.js';

const R = halls.R;
const P = R * R;
const wrapId = (id) => wrapIdR(id, R);

// The distance at a point given as lattice coordinates q (0..R) in cell id,
// of the level whose seed it is.
function air(q, id, seed, level) {
  const L = q.map(Math.round);
  return halls.cellAir(L, q.map((x, a) => x - L[a]), id, seed, null, level);
}

// A distance that never overstates changes no faster than the point moves:
// were it to, one of the two values would be more than the true distance.
test('cellAir never changes faster than the point moves', () => {
  const rnd = rand(5);
  let worst = 0;
  for (let n = 0; n < 20000; n++) {
    const id = wrapId([0, 1, 2].map(() => Math.floor(rnd() * P)));
    const level = Math.floor(rnd() * 40) - 20, seed = levelSeed(level);
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

test('a cell sits somewhere solid in its parent', () => {
  // ancestorDigit(j) is where the level j cell sits in its level j - 1
  // parent, whose own place is ancestorDigit(j - 1) in its parent: that
  // child cell of the parent must be solid all through.
  for (let j = 5; j >= -30; j--) {
    const d = halls.ancestorDigit(j);
    const up = halls.ancestorDigit(j - 1), upper = halls.ancestorDigit(j - 2);
    const parent = wrapId(up.map((x, a) => x + R * upper[a]));
    const centre = d.map((x) => x + 0.5);
    assert.ok(air(centre, parent, levelSeed(j - 1), j - 1) >= 0.5, `level ${j} at ${d}`);
  }
});

test('the world is the same every time', () => {
  const a = [-3, 0, 4].map((j) => halls.ancestorDigit(j).join());
  const b = [-3, 0, 4].map((j) => halls.ancestorDigit(j).join());
  assert.deepEqual(a, b);
  assert.deepEqual(halls.palette(7), halls.palette(7));
  assert.notDeepEqual(halls.palette(7), halls.palette(8));
});

// Each kind's threshold is one single precision holds exactly, so that the
// shader's literal picks just as the JavaScript's number does; and each
// picks, for every hash's number (a whole number of 2^-24ths), as the
// shares themselves say: tried at the numbers either side of it.
test('the halls\' thresholds pick alike in both languages, as the shares say', () => {
  for (const made of [makeHalls(), makeHalls({ walls: { door: { share: 0.1 } }, slabs: { solid: { share: 0.33 } } })])
    for (const [part, kinds] of Object.entries(made.kindsAt(null))) {
      let sum = 0;
      for (const k of kinds) {
        if (k.to === null) continue;
        sum = +(sum + made.spec[part][k.name].share).toPrecision(12);
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
    const a = by.air(L, f, id, seed, null, level, null, r1), b = want.air(L, f, id, seed, null, level, null, r2);
    if (a !== b || r1.reach !== r2.reach || JSON.stringify(by.room(id, seed, level)) !== JSON.stringify(want.room(id, seed, level)) || JSON.stringify(by.openings(id, seed, level)) !== JSON.stringify(want.openings(id, seed, level))) differ++;
    if (level === -1 && a !== plain.air(L, f, id, seed, null, level, null)) changed++;
  }
  assert.equal(differ, 0, `${differ} answers not as their level's halls`);
  assert.ok(changed > 500, `the change made little difference (${changed}): the test sees too little`);
  // (Its shader: one copy of the cell, the level's own kinds where they differ.)
  assert.match(by.glsl, /if \(level == -1\) \{/);
  assert.equal(by.glsl.match(/float hallsCellIn\(/g).length, 1);
  // (A level's changes are to the halls as defined, with their own changes.)
  const both = makeHalls({ solid: 0.5, rooms: { low: { share: 0.2 } }, byLevel: { '-1': { furniture: { none: { share: 0.1 } } } } }).spec.byLevel['-1'];
  assert.deepEqual([both.solid, both.rooms.low.share, both.furniture.none.share], [0.5, 0.2, 0.1]);
  assert.throws(() => makeHalls({ byLevel: { '-01': { solid: 0.5 } } }), /byLevel\.-01: there are parts only for whole numbers/);
  assert.throws(() => makeHalls({ byLevel: { '1e+21': { solid: 0.5 } } }), /there are parts only for whole numbers/);
  assert.throws(() => makeHalls({ byLevel: { 2: { salt: { built: 1 } } } }), /there is no byLevel\.2\.salt/);
  assert.throws(() => makeHalls({ byLevel: { 2: { byLevel: {} } } }), /there is no byLevel\.2\.byLevel/);
  assert.throws(() => makeHalls({ byLevel: { 2: { walls: { door: { share: 0.9 } } } } }), /halls: walls: shares adding up to/);
  assert.throws(() => plain.air([1, 1, 1], [0, 0, 0], [0, 0, 0], 1, null, undefined, null), /halls: a cell asked at no level/);
});
