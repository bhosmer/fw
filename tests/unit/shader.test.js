import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFrag } from '../../src/shaders.js';
import { inlined, wholeNotApart } from './glsl.js';

// The view shader is built from nothing on a first visit, freezing the
// browser meanwhile (bench/cold.mjs times it). Each place that asks a world's
// cell() for its geometry gets a whole copy of it, and that is most of the
// program; and the time grows steeply past a point: for the arcology, with 2
// copies (184000 tokens) about 3 s, with 3 (274000) about 11 s, with 5
// (456000) about 20 s. These keep it under that point.
// (And the arcology whose plaza fades, as it did: see PLAZA in
// spaces/arcology.js.)
const BUDGET = {
  halls: { cell: 2, tokens: 40000 },
  arcology: { cell: 2, tokens: 200000 },
  'arcology&plaza.fades=true': { cell: 2, tokens: 200000, set: { plaza: { fades: true } } },
};

for (const [name, most] of Object.entries(BUDGET)) {
  test(`the ${name} view shader stays within its size`, async () => {
    const world = await import(`../../src/spaces/${name.split('&')[0]}.js`);
    const space = most.set ? world.makeArcology(most.set).arcology : world.default;
    const { copies, tokens } = inlined(viewFrag(12, space, true));
    assert.ok(copies.cell <= most.cell, `${copies.cell} copies of cell() (at most ${most.cell})`);
    assert.ok(tokens <= most.tokens, `${tokens} tokens written out (at most ${most.tokens})`);
  });
}

// Every program keeps a point's whole part apart from the rest (see
// wholeNotApart): the worlds, and the arcology as it was.
test('no program adds a point\'s whole part to the rest', async () => {
  const halls = (await import('../../src/spaces/halls.js')).default, A = await import('../../src/spaces/arcology.js');
  for (const space of [halls, A.default, A.makeArcology({ plaza: { fades: true }, town: { setback: { by: 0 } } }).arcology])
    for (const exact of [true, false]) assert.deepEqual(wholeNotApart(viewFrag(12, space, exact)), [], `${space.name}${exact ? '' : ', the older way'}`);
});
