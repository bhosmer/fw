// GPU milliseconds per frame in a handful of named views, this tree against
// another (by default main at 91b9aa4), in headless Chrome
// at one pixel per CSS pixel (1280 x 720). Runs are interleaved, the two trees
// taking turns at each view, and each view's time is the least of its rounds.
//
//   node bench/bench.mjs                    against 91b9aa4
//   node bench/bench.mjs --base <rev|dir>   against another revision, or a tree on disk
//   node bench/bench.mjs --rounds 7 start   more rounds; only views whose names match
//
// The GPU is shared: while anyone is looking at the app, the numbers mean
// little. Views are hashes as the app writes them into its URL (see VIEWS).
import { launch, serve } from '../tests/browser/chrome.mjs';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const rounds = +opt('--rounds', 5);
const baseArg = opt('--base', '91b9aa4');
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

// The views: proposed, for Basil to confirm (brief E4). Each is a world and a
// place; the arcology's are fixed positions, so that both trees are measured
// from the same place whatever stands there. (The world is kept as the one
// last visited, for a tree from before the arcology was the only one.)
import { VIEWS } from './views.mjs';

function tree(rev) {
  if (existsSync(rev)) return resolve(rev);
  const dir = mkdtempSync(join(tmpdir(), 'fw-bench-'));
  execSync(`git -C ${JSON.stringify(ROOT)} archive ${rev} | tar -x -C ${JSON.stringify(dir)}`);
  return dir;
}

const trees = [{ name: 'this', root: ROOT }, { name: baseArg, root: tree(baseArg) }];
for (const t of trees) t.server = await serve(t.root);
const chrome = await launch();
const page = await chrome.page();
let loads = 0;
async function measure(t, view) {
  const setup = `window.requestAnimationFrame = () => 0;
    localStorage.setItem('fw.scheme', 'alhambra'); localStorage.setItem('fw.world', ${JSON.stringify(view.world)});`;
  await page.goto(`${t.server.url}index.html?${++loads}${view.hash ? '#' + view.hash : ''}`, setup);
  const err = await page.eval(`document.getElementById('help').classList.contains('error') ? document.getElementById('help').textContent : null`);
  if (err) throw new Error(`${t.name}: the page failed to start:\n${err}`);
  await page.eval('fw.bench(4)'); // compile and warm
  return page.eval('fw.bench(24)');
}
const views = Object.entries(VIEWS).filter(([n]) => !only.length || only.some((o) => n.includes(o)));
const best = Object.fromEntries(views.map(([n]) => [n, trees.map(() => Infinity)]));
for (let r = 0; r < rounds; r++)
  for (const [name, view] of views) {
    const order = r % 2 ? [1, 0] : [0, 1];
    for (const i of order) best[name][i] = Math.min(best[name][i], await measure(trees[i], view));
  }
console.log(`view          this (ms)  ${trees[1].name} (ms)  ratio   (least of ${rounds} interleaved rounds)`);
for (const [name] of views) {
  const [a, b] = best[name];
  console.log(`${name.padEnd(13)} ${a.toFixed(2).padStart(9)}  ${b.toFixed(2).padStart(9)}  ${(a / b).toFixed(3)}`);
}
page.close();
await chrome.close();
for (const t of trees) t.server.close();
process.exit(0);
