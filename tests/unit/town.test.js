import { test } from 'node:test';
import assert from 'node:assert/strict';
import { townShapeJs, townShapeGlsl, TOWN_SHAPES, TOWN_TYPES } from '../../src/spaces/town.js';
import { _V2 } from '../../src/spaces/arcology.js';
import { rand } from './rand.js';

// Every building the catalogue can make, on lots of every size up to a
// cell's, with any hashes: its numbers stay in range (a field modulo
// nothing, a shift past 31, a division by nothing or of less than nothing
// would throw), and on the plans' own lots each box is a box.
test('the town\'s catalogue makes sound buildings', () => {
  const shape = townShapeJs(_V2.TOWN.H, true), rnd = rand(29);
  let boxes = 0;
  for (let it = 0; it < 400; it++) {
    const h = it < 2 ? [0, 0xffffffff][it] : Math.floor(rnd() * 2 ** 32), h2 = it < 2 ? [0, 0xffffffff][it] : Math.floor(rnd() * 2 ** 32 / 100) * 100;
    for (let W = 0; W <= 30; W++) for (let D = 0; D <= 30; D++) for (let k = 0; k < TOWN_SHAPES; k++) shape(h, h2, [0, 0, W + 2, D + 2], 100, k);
    for (const r of _V2.TOWN_PLANS.flat()) for (let k = 0; k < TOWN_SHAPES; k++) {
      const b = shape(h, h2, r, 100, k);
      if (!b) continue;
      boxes++;
      assert.ok(b[0] < b[3] && b[1] < b[4] && b[2] < b[5] && b[1] === 0 && b[4] <= _V2.TOWN.H, `box ${b} of lot ${r} (${h}, ${h2}, ${k})`);
    }
  }
  assert.ok(boxes > 10000, `${boxes} boxes`);
});

// The shader's: written out whole (no helper left to call), in GLSL's own
// words.
test('the town\'s shader is written out', () => {
  const g = townShapeGlsl();
  assert.ok(!/\b(bit|field|top|div)\(/.test(g), 'a helper is left');
  assert.ok(!/===|!==|=>|const |let /.test(g), 'JavaScript is left');
});

// No type makes more boxes than TOWN_SHAPES asks for (a row's count is
// worked out: its most must cover it).
test('no building has more boxes than are asked for', () => {
  const shape = townShapeJs(_V2.TOWN.H), rnd = rand(37);
  for (let it = 0; it < 2000; it++) {
    const h = Math.floor(rnd() * 2 ** 32), h2 = Math.floor(rnd() * 2 ** 32 / 100) * 100;
    for (let W = 0; W <= 26; W++) assert.equal(shape(h, h2, [0, 0, W + 2, 26 - W], 100, TOWN_SHAPES), null, `box ${TOWN_SHAPES} of a ${W + 2} by ${26 - W} lot`);
  }
});

// The catalogue's words are checked: what either language would read
// differently, or not at all, is refused.
test('the town\'s catalogue refuses what it cannot write', () => {
  for (const e of ['ix0 >> 1', 'ix0 << 1', 'ix0 % 3', 'ix0 & 1', 'ix0 / 2', 'W, D', 'bit(h)', 'bit(h + 1, 2)', 'field(h2, 3)', 'h + 1', 'ix0++', '1.5', '0x10', 'ix0 = 1', 'nothing']) {
    assert.throws(() => townShapeJs(_V2.TOWN.H, false, [...TOWN_TYPES, { name: 'test', boxes: [['ix0', '0', 'iz0', 'ix1', e, 'iz1']] }]), /town:/, `${e} let through`);
  }
  for (const t of [{ name: 'block', boxes: [] }, { name: 'test', needs: 'W >= 1', boxes: [] }, { name: 'test', needs: 'W >= 1', else: 'toString', boxes: [] }, { name: 'test', vars: { lo: '1' }, boxes: [] }]) {
    assert.throws(() => townShapeJs(_V2.TOWN.H, false, [...TOWN_TYPES, t]), /town:/, `${JSON.stringify(t)} let through`);
  }
});

// Today's town, as it stands: a digest of every box over many hashes and
// all the plans' lots, so that a new entry in the catalogue (or a change to
// one) shows if it moves the buildings that are there.
test('the town stands as it did', () => {
  const shape = townShapeJs(_V2.TOWN.H), rnd = rand(41);
  let d = 0x811c9dc5;
  const mix = (x) => (d = Math.imul(d ^ (x & 0xffff), 16777619) >>> 0);
  for (let it = 0; it < 3000; it++) {
    const h = Math.floor(rnd() * 2 ** 32), h2 = Math.floor(rnd() * 2 ** 32);
    for (const r of _V2.TOWN_PLANS.flat()) for (const dens of _V2.TOWN_DENSITY) for (let k = 0; k < TOWN_SHAPES; k++) (shape(h, h2, r, dens, k) ?? [99]).forEach(mix);
  }
  assert.equal(d.toString(16), '223afdea');
});
