import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flight, PITCH_MAX } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import { readPlace, placeOf, writePlace, applyPlace, LEVEL_MOST } from '../../src/place.js';
import { makeWorld } from '../../src/worlds.js';
import { rand } from './rand.js';

const hash = (o) => '#' + Buffer.from(JSON.stringify(o)).toString('base64');
const { space } = await makeWorld('arcology');
const R = space.R;

// Where a flight is, to compare: its level, offset, every digit from well
// above anything stored down to its level, and its facing.
function where(flight, top = -100) {
  const { pos } = flight;
  const digits = [];
  for (let j = Math.min(top, ...pos.digits.keys()); j <= pos.F; j++) digits.push([j, pos.digit(j).slice()]);
  return JSON.stringify({ F: pos.F, frac: pos.frac, digits, yaw: flight.yaw, pitch: flight.pitch });
}

// Places a visit might be: first visits, flown on from a little way.
function visits(space, seed, n = 12) {
  const rnd = rand(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const flight = new Flight(space);
    elsewhere(flight, rnd);
    flight.yaw = (rnd() - 0.5) * 20;
    flight.pitch = (rnd() - 0.5) * 2;
    const dir = [rnd() - 0.5, (rnd() - 0.5) * 0.3, rnd() - 0.5];
    for (let s = 0; s < 30 * i; s++) flight.step(1 / 30, dir.map((x) => x * 4));
    out.push(flight);
  }
  return out;
}

test('a place written and read again is the same place', () => {
  for (const flight of visits(space, 11)) {
    const text = writePlace(placeOf(flight), [space]);
    const { place, why } = readPlace(text, R);
    assert.ok(place, `refused (${why}): ${text}`);
    assert.equal(place.shown, 'A');
    const there = new Flight(space);
    there.yaw = 99;
    applyPlace(there, place);
    assert.equal(where(there), where(flight), text);
    // (And written again, the same link.)
    assert.equal(writePlace(placeOf(there), [space]), text);
  }
});

// Two worlds compared, which put their default digits differently: a place
// flown to with the second shown, written for both, is the same place gone
// to from the first, flipped as the app flips (see Flight.setSpace), once
// its level is set and before its offset and digits are. (The second, the
// arcology with its default digit moved across at a level coarser than the
// city's, where all is solid: none of its variants puts one elsewhere.)
test('a place shown on the other side of a comparison is there again', () => {
  const A = space, moved = [5, A.ancestorDigit(-3)[1], 7];
  const B = { ...A, ancestorDigit: (j) => (j === -3 ? moved : A.ancestorDigit(j)) };
  assert.notDeepEqual(A.ancestorDigit(-3), moved);
  const rnd = rand(3);
  for (const flight of visits(A, 3, 6)) {
    // (Flipped, our digit there, A's default, becomes B's.)
    assert.deepEqual(flight.pos.digit(-3), A.ancestorDigit(-3));
    flight.setSpace(B);
    assert.deepEqual(flight.pos.digit(-3), moved, 'the default digit was not taken to the other world\'s');
    const dir = [rnd() - 0.5, 0, rnd() - 0.5];
    for (let s = 0; s < 60; s++) flight.step(1 / 30, dir.map((x) => x * 4));
    const text = writePlace(placeOf(flight, 'B'), [A, B]);
    const { place } = readPlace(text, R);
    assert.equal(place.shown, 'B');
    const there = new Flight(A);
    const snap = () => ({ F: there.pos.F, frac: there.pos.frac.slice(), digits: [...there.pos.digits].map(([j, d]) => [j, d.slice()]) });
    const before = snap();
    let seen = null;
    applyPlace(there, place, (shown) => {
      seen = { shown, ...snap() };
      if (shown === 'B') there.setSpace(B);
    });
    assert.deepEqual(seen, { shown: 'B', ...before, F: place.F });
    // (Written again, the same link: before where() fills in digits, which
    // would be written where they are B's defaults and not A's.)
    assert.equal(writePlace(placeOf(there, 'B'), [A, B]), text);
    assert.equal(where(there), where(flight), text);
    // (Shown A, nothing is written of it.)
    assert.ok(!Object.hasOwn(JSON.parse(atob(writePlace(placeOf(flight), [A, B]).slice(1))), 'shown'));
  }
});

test('a place without a facing faces the most open way, as a new visit does', () => {
  for (const flight of visits(space, 5, 6)) {
    const at = JSON.parse(atob(writePlace(placeOf(flight), [space]).slice(1)));
    for (const facing of [{ yaw: undefined, pitch: undefined }, { yaw: null, pitch: null }, { yaw: 1, pitch: undefined }]) {
      const { place } = readPlace(hash({ ...at, ...facing }), R);
      assert.equal(place.facing, null);
      const there = new Flight(space);
      there.yaw = 0.6;
      there.pitch = -0.05;
      applyPlace(there, place);
      assert.equal(there.pitch, 0);
      assert.ok([0, 1, 2, 3].some((k) => there.yaw === (k * Math.PI) / 2), `faced ${there.yaw}`);
      assert.equal(there.pos.F, flight.pos.F);
    }
  }
});

test('what may be left out of a place', () => {
  const at = { F: -1, frac: [0.5, 0.25, 0], yaw: 1, pitch: 0 };
  const { place } = readPlace(hash(at), R);
  assert.deepEqual(place.digits, []);
  // (A pitch further than we can face is taken to the most we can.)
  assert.deepEqual(readPlace(hash({ ...at, pitch: 3 }), R).place.facing, { yaw: 1, pitch: PITCH_MAX });
  assert.deepEqual(readPlace(hash({ ...at, pitch: -3 }), R).place.facing, { yaw: 1, pitch: -PITCH_MAX });
});

test('a place that cannot be read is refused whole', () => {
  const good = { F: 1, frac: [0.2, 0.6, 0.02], digits: [[0, [3, 17, 3]], [1, [0, R - 1, 0]]], yaw: 1.5, pitch: -0.1 };
  assert.ok(readPlace(hash(good), R).place);
  const bad = {
    'nothing at all': '',
    'not base64': '#%%%',
    'not JSON': '#' + btoa('{F: 1'),
    'null': hash(null),
    'a number': hash(3),
    'a list': hash([1, 2, 3]),
    'no level': hash({ ...good, F: undefined }),
    'a level in between': hash({ ...good, F: 1.5 }),
    'a level as text': hash({ ...good, F: '1' }),
    'a level beyond counting': hash({ ...good, F: 1e300 }),
    'a level too far down': hash({ ...good, F: LEVEL_MOST + 1, digits: [] }),
    'a level too far up': hash({ ...good, F: -LEVEL_MOST - 1, digits: [] }),
    'a digit too far up': hash({ ...good, digits: [[-LEVEL_MOST - 1, [3, 17, 3]]] }),
    'no offset': hash({ ...good, frac: undefined }),
    'two offsets': hash({ ...good, frac: [0.2, 0.6] }),
    'an offset of 1': hash({ ...good, frac: [0.2, 1, 0.02] }),
    'an offset below 0': hash({ ...good, frac: [0.2, -0.1, 0.02] }),
    'an offset as text': hash({ ...good, frac: [0.2, '0.6', 0.02] }),
    'an offset of null': hash({ ...good, frac: [0.2, null, 0.02] }),
    'digits not a list': hash({ ...good, digits: { 0: [3, 17, 3] } }),
    'a digit finer than the level': hash({ ...good, digits: [[2, [3, 17, 3]]] }),
    'a digit at no level': hash({ ...good, digits: [[0.5, [3, 17, 3]]] }),
    'a digit of two': hash({ ...good, digits: [[0, [3, 17]]] }),
    'a digit of R': hash({ ...good, digits: [[0, [3, R, 3]]] }),
    'a digit below 0': hash({ ...good, digits: [[0, [3, -1, 3]]] }),
    'a digit in between': hash({ ...good, digits: [[0, [3, 1.5, 3]]] }),
    'a digit without its level': hash({ ...good, digits: [[[3, 17, 3]]] }),
    'a yaw as text': hash({ ...good, yaw: 'east' }),
    'a pitch as a thing': hash({ ...good, pitch: {} }),
  };
  for (const [name, text] of Object.entries(bad)) {
    const read = readPlace(text, R);
    assert.ok(!read.place && typeof read.why === 'string', `${name}: ${JSON.stringify(read)}`);
  }
});

// A place is checked whole before anything of it is applied, so applying
// one that was read cannot fail halfway: even at the furthest levels a link
// may name, it is gone to, and flown from.
test('a place at the furthest levels a link may name is gone to whole', () => {
  for (const at of [{ F: -LEVEL_MOST }, { F: LEVEL_MOST }, { F: 0, digits: [[-LEVEL_MOST, [1, 1, 1]]] }]) {
    const { place, why } = readPlace(hash({ frac: [0.5, 0.5, 0.5], yaw: 0, pitch: 0, ...at }), R);
    assert.ok(place, `${JSON.stringify(at)}: refused (${why})`);
    const flight = new Flight(space);
    applyPlace(flight, place);
    for (let s = 0; s < 30; s++) flight.step(1 / 30, [0, 0, -1]);
    const { F, frac } = flight.pos;
    assert.ok(Number.isInteger(F) && frac.every((x) => x >= 0 && x < 1), `${JSON.stringify(at)}: at ${F} ${frac}`);
    assert.ok([flight.clearance, flight.scale, flight.fog].every(Number.isFinite), `${JSON.stringify(at)}: ${flight.clearance} ${flight.scale} ${flight.fog}`);
  }
});

test('a place read is its own: changing it changes nothing it was read from or applied to', () => {
  const [flight] = visits(space, 9, 1);
  const { place } = readPlace(writePlace(placeOf(flight), [space]), R);
  const there = new Flight(space);
  applyPlace(there, place);
  const was = where(there);
  place.frac[0] = 0.999;
  for (const [, d] of place.digits) d[0] = 0;
  assert.equal(where(there), was);
});
