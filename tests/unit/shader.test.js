import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFrag } from '../../src/shaders.js';
import { inlined } from './glsl.js';

// The view shader is built from nothing on a first visit, freezing the
// browser meanwhile (bench/cold.mjs times it: the arcology about 20 s at
// these sizes). Each place that asks a world's cell() for its geometry gets a
// whole copy of it, and that is most of the program: these keep it from
// growing back. (Lower them as the shader shrinks.)
const BUDGET = {
  halls: { cell: 5, tokens: 85000 },
  arcology: { cell: 5, tokens: 460000 },
};

for (const [name, most] of Object.entries(BUDGET)) {
  test(`the ${name} view shader stays within its size`, async () => {
    const { default: space } = await import(`../../src/spaces/${name}.js`);
    const { copies, tokens } = inlined(viewFrag(12, space, true));
    assert.ok(copies.cell <= most.cell, `${copies.cell} copies of cell() (at most ${most.cell})`);
    assert.ok(tokens <= most.tokens, `${tokens} tokens written out (at most ${most.tokens})`);
  });
}
