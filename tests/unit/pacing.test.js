import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacing } from '../../src/pacing.js';

// Run refreshes of the given interval (ms) for a while, each frame drawn
// taking gpu(i) ms; returns the pacing and which refreshes drew.
function run(interval, gpu, seconds, pacing = new Pacing(0), t0 = 0) {
  const drew = [];
  let pending = [];
  for (let i = 1, now = t0; now < t0 + seconds * 1000; i++) {
    now += interval;
    const d = pacing.refresh(now, pending);
    pending = d ? [gpu(i)] : [];
    drew.push(d);
  }
  return { pacing, drew, end: t0 + seconds * 1000 };
}

test('light frames on a fast display: every refresh', () => {
  const { pacing, drew } = run(1000 / 120, () => 2.5, 5);
  assert.equal(pacing.every, 1);
  assert.ok(drew.every(Boolean));
});

test('heavy frames on a fast display: every other refresh, held', () => {
  const { pacing, drew, end } = run(1000 / 120, (i) => (i % 5 ? 4 : 9), 5);
  assert.equal(pacing.every, 2);
  const tail = drew.slice(-100);
  assert.equal(tail.filter(Boolean).length, 50);
  // A moment's light frames do not bring it straight back (it goes by the
  // last sixty drawn, a second's worth)...
  run(1000 / 120, () => 2, 0.25, pacing, end);
  assert.equal(pacing.every, 2);
  // ...but a while of them does.
  run(1000 / 120, () => 2, 2, pacing, end + 250);
  assert.equal(pacing.every, 1);
});

test('a slow display is never halved', () => {
  const { pacing } = run(1000 / 60, () => 14, 5);
  assert.equal(pacing.every, 1);
});
