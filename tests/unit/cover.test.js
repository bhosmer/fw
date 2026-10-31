// The relief's cover (src/spaces/cover.js) covers every seam, at every fade:
// checked exhaustively (coverage.js) on one facet in several here; all of
// them by `node tests/unit/coverage.js` (about 45 s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from './coverage.js';

const EVERY = 9;

test('wherever pieces of air meet with air all round, a piece listed there holds the point, faded or not', () => {
  const out = [];
  for (const field of ['city', 'fine', 'union'])
    for (const fr of [0, 0.5, 1]) {
      const o = coverage(field, fr, EVERY);
      out.push({ field, fr, uncovered: o.uncovered, ex: o.ex });
      assert.ok(o.met > (field === 'city' ? 500 : 3000) && o.strata[2] > (field === 'city' ? 5000 : 50000), JSON.stringify(o));
    }
  assert.deepEqual(out.filter((o) => o.uncovered.some((n) => n)), []);
});

test("the coverage check finds the seams the cover's joins are for, left without them", () => {
  const o = coverage('union', 0, 40, 'joins');
  assert.ok(o.uncovered[1] + o.uncovered[2] > 20, JSON.stringify(o));
});
