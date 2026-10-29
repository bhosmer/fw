// How long a first visit waits for the view shader to be built from nothing:
// node bench/cold.mjs [world ...] (default halls and arcology). FW_ROOT picks
// the tree (default this one); RUNS how many times each (default 1).
//
// The browser's own shader caches go with its profile, a new one each run;
// but macOS keeps the compiled Metal pipelines too, for every program
// anywhere, keyed by their source after translation, where an unused
// constant is gone. So each run works from a copy of the tree whose view
// shader carries a number of its own that it uses, and is new everywhere.
import { launch, serve } from '../tests/browser/chrome.mjs';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.FW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const worlds = process.argv.slice(2).length ? process.argv.slice(2) : ['halls', 'arcology'];
const MAIN = 'void main() {\n  vec2 uv = ';

for (const world of worlds) {
  for (let run = 0; run < +(process.env.RUNS ?? 1); run++) {
    const dir = mkdtempSync(join(tmpdir(), 'fw-cold-'));
    cpSync(join(ROOT, 'index.html'), join(dir, 'index.html'));
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    const file = join(dir, 'src', 'shaders.js');
    const src = readFileSync(file, 'utf8');
    if (src.split(MAIN).length !== 2) throw new Error('cold: the view shader main() is not where it was expected');
    const nonce = 1000 + Math.floor(Math.random() * 1e9);
    writeFileSync(file, src.replace(MAIN, `void main() {\n  if (uN == ${nonce}) discard;\n  vec2 uv = `));
    const server = await serve(dir), chrome = await launch(), page = await chrome.page();
    await page.goto(`${server.url}index.html?1`, `window.requestAnimationFrame = () => 0; localStorage.setItem('fw.world', ${JSON.stringify(world)});`);
    // (The page is there once its programs are linked; the GPU's pipelines
    // are built at the first draw: both, from when the page was asked for.)
    const r = await page.eval(`(() => { const ms = []; let since = 0; for (let i = 0; i < 2; i++) { const t0 = performance.now(); fw.snap(800, 733, true); ms.push(Math.round(performance.now() - t0)); since ||= Math.round(performance.now()); } return [...ms, since]; })()`);
    console.log(`${world}: first frame ${r[0]} ms (then ${r[1]} ms); from asking for the page to the first frame ${r[2]} ms`);
    page.close();
    await chrome.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(0);
