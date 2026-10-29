import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFrag } from '../../src/shaders.js';
import { inlined } from './glsl.js';

// The view shader is built from nothing on a first visit, freezing the
// browser meanwhile (bench/cold.mjs times it). Each place that asks a world's
// cell() for its geometry gets a whole copy of it, and that is most of the
// program; and the time grows steeply past a point: for the arcology, with 2
// copies (184000 tokens) about 3 s, with 3 (274000) about 11 s, with 5
// (456000) about 20 s. These keep it under that point.
const BUDGET = {
  halls: { cell: 2, tokens: 40000 },
  arcology: { cell: 2, tokens: 200000 },
};

for (const [name, most] of Object.entries(BUDGET)) {
  test(`the ${name} view shader stays within its size`, async () => {
    const { default: space } = await import(`../../src/spaces/${name}.js`);
    const { copies, tokens } = inlined(viewFrag(12, space, true));
    assert.ok(copies.cell <= most.cell, `${copies.cell} copies of cell() (at most ${most.cell})`);
    assert.ok(tokens <= most.tokens, `${tokens} tokens written out (at most ${most.tokens})`);
  });
}
