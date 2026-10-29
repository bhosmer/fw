// Have the GPU build a link's shaders before it is opened: node bench/warm.mjs
// [--check] link ... (a link: a world's name, or what follows index.html in a
// link: ?variant&changes#place). FW_ROOT picks the tree (default this one).
//
// macOS keeps the compiled Metal pipelines for every program, wherever it was
// built (see cold.mjs): so a headless browser drawing a link once builds what
// a browser opening it later finds ready, and the first frame there comes
// quickly. (Many large variants push one another out of that cache: warm
// only what will be opened soon.) --check opens each again, in a browser of
// its own, and says how long its first frame took.
import { launch, serve } from '../tests/browser/chrome.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.FW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), check = args.includes('--check');
const links = args.filter((a) => a !== '--check');
if (!links.length) throw new Error('warm: which links? (a world\'s name, or ?variant&changes#place)');

// The first frame of a link, in a browser of its own: how long it took.
async function first(server, link) {
  const chrome = await launch(), page = await chrome.page();
  const world = /^[a-z]+$/.test(link) ? link : null;
  await page.goto(`${server.url}index.html${world ? '' : link}`, `window.requestAnimationFrame = () => 0;${world ? ` localStorage.setItem('fw.world', ${JSON.stringify(world)});` : ''}`);
  const ms = await page.eval(`(() => { const t0 = performance.now(); fw.snap(800, 733, true); return Math.round(performance.now() - t0); })()`);
  const errors = page.errors.slice(0, 2);
  page.close();
  await chrome.close();
  if (errors.length) throw new Error(`warm: ${link}: ${errors.join('; ')}`);
  return ms;
}

const server = await serve(ROOT);
for (const link of links) {
  const ms = await first(server, link);
  console.log(`${link}: drawn once, the first frame ${ms} ms${check ? `; opened again, ${await first(server, link)} ms` : ''}`);
}
server.close();
process.exit(0);
