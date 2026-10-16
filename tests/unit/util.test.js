import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, hashCell, levelSeed, hsv } from '../../src/util.js';

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
