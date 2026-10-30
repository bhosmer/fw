import { test } from 'node:test';
import assert from 'node:assert/strict';
import arcology, { makeArcology, ARCOLOGY, VOLUME, _V2 } from '../../src/spaces/arcology.js';
const made = () => ({ arcology, _V2 });
import { makeHalls } from '../../src/spaces/halls.js';
import { viewFrag } from '../../src/shaders.js';
import { levelSeed, define } from '../../src/util.js';
import { Flight, FLIGHT } from '../../src/flight.js';
import { elsewhere } from '../../src/arrival.js';
import { rand } from './rand.js';
import { rayHolds } from './rays.js';
import { VARIANTS, WORLDS, SETTINGS, makeWorld, makeSettings, fromLink } from '../../src/worlds.js';

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

// How far a ray goes in the plaza's air, far off from the building.
const farPlaza = (space) => {
  const ray = { dir: [0.6, 0, 0.8] };
  space.cellAir([12, 12, 12], [0.25, 0.25, 0.25], [340, 300, 330], levelSeed(-2), undefined, -2, [12, 12, 12], ray);
  return ray.reach;
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

// The halls the arcology is built of, alone (as the arcology makes them, from
// its definition with its levels' own: see makeArcology), with changes.
const hallsOf = (set) => makeHalls(define(ARCOLOGY, set && { halls: set }).halls);

// A world made again from its definition is the same world; a variant of it
// is another, and leaves the first as it was.
test('a variant is made from the definition, and leaves the world as it was', () => {
  const before = { glsl: viewFrag(12, arcology, true), at: sample(arcology), halls: hallsOf().glsl };
  const again = makeArcology();
  assert.equal(viewFrag(12, again.arcology, true), before.glsl, 'made again: the same shader');
  assert.deepEqual(again.VOLUME.data, VOLUME.data, 'made again: the same table');
  assert.deepEqual(sample(again.arcology), before.at, 'made again: the same air');
  assert.equal(viewFrag(12, makeArcology({ plaza: { fades: false } }).arcology, true), before.glsl, 'the plaza not fading, as it does not: the same shader');
  const v = makeArcology({ building: { edge: 'cornice' }, halls: { solid: 0.5, walls: { door: { share: 0.36 } } }, town: { density: [30, 60, 90] } });
  assert.equal(v.def.building.edge, 'cornice');
  assert.equal(v.def.halls.walls.door.share, 0.36);
  assert.equal(v.def.halls.walls.windows.share, ARCOLOGY.halls.walls.windows.share, 'what is not changed is kept');
  assert.notEqual(viewFrag(12, v.arcology, true), before.glsl, 'the variant\'s shader differs');
  assert.notDeepEqual(sample(v.arcology), before.at, 'the variant\'s air differs');
  assert.equal(viewFrag(12, arcology, true), before.glsl, 'the world\'s shader is as it was');
  assert.deepEqual(sample(arcology), before.at, 'the world\'s air is as it was');
  assert.equal(hallsOf().glsl, before.halls, 'the halls are as they were');
  assert.notEqual(hallsOf({ rooms: { low: { share: 0.3 } } }).glsl, before.halls, 'a halls variant differs');
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
    { town: { setback: { by: 2 } } },
    { town: { plans: ARCOLOGY.town.plans.map((p, i) => (i === 4 ? [[0, 0, 12, 24], [12, 0, 24, 24]] : p)) } },
    { town: { types: ARCOLOGY.town.types.filter((t) => t.name !== 'row') } },
    { town: { types: [...ARCOLOGY.town.types, FIVE] } },
    { plaza: { fades: true } },
  ]) {
    const v = makeArcology(set), what = JSON.stringify(set).slice(0, 80);
    assert.ok(v.arcology.glsl !== glsl, `${what} made no difference to the shader`);
    // (The column's rings aside, every part shows in the air the JavaScript
    // finds too.)
    // (The plaza that fades, far off: see farPlaza.)
    if (!set.building?.coreFace && !set.plaza) assert.ok(JSON.stringify([sample(v.arcology), townSample(v)]) !== air, `${what} made no difference to the JavaScript`);
    if (set.plaza) assert.ok(farPlaza(v.arcology) !== farPlaza(arcology), `${what} made no difference to the JavaScript`);
    // (A building of five boxes: all five asked after, in both.)
    if (set.town?.types?.includes(FIVE)) assert.ok(v._V2.TOWN_SHAPES === 5 && v.arcology.glsl.includes('TOWN_SHAPES = 5'), 'the fifth box is not asked after');
  }
});

// The arcology's halls have rooms only where it lets them (see spaceRoom):
// on the city's row, away from the buildings, none, though the halls alone
// would have some; and nowhere more than the halls alone.
test('the arcology\'s rooms are the halls\' where it lets them be', () => {
  const seed = levelSeed(-2), halls = hallsOf();
  let fewer = 0;
  for (let a = -9; a <= 9; a++) for (let c = -9; c <= 9; c++) for (const y of [0, 1]) {
    const id = [300 + a, 300 + y, 300 + c], mine = arcology.room(id, seed, -2), theirs = halls.room(id, seed, -2);
    assert.ok(!mine || theirs, `a room at ${id} the halls have not`);
    if (theirs && !mine) fewer++;
  }
  assert.ok(fewer > 20, `${fewer} rooms the arcology does without`);
});

// What a definition does not have, or of another kind, is refused; and a
// definition made cannot be changed after.
test('a variant must be one the definition has', () => {
  assert.throws(() => makeArcology({ building: { roof: 3 } }), /there is no building\.roof \(there are building\.ring/);
  assert.throws(() => makeArcology({ halls: { walls: { door: { share: '0.6' } } } }), /halls\.walls\.door\.share is a number/);
  // (The halls' kinds: shares no more than all; the last takes the rest.)
  assert.throws(() => makeHalls({ walls: { none: { share: 0.5 }, door: { share: 0.6 } } }), /halls: walls: shares adding up to 1\.42, more than all/);
  assert.throws(() => makeHalls({ furniture: { piers: { share: -0.1 } } }), /halls: furniture: piers: a share of -0.1/);
  // (And each kind's parts: what each holds, and furniture in its quarter.)
  assert.throws(() => makeHalls({ furniture: { benches: { turn: 'bit(h, 5)' } } }), /benches: its turn, "bit\(h, 5\)", is not true or false/);
  assert.throws(() => makeHalls({ walls: { door: { top: '1 < 2' } } }), /door: its top, "1 < 2", is not a whole number/);
  assert.throws(() => makeHalls({ furniture: { piers: { at: [11, 7] } } }), /piers: quartered, at \[11,7\] reaches past the room's middle/);
  // (And what the cell's own reckoning relies on: furniture clear of the
  // openings' reach into the room, and of where a visit starts.)
  assert.throws(() => makeHalls({ furniture: { piers: { at: [3, 3] } } }), /piers: it stands within a unit of a wall/);
  assert.throws(() => makeHalls({ furniture: { kiosk: { box: [[-2, 2], [-2, 2], [-1, 6]] } } }), /kiosk: it stands where a visit starts/);
  assert.throws(() => makeHalls({ furniture: { benches: { upTo: { under: 'well', over: 'well' } } } }), /benches: it stands over an opening it may have there \(well\)/);
  assert.throws(() => makeHalls({ byLevel: { 2: { furniture: { piers: { upTo: { under: 'oculus', over: 'well' } } } } } }), /piers: it stands under an opening it may have there \(well\)/);
  assert.throws(() => makeHalls({ furniture: 0.5 }), /furniture is a set of parts/);
  const up = ARCOLOGY.building.slopes.upper.slice(), v = makeArcology({ building: { slopes: { upper: up } } });
  assert.throws(() => { v.def.halls.solid = 0.1; }, TypeError);
  assert.throws(() => { v.def.building.slopes.upper[0] = 3; }, TypeError, 'a variant\'s own parts are frozen');
  assert.ok(!Object.isFrozen(up), 'what was given is not');
  assert.throws(() => makeArcology({ halls: { byLevel: { '-3': { solid: 0.5 } } } }), /arcology: halls\.byLevel\.-3: there are no halls coarser than the city's level/);
  assert.equal(makeArcology({ halls: { solid: 0.5, byLevel: { '-1': { rooms: { low: { share: 0.3 } } } } } }).def.halls.byLevel['-1'].solid, 0.5, 'a level\'s halls start from the arcology\'s');
  assert.throws(() => makeArcology({ building: { edge: 'nope' } }), /no edge nope \(there are cornice, steps/);
  // (And what the rest of the arcology needs of a variant: see check.)
  for (const [set, said] of [
    [{ town: { margin: 2 } }, /town\.margin/],
    // (A setback in whole units, none less than 0 nor more than a cell.)
    ...[{ by: -1 }, { by: 25 }, { by: 1.5 }, { by: NaN }, { by: '2' }, { least: -2 }, { least: Infinity }].map((setback) => [{ town: { setback } }, /town\.setback/]),
    [{ relief: { finer: { quant: 1 } } }, /must be even/],
    [{ relief: { city: { sby: 3 } } }, /must be even/],
    [{ relief: { finer: { sb: 25 } } }, /whole quanta/],
    [{ relief: { finer: { sby: 72 } } }, /could span 12 ridge rows/],
    [{ relief: { finer: { weights: [0.5, 0.5] } } }, /as many weights as depths/],
    [{ relief: { finer: { weights: [0.5, 0.1, 0.1, 0.1, 0.1] } } }, /adding up to 1/],
    [{ relief: { finer: { depths: [0, 2, 4, 6, 7] } } }, /twelfths/],
    [{ relief: { city: { depths: [0, 0.3, 0.5] } } }, /quarters/],
    [{ relief: { finer: { min: 1 } } }, /could span 8 ridge rows/],
    [{ relief: { finer: { splits: 2, sby: 48 } } }, /could span 8 ridge rows/],
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
  // (And what the exact count of ridge rows lets through that a rougher one
  // would not: rows of 36 span six.)
  assert.ok(makeArcology({ relief: { finer: { sby: 36 } } }).arcology, 'relief.finer.sby 36 builds');
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
    const flight = new Flight(space);
    elsewhere(flight, rnd);
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

// What a link names: a world or a variant (or none: the world there is),
// and changes to it by path (as JSON); a number alone (as makes a link new)
// passed over; nonsense refused, saying what there is.
test('a link names a world and changes to it', async () => {
  assert.deepEqual(fromLink('?7&arcology/cornice&town.density=%5B10,30,60%5D&halls.solid=0.5'), { name: 'arcology/cornice', changes: { town: { density: [10, 30, 60] }, halls: { solid: 0.5 } }, settings: undefined, vs: null });
  assert.deepEqual(WORLDS, ['arcology']);
  assert.deepEqual(fromLink(''), { name: 'arcology', changes: undefined, settings: undefined, vs: null });
  assert.deepEqual(fromLink('?3'), { name: 'arcology', changes: undefined, settings: undefined, vs: null });
  assert.throws(() => fromLink('?arcology&arcology/cornice'), /one world, not arcology and arcology\/cornice/);
  assert.throws(() => fromLink('?town.density=[1,2'), /not one/);
  assert.throws(() => fromLink('?arcology&__proto__.x=1'), /no such part/);
  assert.throws(() => fromLink('?arcology&__proto__=1'), /no such part/);
  assert.throws(() => fromLink('?arcology&a.b=1&a.b=2'), /set twice/);
  assert.deepEqual(fromLink('?town.margin=0.5'), { name: 'arcology', changes: { town: { margin: 0.5 } }, settings: undefined, vs: null }, 'changes with no world named are the arcology\'s');
  assert.throws(() => fromLink('?arcology&x=%2'), /not a part of a link/);
  assert.deepEqual(fromLink('?arcology&halls.solid=1e%2B0&utm_source=x&fbclid=AbC'), { name: 'arcology', changes: { halls: { solid: 1 } }, settings: undefined, vs: null });
  assert.deepEqual(fromLink('?arcology&halls.solid=1e+0'), { name: 'arcology', changes: { halls: { solid: 1 } }, settings: undefined, vs: null });
  await assert.rejects(() => makeWorld('toString'), /there is no world toString/);
  // (And a world to compare with: by name, or the same with changes of its own.)
  assert.deepEqual(fromLink('?arcology&town.margin=0.5&vs=arcology/cornice'), { name: 'arcology', changes: { town: { margin: 0.5 } }, settings: undefined, vs: { name: 'arcology/cornice', changes: { town: { margin: 0.5 } }, settings: undefined } });
  assert.deepEqual(fromLink('?arcology&vs.building.edge="girder"'), { name: 'arcology', changes: undefined, settings: undefined, vs: { name: 'arcology', changes: { building: { edge: 'girder' } }, settings: undefined } });
  assert.deepEqual(fromLink('?arcology&vs.town.setback.by=2'), { name: 'arcology', changes: undefined, settings: undefined, vs: { name: 'arcology', changes: { town: { setback: { by: 2 } } }, settings: undefined } });
  assert.throws(() => fromLink('?arcology&vs=arcology'), /the same as/);
  // (With no world named: compared with the world there is, by default.)
  assert.deepEqual(fromLink('?vs.town.margin=1').vs, { name: 'arcology', changes: { town: { margin: 1 } }, settings: undefined });
  assert.deepEqual(fromLink('?town.margin=0.5&vs=arcology/cornice').vs, { name: 'arcology/cornice', changes: { town: { margin: 0.5 } }, settings: undefined });
  assert.throws(() => fromLink('?vs=arcology'), /vs=arcology: the same as/);
  assert.throws(() => fromLink('?arcology&vs.town.margin=[1'), /not one/);
  assert.deepEqual(Object.keys(VARIANTS).sort(), Object.keys(ARCOLOGY.building.edges).filter((e) => e !== ARCOLOGY.building.edge).map((e) => `arcology/${e}`).sort());
  await assert.rejects(() => makeWorld('nope'), /there is no world nope \(there are arcology, arcology\/cornice/);
  await assert.rejects(() => makeWorld('halls'), /there is no world halls \(there are arcology, arcology\/cornice/);
  const w = await makeWorld('arcology/cornice', { town: { density: [10, 30, 60] } });
  assert.equal(w.base, 'arcology');
  assert.deepEqual(w.set, { building: { edge: 'cornice' }, town: { density: [10, 30, 60] } });
  assert.ok(w.space.glsl === makeArcology(w.set).arcology.glsl && w.space.glsl !== arcology.glsl, 'the world made is the variant with its changes');
  assert.equal((await makeWorld('arcology')).space, arcology, 'a world as it is is the one already made');
  await assert.rejects(() => makeWorld('arcology', { town: { nope: 1 } }), /there is no town\.nope/);
});

// Settings in a link (how we fly: see FLIGHT in flight.js), apart from the
// world's changes: they need no world named; a world to compare with has the
// same and any of its own, and may differ in them alone; they are checked
// against what there is. And no world has a part of a setting's name, which
// a link would never reach.
test('a link sets how we fly, apart from the world', async () => {
  assert.deepEqual(fromLink('?flight.ease=2'), { name: 'arcology', changes: undefined, settings: { flight: { ease: 2 } }, vs: null });
  assert.deepEqual(fromLink('?arcology&town.margin=0.5&flight.ease=2&vs.flight.speed=0.5'), {
    name: 'arcology', changes: { town: { margin: 0.5 } }, settings: { flight: { ease: 2 } },
    vs: { name: 'arcology', changes: { town: { margin: 0.5 } }, settings: { flight: { ease: 2, speed: 0.5 } } },
  });
  assert.deepEqual(fromLink('?arcology&vs=arcology&vs.flight.ease=3').vs, { name: 'arcology', changes: undefined, settings: { flight: { ease: 3 } } });
  assert.throws(() => fromLink('?arcology&flight.ease=2&flight.ease=3'), /set twice/);
  assert.deepEqual(fromLink('?vs.flight.ease=3').vs, { name: 'arcology', changes: undefined, settings: { flight: { ease: 3 } } });
  assert.deepEqual(makeSettings(undefined), SETTINGS);
  assert.deepEqual(makeSettings({ flight: { ease: 2 } }).flight, { ...FLIGHT, ease: 2 });
  assert.throws(() => makeSettings({ flight: { nope: 1 } }), /there is no flight\.nope/);
  assert.throws(() => makeSettings({ flight: { ease: 'slow' } }), /flight\.ease is a number/);
  // (In range: a speed more than 0, an easing of 0 seconds or more; none of them more than a number.)
  for (const flight of [{ speed: 0 }, { speed: -1 }, { speed: Infinity }, { ease: -0.5 }, { ease: Infinity }, { ease: NaN }]) assert.throws(() => makeSettings({ flight }), /definition: flight\.(speed|ease) is a number/, JSON.stringify(flight));
  assert.equal(makeSettings({ flight: { ease: 0 } }).flight.ease, 0);
  assert.throws(() => makeSettings(fromLink('?flight.speed=1e999').settings), /flight\.speed is a number more than 0, not Infinity/);
  // (How frames are drawn, too: view.history, a word.)
  assert.deepEqual(fromLink('?arcology&vs.view.history=depth').vs.settings, { view: { history: 'depth' } });
  assert.deepEqual(makeSettings(fromLink('?view.history=depth').settings).view, { history: 'depth' });
  assert.equal(makeSettings(undefined).view.history, 'range');
  assert.throws(() => makeSettings({ view: { history: 'fog' } }), /view\.history is depth or range, not fog/);
  assert.throws(() => makeSettings({ view: { nope: 1 } }), /there is no view\.nope/);
  assert.deepEqual(fromLink('?arcology&building.edge=cornice').changes, { building: { edge: 'cornice' } });
  assert.throws(() => fromLink('?arcology&town.density=[1,2'), /not one/);
  // (A word where a number belongs is refused as one; true and false are still JSON.)
  assert.throws(() => makeSettings(fromLink('?flight.speed=fast').settings), /is a number, not "fast"/);
  assert.deepEqual(fromLink('?arcology&a=true&b=false&c=null').changes, { a: true, b: false, c: null });
  for (const name of WORLDS) for (const part of Object.keys(SETTINGS)) await assert.rejects(() => makeWorld(name, { [part]: {} }), new RegExp(`there is no ${part}`), `${name} has a part named ${part}`);
});
