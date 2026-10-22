// Pictures of views, for picking and checking them: node bench/shoot.mjs OUTDIR world hash-or-'' [js to run first] ...
// Each extra argument is JavaScript run in the page before the picture (e.g. a fw.fly(...)); prints fw.where's hash.
import { launch, serve } from '../tests/browser/chrome.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = process.env.FW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, world, hash, ...steps] = process.argv.slice(2);
const server = await serve(ROOT), chrome = await launch(), page = await chrome.page();
await page.goto(`${server.url}index.html?1${hash ? '#' + hash : ''}`, `window.requestAnimationFrame = () => 0;
  localStorage.setItem('fw.scheme', 'alhambra'); localStorage.setItem('fw.world', ${JSON.stringify(world)});`);
const err = await page.eval(`document.getElementById('help').classList.contains('error') ? document.getElementById('help').textContent : null`);
if (err) { console.log('ERROR', err); process.exit(1); }
if (page.errors.length) console.log('errors', page.errors);
let k = 0;
for (const s of ['', ...steps]) {
  if (s) console.log('>', JSON.stringify(await page.eval(s)));
  const png = await page.eval(`(() => { const w = ${+(process.env.W ?? 640)}, h = ${+(process.env.H ?? 360)}, px = fw.snap(w, h), o = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) o.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(o, w, h), 0, 0);
    return c.toDataURL().split(',')[1]; })()`);
  writeFileSync(join(out, `shot${k}.png`), Buffer.from(png, 'base64'));
  console.log(`shot${k}`, (await page.eval('fw.where')).split('#')[1] ?? '', JSON.stringify(await page.eval('({F: fw.state.F, sky: fw.state.sky, clear: fw.state.clearance})')));
  k++;
}
page.close(); await chrome.close(); server.close(); process.exit(0);
