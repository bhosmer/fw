import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacing, Resolution, MIN_UPSCALE } from '../../src/pacing.js';

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

const N = 1280 * 720; // a canvas's pixels

// Frames in motion of raw s each, n of them; the resolution and the share it
// ends at.
function frames(raw, n, exact = false, resolution = new Resolution(16)) {
  for (let i = 0; i < n; i++) resolution.frame(raw, 'moving', resolution.upscale(true, N), N, exact);
  return { resolution, upscale: resolution.upscale(true, N) };
}

// Still frames, as the loop draws them: a frame at each tick, n of them,
// each taking full s at full resolution and as many times less as it has
// fewer pixels (or as times says, in turn, where it does), and timed by the
// raw of the tick lag + 1 after it (the GPU lag frames behind).
function still(full, count, { times = [], lag = 0, resolution = new Resolution(16) } = {}) {
  const drawn = [], took = [];
  for (let i = 0; i < count; i++) {
    const upscale = resolution.upscale(false, N);
    const raw = i - 1 - lag >= 0 ? took[i - 1 - lag] : 1 / 60;
    resolution.frame(raw, 'still', upscale, N);
    drawn.push(upscale);
    took.push(times[i] ?? full * upscale * upscale);
  }
  return { resolution, drawn, upscale: resolution.upscale(false, N) };
}

test('quick frames at full resolution: it stays full', () => {
  assert.equal(frames(1 / 120, 500).upscale, 1);
});

test('three slow frames in a row: the resolution gives way', () => {
  assert.equal(frames(1 / 30, 2).upscale, 1);
  assert.equal(frames(1 / 30, 3).upscale, 0.8);
});

test('slow frames for long: the resolution goes no lower than its least', () => {
  assert.equal(frames(1 / 30, 300).upscale, MIN_UPSCALE);
});

test('quick frames for long: the resolution returns', () => {
  const { resolution } = frames(1 / 30, 300);
  assert.equal(frames(1 / 120, 90 * 20, false, resolution).upscale, 1);
});

test('views drawn exactly: the resolution never changes', () => {
  assert.equal(frames(1 / 10, 300, true).upscale, 1);
  const r = new Resolution(16);
  for (let i = 0; i < 20; i++) r.frame(0.5, 'still', 1, N, true);
  assert.equal(r.upscale(false, N), 1);
});

test('frames far too slow for the display: the resolution gives way', () => {
  assert.ok(frames(0.3, 3).upscale < 1);
  assert.equal(frames(0.3, 60).upscale, MIN_UPSCALE);
});

test('the frame rate shown counts every frame in motion, however slow', () => {
  const { resolution } = frames(0.3, 60);
  assert.ok(Math.abs(resolution.fps - 1 / 0.3) < 0.1, `${resolution.fps}`);
});

test('still frames within their time: full resolution', () => {
  assert.equal(still(0.08, 40).upscale, 1);
});

test('still frames over their time: the resolution of rest gives way to fit, once', () => {
  // (Pixels go as the share squared: a quarter of them for a quarter of the time.)
  for (const lag of [0, 1]) {
    const { drawn, upscale } = still(0.4, 40, { lag });
    assert.equal(upscale, 0.5, `lag ${lag}`);
    assert.equal(drawn.filter((u) => u === 1).length, 5, `lag ${lag}: ${drawn}`);
  }
});

test('slow still frames, two in a row, change nothing', () => {
  assert.equal(still(0.05, 10, { times: [0.05, 0.05, 5, 5, 0.05, 0.05, 5, 0.05] }).upscale, 1);
});

test('the resolution of motion is kept across a rest too short to say', () => {
  const { resolution } = frames(1 / 30, 3);
  still(0.01, 3, { resolution });
  assert.equal(resolution.upscale(true, N), 0.8);
});

test('setting off after a rest: at the share its still frames say a frame in motion can have', () => {
  // (Motion learned somewhere heavy; the rest is somewhere light, frames at the display's rate.)
  const light = frames(1 / 30, 300).resolution;
  still(1 / 60, 20, { resolution: light });
  // (A rest settled: ticks that draw nothing.)
  for (let i = 0; i < 5; i++) light.frame(1 / 60, null, 1, N);
  assert.equal(light.upscale(true, N), 1);
  // (A slow GPU: still frames 0.4 s at full resolution, drawn at half.)
  const slow = still(0.4, 20).resolution;
  assert.equal(slow.upscale(true, N), MIN_UPSCALE);
  // (A slow GPU, its rest cut to half, somewhere light: frames at the
  // display's rate say only that motion may have at least as much as it
  // learned.)
  const learned = still(0.4, 20).resolution;
  for (let i = 0; i < 2000; i++) learned.frame(1 / 60, 'moving', learned.upscale(true, N), N);
  const before = learned.upscale(true, N);
  still(0, 20, { resolution: learned, times: Array(20).fill(1 / 60) });
  assert.ok(before > 0.8 && learned.upscale(true, N) === before, `${before}`);
  // (Somewhere heavier on a fast GPU: 50 ms still frames.)
  const heavy = still(0.05, 20).resolution;
  assert.ok(Math.abs(heavy.upscale(true, N) - Math.sqrt(1 / 50 / 0.05)) < 1e-12);
});

test('a calm rest lets the next have more of the pixels; an interrupted one does not', () => {
  // (A first visit to a slow GPU's lighter view: 0.4 s full, then 0.04 s.)
  const rest = (n) => {
    const { resolution } = still(0.4, 5);
    still(0.04, n, { resolution });
    frames(1 / 60, 1, false, resolution);
    return resolution.upscale(false, N);
  };
  assert.equal(rest(20), 0.5 * 1.25);
  assert.equal(rest(5), 0.5);
});

test('on another canvas, the same number of pixels', () => {
  const { resolution } = still(0.4, 10);
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  assert.equal(resolution.upscale(false, N / 4), 1);
  assert.ok(near(resolution.upscale(false, N * 2), 0.5 / Math.SQRT2));
  assert.equal(resolution.upscale(false, N * 100), MIN_UPSCALE);
});

test('what is learned is restored; what cannot be read is passed over', () => {
  const learned = still(0.4, 10).resolution;
  const r = new Resolution(16);
  r.restore(learned.saved);
  assert.equal(r.upscale(false, N), 0.5);
  assert.equal(r.upscale(true, N), 1);
  for (const bad of [null, '', 'nonsense', '{"still":{"upscale":0.01,"n":5}}', '{"still":{"upscale":0.5}}', '{"moving":7}']) {
    const s = new Resolution(16);
    s.restore(bad);
    assert.equal(s.upscale(false, N), 1, bad);
    assert.equal(s.upscale(true, N), 1, bad);
  }
});
