// The checks that need a GPU: the app in headless Chrome, driven through the
// hooks it leaves on window.fw. Run with
//
//   node tests/browser/run.mjs            check everything
//   node tests/browser/run.mjs --update   take new reference pictures
//   node tests/browser/run.mjs sparkle    only the checks whose names match
//
// Reference pictures are of this machine's GPU: another GPU draws slightly
// differently, so on a new machine take them afresh (and look at them).
import { launch, serve } from './chrome.mjs';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.FW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'tests', 'golden');
const OUT = join(ROOT, 'tests', 'out');
const update = process.argv.includes('--update');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Places to look from, as the app writes them into its URL.
const at = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const PLACES = {
  // In a courtyard, walls near and far, one seen at a slant.
  court: at({ F: 1, frac: [0.21925863850096122, 0.5797090086075722, 0.024052279319911128], digits: [[0, [3, 17, 3]], [1, [0, 23, 0]]], yaw: 1.5856586465201084, pitch: -0.1585233706077051 }),
  // Out on the ground, pits in it running off to the horizon.
  ground: at({ F: 0, frac: [0.08232830005124452, 0.18098790051953037, 0.6230254287625774], digits: [[-1, [21, 18, 8]], [0, [11, 18, 13]]], yaw: 7.824096801122629, pitch: 0.008087695913573402 }),
  // Wherever a first visit starts.
  start: '',
};

// Run before the app's own code on every load: the frame loop never runs (so
// nothing moves or settles between checks), the scheme is the one asked for,
// and random numbers come out the same every time.
const setup = (scheme, live = false) => `
  ${live ? '' : 'window.requestAnimationFrame = () => 0;'}
  localStorage.setItem('fw.scheme', ${JSON.stringify(scheme)});
  { let s = 12345; Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }`;

// In the page: the current view drawn at w x h, top row first.
const PAGE_HELPERS = `
  window.__snap = (w, h) => {
    const px = fw.snap(w, h), out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  };
  window.__png = (px, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    return c.toDataURL().split(',')[1];
  };
  window.__decode = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  };`;

let page, base, loads = 0;
async function load(place, scheme = 'alhambra', live = false) {
  // (A query that differs every time, so that each load is a whole new page:
  // a change of hash alone would not even reload it.)
  await page.goto(`${base}index.html?${++loads}${PLACES[place] ? '#' + PLACES[place] : ''}`, setup(scheme, live));
  await page.eval(PAGE_HELPERS);
  const error = await page.eval(`document.getElementById('help').classList.contains('error') ? document.getElementById('help').textContent : null`);
  if (error) throw new Error('the page failed to start:\n' + error);
  if (page.errors.length) throw new Error('errors on loading:\n' + page.errors.join('\n'));
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

check('every scheme compiles and draws something', async () => {
  const names = await (async () => {
    await load('start');
    return page.eval(`import('./src/schemes.js').then((m) => m.SCHEMES.map((s) => s.name))`);
  })();
  for (const scheme of names) {
    await load('court', scheme);
    const spread = await page.eval(`(() => { const p = __snap(160, 90); let lo = 255, hi = 0;
      for (let i = 0; i < p.length; i += 4) { const v = p[i] + p[i + 1] + p[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return hi - lo; })()`);
    assert(spread > 60, `${scheme}: the picture is nearly flat (spread ${spread})`);
  }
});

check('the shader and the JavaScript agree about the world', async () => {
  await load('start');
  const worst = await page.eval('fw.check(300)');
  assert(worst.diff < 1e-3, `they differ by ${JSON.stringify(worst)}`);
});

// The older way (sphere tracing) stops once within half a pixel of a
// surface, so it lands a little short everywhere and catches the near side of
// every edge: the two never agree exactly. What would be wrong is the exact
// way seeing something nearer than the older one does (a surface that is not
// there, by more than a fiftieth of the distance), or their disagreeing much
// more than they do now (by more than a tenth of the distance, as fractions
// of the picture).
const STEPPING = { court: 0.07, ground: 0.06, start: 0.01 };
check('the two ways of stepping rays agree', async () => {
  for (const [place, most] of Object.entries(STEPPING)) {
    await load(place);
    const { newNearer } = await page.eval('fw.compare(320, 180, 0.02)');
    assert(newNearer < 0.002, `${place}: the exact way sees nearer at ${(newNearer * 100).toFixed(2)}% of pixels`);
    const { off } = await page.eval('fw.compare(320, 180, 0.1)');
    assert(off < most, `${place}: ${(off * 100).toFixed(2)}% of pixels disagree (at most ${most * 100}% expected)`);
  }
});

// Each reference picture: a place, a scheme, and how it is drawn.
const PICTURES = [
  ['court', 'alhambra'], ['court', 'nocturne'], ['court', 'sunlit'],
  ['ground', 'alhambra'], ['ground', 'sunlit'],
  ['start', 'alhambra'], ['start', 'de chirico'],
];
check('views look as they did', async () => {
  const W = 320, H = 180;
  const failed = [];
  for (const [place, scheme] of PICTURES) {
    const name = `${place}-${scheme.replace(/\W+/g, '-')}`;
    const file = join(GOLDEN, name + '.png');
    await load(place, scheme);
    const png = await page.eval(`__png(__snap(${W}, ${H}), ${W}, ${H})`);
    if (update || !existsSync(file)) {
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(file, Buffer.from(png, 'base64'));
      continue;
    }
    const golden = (await import('node:fs')).readFileSync(file).toString('base64');
    // Small differences everywhere are rounding; what counts is how much of
    // the picture has changed visibly.
    const d = await page.eval(`(async () => {
      const a = await __decode(${JSON.stringify(png)}), b = await __decode(${JSON.stringify(golden)});
      if (a.length !== b.length) return { size: true };
      const diff = new Uint8ClampedArray(a.length);
      let sum = 0, big = 0;
      for (let i = 0; i < a.length; i += 4) {
        const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        sum += m;
        if (m > 32) big++;
        diff[i] = diff[i + 1] = diff[i + 2] = Math.min(255, m * 4);
        diff[i + 3] = 255;
      }
      const n = a.length / 4;
      return { mean: sum / n, big: big / n, diff: __png(diff, ${W}, ${H}) };
    })()`);
    if (process.env.VERBOSE) console.log(`  ${name}: mean ${d.mean?.toFixed(4)}, ${((d.big ?? 0) * 100).toFixed(3)}% changed visibly`);
    if (d.size || d.mean > 1.5 || d.big > 0.005) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, name + '.png'), Buffer.from(png, 'base64'));
      if (d.diff) writeFileSync(join(OUT, name + '-diff.png'), Buffer.from(d.diff, 'base64'));
      failed.push(d.size ? `${name}: size changed` : `${name}: mean ${d.mean.toFixed(2)}, ${(d.big * 100).toFixed(2)}% changed visibly`);
    }
  }
  assert(!failed.length, failed.join('\n') + `\n(the new pictures and their differences are in ${OUT})`);
});

// Detail too small to show cleanly flickers as we move: count the pixels that
// flash brighter or darker than both the frame before and the frame after,
// flying slowly forward over the ground.
check('distant detail does not sparkle', async () => {
  await load('ground', 'sunlit');
  const perFrame = await page.eval(`(() => {
    const W = 960, H = 540, N = 16, frames = [];
    for (let k = 0; k < N; k++) {
      const p = __snap(W, H), L = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) L[i] = 0.3 * p[i * 4] + 0.59 * p[i * 4 + 1] + 0.11 * p[i * 4 + 2];
      frames.push(L);
      fw.fly(1 / 60, { f: 1 });
    }
    let n = 0;
    for (let k = 1; k < N - 1; k++) for (let i = 0; i < W * H; i++) {
      const a = frames[k - 1][i], b = frames[k][i], c = frames[k + 1][i];
      if ((b - a > 40 && b - c > 40) || (a - b > 40 && c - b > 40)) n++;
    }
    return n / (N - 2);
  })()`);
  assert(perFrame < 75, `${perFrame.toFixed(0)} pixels flicker per frame (it was 92 before detail went by its size as seen, 55 after)`);
});

check('the tour keeps to the air', async () => {
  await load('start');
  const log = await page.eval('fw.tour(40)');
  const bad = log.find((e) => !(e.clear > 0) || !Number.isFinite(e.F));
  assert(!bad, `at ${JSON.stringify(bad)}`);
  // (And it goes somewhere: through more than one level, making for places.)
  const levels = new Set(log.map((e) => e.F));
  const aimed = log.filter((e) => e.aim).length;
  assert(log.length === 160 && levels.size >= 2 && aimed >= 20, `the tour looked ${log.length} times, at ${levels.size} levels, aiming ${aimed} times`);
});

// Diving, the tour goes into openings it can see near its way, rather than
// on at a wall until one opens right in front of it (which passes through
// many levels in no time, and shows little of any).
check('diving, the tour takes openings near its way', async () => {
  let surface = 0, nearOpening = 0, looks = 0;
  for (const place of ['court', 'start']) {
    await load(place);
    const r = await page.eval(`(async () => {
      const p = fw.pilot;
      p.start(fw.pos.F);
      p.choose(fw.pos.F);
      p.choose(fw.pos.F); // (diving, held to)
      p.diagnose = true;
      let looks = 0, surface = 0, near = 0;
      await fw.tour(60, () => {
        looks++;
        if (p.kind === 'surface') (surface++, p.saw?.holeNear >= 1.3 && near++);
      });
      return { looks, surface, near };
    })()`);
    looks += r.looks;
    surface += r.surface;
    nearOpening += r.near;
  }
  // (Before it did, a third of its looks at a wall had an opening near.)
  assert(nearOpening <= 0.05 * surface + 3, `of ${surface} looks heading at a surface, ${nearOpening} had an opening near`);
  assert(surface < 0.3 * looks, `${surface} of ${looks} looks were heading at a surface`);
});

check('rewinding retraces the way we came', async () => {
  await load('court');
  const where = () => page.eval('JSON.stringify({ F: fw.pos.F, frac: fw.pos.frac, d: [...fw.pos.digits].sort() })');
  const before = JSON.parse(await where());
  await page.eval(`(fw.controls.yaw += 0.7, fw.fly(1.5, { f: 1 }), fw.controls.yaw -= 1.2, fw.fly(1.5, { f: 1, r: 0.3 }))`);
  const away = JSON.parse(await where());
  assert(JSON.stringify(away) !== JSON.stringify(before), 'flying went nowhere');
  await page.eval('fw.rewind(3)');
  const back = JSON.parse(await where());
  assert(back.F === before.F, `came back at level ${back.F}, not ${before.F}`);
  for (let a = 0; a < 3; a++) assert(Math.abs(back.frac[a] - before.frac[a]) < 1e-6, `came back at ${back.frac}, not ${before.frac}`);
});

check('a place survives a reload', async () => {
  await load('court');
  await page.eval(`(fw.controls.yaw += 0.3, fw.fly(0.7, { f: 1 }))`);
  const url = await page.eval('fw.where');
  const here = await page.eval('JSON.stringify([fw.pos.F, fw.pos.frac, fw.controls.yaw, fw.controls.pitch])');
  await page.goto(url.replace(/\?\d*#/, `?${++loads}#`), setup('alhambra'));
  const there = await page.eval('JSON.stringify([fw.pos.F, fw.pos.frac, fw.controls.yaw, fw.controls.pitch])');
  assert(here === there, `${here} became ${there}`);
});

check('reading back what the tour sees raises no warnings', async () => {
  const warnings = [];
  const on = (m) => {
    if (m.method === 'Log.entryAdded' && m.params.entry.source === 'rendering') warnings.push(m.params.entry.text);
  };
  page.events.push(on);
  await page.send('Log.enable');
  try {
    await load('start', 'alhambra', true);
    await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))`);
    await new Promise((r) => setTimeout(r, 2500));
    const tour = await page.eval('fw.pilot.on');
    assert(tour, 'the tour did not start');
  } finally {
    page.events.splice(page.events.indexOf(on), 1);
    await page.send('Log.disable');
  }
  assert(!warnings.length, warnings.join('\n'));
});

const server = await serve(ROOT);
base = server.url;
const chrome = await launch();
page = await chrome.page();
let failures = 0;
for (const { name, fn } of checks) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  const t = Date.now();
  try {
    await fn();
    console.log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failures++;
    console.log(`✖ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`);
  }
}
page.close();
await chrome.close();
server.close();
if (update) console.log(`reference pictures written to ${GOLDEN}: look at them before committing`);
process.exit(failures ? 1 : 0);
