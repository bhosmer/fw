import assert from 'node:assert/strict';

// What a test known to fail fails with, by its ledger item: a pattern its
// message has. (A failure known is not a pass: see known.) None, now.
const KNOWN = {};

// A test known to fail (t, its context; item, the ledger's), run: failing
// as the item says, it is shown as a todo; failing otherwise, it fails as
// any test would; passing, it fails too, so that the todo is dropped when
// the item is fixed, not left to pass unseen.
export function known(t, item, fn) {
  if (!KNOWN[item]) throw new Error(`known: no item ${item} in KNOWN`);
  try {
    fn();
  } catch (e) {
    if (!KNOWN[item].test(e.message)) throw e;
    t.todo(item);
    throw e;
  }
  assert.fail(`${item}: passes now: drop the todo`);
}
