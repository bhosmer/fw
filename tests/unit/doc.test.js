// docs/doc.mjs: the markers, budgets, names, the history lint, coverage of
// src/, staleness by ancestry, affected and verify, on small repositories
// made for each test; and the real docs/architecture.md passing its check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse, strip, check, stale, run, DOC } from '../../docs/doc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// A repository with two src files, a test folder and a doc.
function repo(doc) {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  for (const d of ['src', 'tests', 'docs']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'src/a.js'), 'export function alpha() {}\n');
  writeFileSync(join(dir, 'src/b.js'), 'export const beta = 1;\n');
  writeFileSync(join(dir, 'tests/a.test.js'), '// gamma\n');
  const put = (text) => writeFileSync(join(dir, DOC), text);
  put(doc ?? '# Doc\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  const commit = (msg, files) => { git('add', ...files); git('commit', '-qm', msg); return git('rev-parse', '--short=7', 'HEAD'); };
  return { dir, git, put, commit, text: () => readFileSync(join(dir, DOC), 'utf8') };
}

const DOC_TEXT = (v = 'VER') => `# Doc
<!-- budget: 400 -->

Intro, naming \`src/a.js\`.

## Alpha
<!-- files: src/a.js  budget: 150  verified: ${v} -->
\`alpha\` does it.

## Beta and tests
<!-- files: src/b.js,tests/  budget: 150  verified: ${v} -->
\`beta\`, and \`gamma\` in the tests.
`;

test('parse: title, budget, sections with their markers; strip leaves the prose', () => {
  const d = parse(DOC_TEXT('abc1234'));
  assert.equal(d.budget, 400);
  assert.deepEqual(d.sections.map((s) => [s.id, s.files, s.budget, s.verified]), [
    ['alpha', ['src/a.js'], 150, 'abc1234'], ['beta-and-tests', ['src/b.js', 'tests/'], 150, 'abc1234']]);
  assert.equal(d.sections[0].text, '## Alpha\n`alpha` does it.\n');
  assert.doesNotMatch(strip(DOC_TEXT()), /<!--/);
});

test('check: coverage of src/, files that exist, budgets, names, the lint', () => {
  const r = repo();
  const head = r.git('rev-parse', '--short=7', 'HEAD');
  r.put(DOC_TEXT(head));
  assert.deepEqual(check(r.dir).failures, []);
  // A src file in no section, a missing file, a folder under src/.
  writeFileSync(join(r.dir, 'src/c.js'), '');
  r.put(DOC_TEXT(head).replace('files: src/a.js ', 'files: src/a.js,src/gone.js,src/ '));
  let f = check(r.dir).failures.join('\n');
  assert.match(f, /src\/c\.js is in no section/);
  assert.match(f, /src\/gone\.js does not exist/);
  assert.match(f, /src\/ is a folder; name src\/ files one by one/);
  // Over budget: a section, and the whole.
  r.put(DOC_TEXT(head).replace('`alpha` does it.', '`alpha` does it. ' + 'x'.repeat(200)).replace('src/a.js ', 'src/a.js,src/c.js '));
  f = check(r.dir).failures.join('\n');
  assert.match(f, /"Alpha": 2\d\d bytes, over its budget of 150/);
  r.put(DOC_TEXT(head).replace('budget: 400', 'budget: 100').replace('src/a.js ', 'src/a.js,src/c.js '));
  assert.match(check(r.dir).failures.join('\n'), /bytes, over its budget of 100/);
  // A name found nowhere; a path that is not there; a name found by its head.
  r.put(DOC_TEXT(head).replace('src/a.js ', 'src/a.js,src/c.js ').replace('`alpha` does it.', '`alpha()` and `beta = 2` and `delta` and `src/nope.js` and `tests/*.test.js`.'));
  f = check(r.dir).failures;
  assert.deepEqual(f.map((x) => x.replace(/^.*: `/, '`')), ['`delta` is in neither the section\'s files nor the repo', '`src/nope.js` is in neither the section\'s files nor the repo']);
  // The lint warns, and does not fail.
  r.put(DOC_TEXT(head).replace('src/a.js ', 'src/a.js,src/c.js ').replace('Intro,', 'As of today, used to be so, since 2026-10-30, as it was;'));
  const { failures, warnings } = check(r.dir);
  assert.deepEqual(failures, []);
  assert.deepEqual(warnings.map((w) => w.match(/"([^"]+)"/)[1]).sort(), ['As of', 'as it was', 'since 2026-10-30', 'used to']);
});

test('stale: by ancestry; prose changed in the same commit, or later, makes a section current', () => {
  const r = repo();
  const v = r.git('rev-parse', '--short=7', 'HEAD');
  r.put(DOC_TEXT(v));
  r.commit('the doc', [DOC]);
  assert.deepEqual(stale(r.dir), []);
  // A commit to a watched file: Alpha is stale; a test (by folder) changes nothing.
  writeFileSync(join(r.dir, 'src/a.js'), 'export function alpha(x) {}\n');
  const c1 = r.commit('alpha takes x', ['src/a.js']);
  writeFileSync(join(r.dir, 'tests/a.test.js'), '// gamma, more\n');
  r.commit('a test', ['tests/a.test.js']);
  assert.deepEqual(stale(r.dir), [{ id: 'alpha', why: `1 commit to its files since it was read (${c1})` }]);
  // The prose changed, not yet committed: current.
  r.put(r.text().replace('`alpha` does it.', '`alpha` does it, given x.'));
  assert.deepEqual(stale(r.dir), []);
  // Committed: still current (the prose is newer than the code).
  r.commit('alpha described', [DOC]);
  assert.deepEqual(stale(r.dir), []);
  // Code and prose in one commit: current.
  writeFileSync(join(r.dir, 'src/b.js'), 'export const beta = 2;\n');
  r.put(r.text().replace('`beta`,', '`beta` (two),'));
  r.commit('beta two', ['src/b.js', DOC]);
  assert.deepEqual(stale(r.dir), []);
  // A marker's change alone is not a change of prose; verify stamps HEAD.
  writeFileSync(join(r.dir, 'src/b.js'), 'export const beta = 3;\n');
  r.commit('beta three', ['src/b.js']);
  r.put(r.text().replace('tests/  budget: 150', 'tests/  budget: 160'));
  const head = r.commit('budgets', [DOC]);
  assert.deepEqual(stale(r.dir).map((s) => s.id), ['beta-and-tests']);
  const out = run(['verify', 'beta'], r.dir).text;
  assert.match(out, /^## Beta and tests\n[^]*Since \w+:\nsrc\/b\.js \| 2 \+-[^]*"beta-and-tests" verified at /);
  assert.match(r.text(), new RegExp(`files: src/b.js,tests/  budget: 160  verified: ${head}`));
  assert.deepEqual(stale(r.dir), []);
  // A verified commit that is not an ancestor of HEAD.
  r.put(r.text().replace(/verified: \w+ -->\n`alpha`/, 'verified: 0000000 -->\n`alpha`'));
  assert.deepEqual(stale(r.dir), [{ id: 'alpha', why: 'verified at an unknown commit (0000000)' }]);
});

test('affected: the sections the staged files touch', () => {
  const r = repo();
  r.put(DOC_TEXT(r.git('rev-parse', '--short=7', 'HEAD')));
  r.commit('the doc', [DOC]);
  assert.equal(run(['affected'], r.dir).text, 'no section covers the staged files');
  writeFileSync(join(r.dir, 'src/a.js'), '// changed\n');
  writeFileSync(join(r.dir, 'tests/a.test.js'), '// changed\n');
  r.git('add', 'src/a.js', 'tests/a.test.js');
  assert.equal(run(['affected'], r.dir).text, 'alpha: src/a.js\nbeta-and-tests: tests/a.test.js (covered by folder, not watched)');
  assert.throws(() => run(['verify', 'zeta'], r.dir), /no section starts 'zeta'/);
});

test('the real docs/architecture.md passes its check', () => {
  const { failures } = check(ROOT);
  assert.deepEqual(failures, []);
});
