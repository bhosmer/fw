// The fading oracle (fade.js) against cases worked out by hand: a plane
// moving in, and growing as the ray goes; planes that are never met, or met
// only because they move; solids growing over the point; a fade that changes
// pace on the way; and the march's own sizes, whose rates must be how fast
// its offsets grow (else a ray's fade would not be the fade of the points
// along it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airExit, solidHit, unionExit, segmentsExit, marchState, reliefFade, LOD_LO, LOD_HI, LOD_K } from './fade.js';
import arcology from '../../src/spaces/arcology.js';

const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${what}: ${a}, not ${b}`);
const X = [1, 0, 0];
// (A plane across x, the point s outside it, the ray at angle c to it: dir . n = c.)
const plane = (s, o = 0, a = 0) => ({ s, n: X, o, a });
const along = (c) => [c, Math.sqrt(1 - c * c), 0];

test('a plane that moves in, and keeps moving as the ray goes, is met sooner', () => {
  // (The external review's case for ledger B43: 0.5 in, moved in by 0.1, and
  // by 0.02 more per unit, met at 0.1 per unit: (0.5 - 0.1) / (0.1 + 0.02).)
  near(airExit([plane(-0.5, 0.1, 0.02)], along(0.1)).x, 0.4 / 0.12, 'moving and growing');
  near(airExit([plane(-0.5, 0.1, 0)], along(0.1)).x, 4, 'moving, not growing (what B43 gives)');
  near(airExit([plane(-0.5)], along(0.1)).x, 5, 'as it is');
  assert.deepEqual(airExit([plane(-0.5, 0.1, 0.02)], along(0.1)).n, [-1, -0, -0]);
});

test('moved in past the point, the plane leaves it in no air', () => {
  assert.equal(airExit([plane(-0.5, 0.5)], along(0.1)).x, 0);
  assert.equal(airExit([plane(-0.5, 0.6)], along(0.1)), null);
});

test('a plane the ray leaves behind is met only if it moves in faster', () => {
  assert.equal(airExit([plane(-0.5, 0.1, 0.1)], along(-0.2)).x, Infinity);
  assert.equal(airExit([plane(-0.5, 0.1, 0.2)], along(-0.2)).x, Infinity);
  near(airExit([plane(-0.5, 0.1, 0.1)], along(-0.05)).x, 0.4 / 0.05, 'caught up with');
});

test('of several planes, the ray leaves by the first it meets', () => {
  const e = airExit([plane(-0.5), { s: -1, n: [0, 1, 0], o: 0.2, a: 0.1 }], along(0.1));
  near(e.x, Math.min(5, 0.8 / (Math.sqrt(0.99) + 0.1)), 'the nearer');
  assert.deepEqual(e.n, [-0, -1, -0]);
});

test('a solid grows as the air shrinks: struck sooner, and over the point at last', () => {
  // (A slab 2 to 3 units off along x; the ray straight at it.)
  const slab = (o, a) => [{ s: 2, n: [-1, 0, 0], o, a }, { s: -3, n: [1, 0, 0], o, a }];
  const h = solidHit(slab(0, 0), X);
  assert.ok(h.struck && h.in === 2 && h.out === 3);
  near(solidHit(slab(0.5, 0), X).in, 1.5, 'grown');
  near(solidHit(slab(0.5, 0.5), X).in, 1, 'grown, and growing');
  const over = solidHit(slab(2.5, 0), X);
  assert.ok(over.struck && over.in === 0, 'grown over the point');
  // (A face along the ray, the point outside it: never struck.)
  assert.ok(!solidHit([{ s: 0.5, n: [0, 1, 0], o: 0, a: 0 }], X).struck);
  assert.ok(solidHit([{ s: 0.5, n: [0, 1, 0], o: 0.5, a: 0 }], X).struck, 'grown to the ray');
});

test('in a union, the ray goes as far as the piece that takes it furthest, short of its solids', () => {
  const box = (lo, hi) => [{ s: lo, n: [-1, 0, 0], o: 0, a: 0 }, { s: -hi, n: [1, 0, 0], o: 0, a: 0 }];
  const pieces = [{ planes: [plane(-1)] }, { planes: [plane(-4)], solids: [box(2, 3)] }, { planes: [plane(1)] }];
  near(unionExit(pieces, X).x, 2, 'the second, cut at its solid');
  near(unionExit(pieces.slice(0, 1), X).x, 1, 'the first alone');
  assert.equal(unionExit(pieces.slice(2), X), null);
});

test('a fade that changes pace on the way is followed segment by segment', () => {
  // (Not moving at first; from 2 on, moving in at 0.25 per unit: met at 2 +
  // 3 / (1 + 0.25) along x, the plane 5 off.)
  const segs = [{ t0: 0, t1: 2, at: () => ({ o: 0, a: 0 }) }, { t0: 2, t1: 100, at: () => ({ o: 0, a: 0.25 }) }];
  near(segmentsExit([plane(-5)], X, segs).x, 2 + 3 / 1.25, 'two paces');
  near(segmentsExit([plane(-1.5)], X, segs).x, 1.5, 'met in the first');
  assert.equal(segmentsExit([plane(-500)], X, segs).x, 100);
});

test("the march's fade grows as its rates say, and changes pace at its turn", () => {
  const { close, R } = arcology;
  for (const slant of [0.6, 0.8, 1]) for (const pix of [5e-4, 2e-3]) for (const cell of [1, 24, 1e-3]) {
    // (Distances from the camera at which the level is faded a little, and
    // much: fed to the march as foot = far pix.)
    for (const rel of [0.1, 0.5, 0.9]) {
      const far = ((rel / LOD_K + 1 / LOD_HI) * slant * cell) / pix;
      const s = marchState({ foot: far * pix, cell, pix, slant, close, R });
      assert.ok(s && s.gA > 0, `faded at rel ${rel}`);
      // (A small way further on, in camera units, is (that / cell) R of the
      // level's lattice units: the offsets there are the rates' worth more.)
      const dt = 1e-3 * cell, lat = (dt / cell) * R, t = marchState({ foot: (far + dt) * pix, cell, pix, slant, close, R });
      near(t.gO, s.gO + s.gA * lat, 'gO grows at gA');
      near(t.gScale, s.gScale + s.gScaleRate * lat, 'gScale grows at gScaleRate');
      // (Its turn is where it is gone: rel reaches 1.)
      const end = marchState({ foot: s.turn * pix * (1 - 1e-9), cell, pix, slant, close, R });
      assert.ok(end && end.gO > close * R * (1 - 1e-6), `just short of its turn it is all but gone (${end?.gO})`);
      assert.equal(marchState({ foot: s.turn * pix * (1 + 1e-9), cell, pix, slant, close, R }), null);
    }
    // (Not yet fading: no offset, no growth; its turn is where it starts to.)
    const s = marchState({ foot: ((0.5 / LOD_HI) * slant * cell), cell, pix, slant, close, R });
    assert.ok(s.gO === 0 && s.gA === 0);
    near(s.turn * pix, slant * cell / LOD_HI, 'starts to fade at its turn');
  }
  // (The open level stays, faded fully, with nothing more to grow.)
  const open = marchState({ foot: 10, cell: 1, pix: 1e-3, slant: 1, close: arcology.close, R: arcology.R, open: true });
  assert.ok(open.gO === arcology.close * arcology.R && open.gA === 0 && open.turn === Infinity);
});

test("the relief's planes fade as its design says", () => {
  const w = { close: 0.3, R: 24 }, state = { gO: 3.6, gA: 0.012 };
  assert.deepEqual(reliefFade(0, 0, 0, state, w), { o: 3.6, a: 0.012 });
  assert.deepEqual(reliefFade(0, 1, 5, state, w), { o: 3.6, a: 0.012 });
  near(reliefFade(1, 1, 5, state, w).o, 2.5, 'a back, half faded, is up by half its depth');
  near(reliefFade(1, 1, 5, state, w).a, (0.012 / 7.2) * 5, 'and grows by its share');
  assert.equal(reliefFade(1, 2, 5, state, w).o, 0);
  near(reliefFade(1, 2, 5, state, w).a, (0.012 / 7.2) * 5, 'a floor or ceiling only grows');
  assert.deepEqual(reliefFade(1, 0, 5, state, w), { o: 0, a: 0 });
});
