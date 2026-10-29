import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { makeArcology, ARCOLOGY, VOLUME, _V2 } from '../../src/spaces/arcology.js';
const made = () => ({ arcology, _V2 });
import halls, { makeHalls } from '../../src/spaces/halls.js';
import { viewFrag } from '../../src/shaders.js';
import { levelSeed } from '../../src/util.js';
import { Flight } from '../../src/flight.js';
import { rand } from './rand.js';
import { rayHolds } from './rays.js';

// Some places in a world's buildings and plaza, and what its levels say there.
const sample = (space) => {
  const rnd = rand(43), out = [];
  for (let k = 0; k < 3000; k++) {
    const level = [-2, -1, 0, 1][k % 4], id = level === -2 ? [299 + Math.floor(rnd() * 3), 300 + Math.floor(rnd() * 2), 299 + Math.floor(rnd() * 3)] : [288 + Math.floor(rnd() * 24), 288 + Math.floor(rnd() * 24), 288 + Math.floor(rnd() * 24)];
    const q = [rnd() * 24, rnd() * 24, rnd() * 24], L = q.map(Math.round), f = q.map((x, a) => x - L[a]), ray = { dir: [0.6, 0.48, 0.64] };
    out.push(space.cellAir(L, f, id, levelSeed(level), undefined, level, [300, 300, 300], ray), ray.reach);
  }
  return out;
};

// And in the town on the roof band (whose cells _V2.relief marks), many
// more: what its density and kinds of building change is only there.
const townSample = (made) => {
  const { _V2, arcology: space } = made, P = 576, rnd = rand(53), out = [], cells = [];
  for (let x = 288; x < 312; x++) for (let y = 288; y < 312; y++) for (let z = 288; z < 312; z++) {
    const [m] = _V2.relief([x, y, z].map((q) => ((q % P) + P) % P), [300, 300, 300]);
    if ((m & 3) === _V2.BITS.PLAIN && (m >>> _V2.BITS.TOWN_AT) & 1) cells.push([x, y, z]);
  }
  for (let k = 0; k < 4000; k++) {
    const id = cells[k % cells.length], q = [rnd() * 24, rnd() * 12, rnd() * 24], L = q.map(Math.round), f = q.map((x, a) => x - L[a]), ray = { dir: [0.6, -0.48, 0.64] };
    out.push(space.cellAir(L, f, id, levelSeed(-1), undefined, -1, [300, 300, 300], ray), ray.reach);
  }
  return out;
};

// A kind of building of five boxes: a row of five narrow blocks.
const FIVE = { name: 'five', needs: 'W >= 10', else: 'block', count: '5', most: 5, each: { u0: 'ix0 + div(W * k, 5)', u1: 'ix0 + div(W * (k + 1), 5) - 1' }, box: ['u0', '0', 'iz0', 'u1', 'h1', 'iz1'] };

// A world made again from its definition is the same world; a variant of it
// is another, and leaves the first as it was.
test('a variant is made from the definition, and leaves the world as it was', () => {
  const before = { glsl: viewFrag(12, arcology, true), at: sample(arcology), halls: viewFrag(12, halls, true) };
  const again = makeArcology();
  assert.equal(viewFrag(12, again.arcology, true), before.glsl, 'made again: the same shader');
  assert.deepEqual(again.VOLUME.data, VOLUME.data, 'made again: the same table');
  assert.deepEqual(sample(again.arcology), before.at, 'made again: the same air');
  const v = makeArcology({ building: { edge: 'cornice' }, halls: { solid: 0.5, wall: { door: 0.6 } }, town: { density: [30, 60, 90] } });
  assert.equal(v.def.building.edge, 'cornice');
  assert.equal(v.def.halls.wall.door, 0.6);
  assert.equal(v.def.halls.wall.windows, ARCOLOGY.halls.wall.windows, 'what is not changed is kept');
  assert.notEqual(viewFrag(12, v.arcology, true), before.glsl, 'the variant\'s shader differs');
  assert.notDeepEqual(sample(v.arcology), before.at, 'the variant\'s air differs');
  assert.equal(viewFrag(12, arcology, true), before.glsl, 'the world\'s shader is as it was');
  assert.deepEqual(sample(arcology), before.at, 'the world\'s air is as it was');
  assert.equal(viewFrag(12, halls, true), before.halls, 'the halls are as they were');
  assert.notEqual(viewFrag(12, makeHalls({ low: 0.3 }).space, true), before.halls, 'a halls variant differs');
});

// Each part of the definition reaches what is made: a variant of any one of
// them alone draws otherwise.
test('every part of a variant is made', () => {
  const glsl = arcology.glsl, ring = ARCOLOGY.building.coreFace.findIndex((f) => f.kind === 'rings');
  const air = JSON.stringify([sample(arcology), townSample(made())]);
  for (const set of [
    { building: { edge: 'cornice' } },
    { building: { townH: 0.75 } },
    { building: { coreFace: ARCOLOGY.building.coreFace.map((f, i) => (i === ring ? { ...f, from: 10 } : f)) } },
    { halls: { solid: 0.5 } },
    { relief: { city: { depths: [0, 0.25, 0.75] } } },
    { relief: { finer: { depths: [0, 2, 4, 6, 10] } } },
    { town: { density: [30, 60, 90] } },
    { town: { pick: [0, 1, 2, 3, 4, 5] } },
    { town: { margin: 0.5 } },
    { town: { plans: ARCOLOGY.town.plans.map((p, i) => (i === 4 ? [[0, 0, 12, 24], [12, 0, 24, 24]] : p)) } },
    { town: { types: ARCOLOGY.town.types.filter((t) => t.name !== 'row') } },
    { town: { types: [...ARCOLOGY.town.types, FIVE] } },
  ]) {
    const v = makeArcology(set), what = JSON.stringify(set).slice(0, 80);
    assert.ok(v.arcology.glsl !== glsl, `${what} made no difference to the shader`);
    // (The column's rings aside, every part shows in the air the JavaScript
    // finds too.)
    if (!set.building?.coreFace) assert.ok(JSON.stringify([sample(v.arcology), townSample(v)]) !== air, `${what} made no difference to the JavaScript`);
    // (A building of five boxes: all five asked after, in both.)
    if (set.town?.types?.includes(FIVE)) assert.ok(v._V2.TOWN_SHAPES === 5 && v.arcology.glsl.includes('TOWN_SHAPES = 5'), 'the fifth box is not asked after');
  }
});

// The arcology's halls have rooms only where it lets them (see roomRule):
// on the city's row, away from the buildings, none, though the halls alone
// would have some; and nowhere more than the halls alone.
test('the arcology\'s rooms are the halls\' where it lets them be', () => {
  const seed = levelSeed(-2);
  let fewer = 0;
  for (let a = -9; a <= 9; a++) for (let c = -9; c <= 9; c++) for (const y of [0, 1]) {
    const id = [300 + a, 300 + y, 300 + c], mine = arcology.room(id, seed), theirs = halls.room(id, seed);
    assert.ok(!mine || theirs, `a room at ${id} the halls have not`);
    if (theirs && !mine) fewer++;
  }
  assert.ok(fewer > 20, `${fewer} rooms the arcology does without`);
});

// What a definition does not have, or of another kind, is refused; and a
// definition made cannot be changed after.
test('a variant must be one the definition has', () => {
  assert.throws(() => makeArcology({ building: { roof: 3 } }), /there is no building\.roof \(there are building\.heights/);
  assert.throws(() => makeArcology({ halls: { wall: { door: '0.6' } } }), /halls\.wall\.door is a number/);
  assert.throws(() => makeHalls({ furniture: 0.5 }), /furniture is a set of parts/);
  const up = ARCOLOGY.building.up.map((p) => p.slice()), v = makeArcology({ building: { up } });
  assert.throws(() => { v.def.halls.solid = 0.1; }, TypeError);
  assert.throws(() => { v.def.building.up[0][0] = 3; }, TypeError, 'a variant\'s own parts are frozen');
  assert.ok(!Object.isFrozen(up), 'what was given is not');
  assert.throws(() => makeArcology({ building: { edge: 'nope' } }), /no edge nope \(there are cornice, steps/);
  // (And what the rest of the arcology needs of a variant: see check.)
  for (const [set, said] of [
    [{ town: { margin: 2 } }, /town\.margin/],
    [{ relief: { finer: { quant: 1 } } }, /must be even/],
    [{ relief: { city: { sby: 3 } } }, /must be even/],
    [{ relief: { finer: { weights: [0.5, 0.5] } } }, /as many weights as depths/],
    [{ relief: { finer: { weights: [0.5, 0.1, 0.1, 0.1, 0.1] } } }, /adding up to 1/],
    [{ relief: { finer: { depths: [0, 2, 4, 6, 7] } } }, /twelfths/],
    [{ relief: { city: { depths: [0, 0.3, 0.5] } } }, /quarters/],
    [{ relief: { finer: { min: 1 } } }, /min under 3/],
    [{ town: { density: [] } }, /town\.density/],
    [{ town: { density: [12.5, 45, 80] } }, /town\.density/],
    [{ town: { density: [-5, 45, 80] } }, /town\.density/],
    [{ town: { pick: [0, 9] } }, /town\.pick/],
    [{ town: { pick: [] } }, /town\.pick/],
    [{ town: { types: [] } }, /town\.types/],
    [{ town: { pick: [0], plans: [[[0, 0, 24, 12]]] } }, /tile the cell|gap/],
    [{ town: { pick: [0], plans: [[[0, 12, 24, 24], [0, 0, 24, 12]]] } }, /in order/],
    [{ town: { pick: [0], plans: [[[0, 0, 24, 24], [0, 0, 12, 12]]] } }, /overlap/],
    [{ town: { pick: [0], plans: [[[0, 0, 12.5, 24], [12.5, 0, 24, 24]]] } }, /whole units/],
    [{ town: { pick: [0], plans: [Array.from({ length: 24 }, (_, i) => [i, 0, i + 1, 24])] } }, /sixteen/],
  ]) assert.throws(() => makeArcology(set), said, JSON.stringify(set));
});

// A variant is held to what every world must be: here, what its levels say
// of rays, from places a short flight from first visits.
test('a variant keeps what a world must', () => {
  const { arcology: space } = makeArcology({
    building: { edge: 'cornice', townH: 0.75 },
    halls: { solid: 0.5 },
    relief: { finer: { depths: [0, 2, 4, 6, 10] } },
    town: { density: [30, 60, 90, 100], types: ARCOLOGY.town.types.filter((t) => t.name !== 'row') },
  });
  const rnd = rand(47);
  let inAir = 0;
  for (let i = 0; i < 6; i++) {
    const flight = new Flight(space, { yaw: 0, pitch: 0, boost: () => 1 });
    flight.elsewhere(rnd);
    for (let s = 0; s < 30; s++) flight.step(1 / 30, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map((x) => x * 4));
    flight.sense();
    const c = Math.max(flight.clearance, 1e-3);
    for (const r of flight.here) for (let k = 0; k < 10; k++) {
      const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d), e = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], m = Math.hypot(...e);
      inAir += rayHolds(flight, r, d.map((x) => (x / l) * c * 2 * rnd()), e.map((x) => x / m)).inAir;
    }
  }
  assert.ok(inAir > 50, `${inAir} rays in air`);
});
