import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, hashCell, levelSeed, hsv, define, byPaths, frozen, digest, stored } from '../../src/util.js';

// hashCell must match the shaders' bit for bit (the browser tests check the
// two against each other); these pin it down here, so that a change to one
// side shows up even without a GPU.
test('the hashes are what they have always been', () => {
  assert.equal(hash32(0), 3232319850);
  assert.equal(hash32(-1), 1895078355);
  assert.equal(hashCell([1, 2, 3], 4), 1400780410);
  assert.equal(hashCell([-5, 0, 7], 0xdeadbeef), 2679815431);
  assert.equal(levelSeed(0), 2084421627);
});

test('hsv gives linear colour, with hue wrapping', () => {
  assert.deepEqual(hsv(0, 0, 1), [1, 1, 1]);
  assert.deepEqual(hsv(0.25, 0.5, 0.8), hsv(1.25, 0.5, 0.8));
  assert.ok(hsv(0, 1, 1)[0] > 0.99 && hsv(0, 1, 1)[1] < 1e-9);
});

// A definition with changes: parts changed in place, the rest kept; what
// the defaults do not have, or of another kind, refused, saying what there is.
test('a definition takes the changes it can, and refuses the rest', () => {
  const d = { a: 1, b: { c: [1, 2], d: 'x', e: { f: true } }, g: (x) => x };
  assert.deepEqual(define(d, { b: { c: [3] } }), { ...d, b: { ...d.b, c: [3] } });
  assert.equal(define(d, {}).g, d.g);
  assert.equal(define(d, undefined), d);
  assert.equal(define(d, { b: { e: { f: false } } }).b.e.f, false);
  assert.equal(d.b.e.f, true, 'the defaults are left as they were');
  assert.throws(() => define(d, { h: 1 }), /there is no h \(there are a, b, g\)/);
  assert.throws(() => define(d, { b: { e: { z: 1 } } }), /there is no b\.e\.z \(there are b\.e\.f\)/);
  assert.throws(() => define(d, { a: '1' }), /a is a number/);
  assert.throws(() => define(d, { b: 3 }), /b is a set of parts/);
  assert.throws(() => define(d, { b: { c: 3 } }), /b\.c is an array/);
  assert.deepEqual(byPaths({ 'b.c': [3], 'b.e.f': false, a: 2 }), { b: { c: [3], e: { f: false } }, a: 2 });
});

// Changes from a link cannot reach objects' own workings, nor be set both
// whole and part by part; what is given is copied, not taken (nor frozen).
test('changes by path are safe, and what is given is left as it was', () => {
  for (const p of ['__proto__.x', 'constructor.prototype.x', 'a.__proto__', 'a..b']) assert.throws(() => byPaths({ [p]: 1 }), /no such part/);
  assert.equal(({}).x, undefined);
  assert.throws(() => byPaths({ a: 1, 'a.b': 2 }), /also set whole/);
  assert.throws(() => byPaths({ 'a.b': 2, a: 1 }), /set twice/);
  const part = { c: 1 };
  assert.throws(() => byPaths({ 'a.b': part, 'a.b.d': 2 }), /also set whole/);
  assert.throws(() => byPaths({ 'a.b.d': 2, 'a.b': part }), /set twice/);
  assert.deepEqual(part, { c: 1 }, 'what was given is left as it was');
  assert.notEqual(byPaths({ 'a.b': part }).a.b, part, 'and copied');
  const given = [[1, 2], [3]], d = define({ a: [[0]] }, { a: given });
  frozen(d);
  assert.ok(!Object.isFrozen(given) && !Object.isFrozen(given[0]), 'what was given is not frozen');
  assert.deepEqual(d.a, given);
  assert.ok(Object.isFrozen(d.a[0]), 'the copy is');
  assert.throws(() => define({ a: 1 }, { a: NaN }), /a is a number, not NaN|a is a number/);
  assert.throws(() => define({ a: 1 }, { a: (x) => x }), /a is a number, not a function/);
  assert.throws(() => define({ a: null }, { a: 1 }), /a is nothing/);
  const inner = { b: [1] }, outer = Object.freeze({ inner });
  frozen(outer);
  assert.ok(Object.isFrozen(inner.b), 'the parts of what was frozen already are frozen too');
});

// A digest tells apart lists that would run together, and what is kept
// without a store (here, in Node) is what is made.
test('digest keeps parts apart, and stored makes what it cannot keep', async () => {
  assert.notEqual(digest([1, 23]), digest([12, 3]));
  assert.notEqual(digest(['ab', 'c']), digest(['a', 'bc']));
  assert.notEqual(digest([[1], 2]), digest([1, [2]]));
  assert.notEqual(digest([new Int32Array([1, 2])]), digest([new Int32Array([1]), new Int32Array([2])]));
  assert.equal(digest(['a', 1, new Uint8Array([3])]), digest(['a', 1, new Uint8Array([3])]));
  let made = 0;
  assert.equal(await stored('key', () => (made++, 42)), 42);
  assert.equal(made, 1);
});
