// The checks that need a GPU: the app in headless Chrome, driven through the
// hooks it leaves on window.fw. Run with
//
//   node tests/browser/run.mjs            check everything
//   node tests/browser/run.mjs --update   take new reference pictures
//   node tests/browser/run.mjs sparkle    only the checks whose names match
//
// Reference pictures are of this machine's GPU: another GPU draws slightly
// differently, so on a new machine take them afresh (and look at them); so
// too, perhaps, after an update of Chrome or of the GPU's driver.
import { launch, serve } from './chrome.mjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.FW_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'tests', 'golden');
const OUT = join(ROOT, 'tests', 'out');
const update = process.argv.includes('--update');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const WORLDS = ['halls', 'arcology'];

// Places to look from, as the app writes them into its URL.
const at = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const PLACES = {
  // In a courtyard, walls near and far, one seen at a slant.
  court: at({ F: 1, frac: [0.21925863850096122, 0.5797090086075722, 0.024052279319911128], digits: [[0, [3, 17, 3]], [1, [0, 23, 0]]], yaw: 1.5856586465201084, pitch: -0.1585233706077051 }),
  // Out on the ground, pits in it running off to the horizon.
  ground: at({ F: 0, frac: [0.08232830005124452, 0.18098790051953037, 0.6230254287625774], digits: [[-1, [21, 18, 8]], [0, [11, 18, 13]]], yaw: 7.824096801122629, pitch: 0.008087695913573402 }),
  // Wherever a first visit starts.
  start: '',
  // In a small room, looking through a doorway into a great hall on the left.
  doorway: 'eyJ3b3JsZCI6ImhhbGxzIiwiRiI6NSwiZnJhYyI6WzAuMTM4NDEyMzMxMzYzNzIzOCwwLjIxNDk5MDAyMjQwMTc0MTk4LDAuMTA2Nzk2NzA2MTM0MDM5MjRdLCJkaWdpdHMiOltbLTEsWzcsMTgsMTZdXSxbMCxbMTYsMTcsNV1dLFsxLFsxNSw2LDIxXV0sWzIsWzIwLDcsMl1dLFszLFsyMSw3LDEzXV0sWzQsWzAsMTAsMF1dLFs1LFswLDE2LDBdXV0sInlhdyI6MTMuOTYyNTg5NzIyMjkyMzM2LCJwaXRjaCI6LTAuMzM0NzMzNzg5OTMwOTczMTR9',
  // Close in front of the Hexahedron's lower, its pockets filling the view.
  relief: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjQ1LDAuNiwwLjk3XSwiZGlnaXRzIjpbXSwieWF3IjowLCJwaXRjaCI6MC4xNX0=',
  // Close to a corner where two walls meet, facing into it.
  corner: 'eyJ3b3JsZCI6ImhhbGxzIiwiRiI6MiwiZnJhYyI6WzAuNzMyOTI0NDcxMDI0NjE1NiwwLjIyODE0MzU3NzQxNjMwOTgzLDAuNzM0NDE2NTc4OTI4MTc5Nl0sImRpZ2l0cyI6W1stMSxbNywxOCwxNl1dLFswLFsxNiwxNyw1XV0sWzEsWzE1LDYsMjFdXSxbMixbMjEsNywyXV1dLCJ5YXciOjE0Ljk2OTQyMzUwNTYxNDc1MywicGl0Y2giOjAuMDAwMTE3NTk3OTM4MDI1Njk2NzZ9',
  // Out on the plaza, the whole Hexahedron ahead, its shadow on the ground.
  building: at({ world: 'arcology', F: -2, frac: [0.07422150320780334, 0.062208054127398174, 0.5984701233709889], digits: [[-2, [11, 13, 11]]], yaw: 2.2291799938059276, pitch: -0.23828340489371397 }),
  // Before the lower's face, between two pillars, the plate's edge and the
  // upper above.
  front: at({ world: 'arcology', F: -2, frac: [0.5, 0.8071139361473042, 0.41167254170923323], digits: [[-2, [12, 12, 13]]], yaw: 0, pitch: 0.05 }),
  // High over the building, looking steeply down: the town on the roof
  // band between two pillars, the plaza far below.
  town: at({ world: 'arcology', F: -2, frac: [0.5, 0.9166666666666661, 0.6875], digits: [[-2, [12, 12, 11]]], yaw: 3.14159, pitch: -0.95 }),
  // Between the roof band and the plate: the town, the plate's underside
  // over it, a stair up a pillar.
  under: at({ world: 'arcology', F: -2, frac: [0.5, 0.8300511199076943, 0.9533112166270068], digits: [], yaw: 0.9, pitch: 0 }),
  // In a hall inside the building, three levels down.
  inside: at({ world: 'arcology', F: 1, frac: [0.6157683407192641, 0.9541410982350217, 0.34963503163210796], digits: [[-2, [12, 13, 12]], [-1, [7, 0, 17]], [0, [11, 15, 4]], [1, [19, 23, 11]]], yaw: -17.965845148832386, pitch: 0.26231536310500564 }),
};

// Run before the app's own code on every load: the frame loop never runs (so
// nothing moves or settles between checks), the scheme is the one asked for,
// and random numbers come out the same every time.
const setup = (scheme, live = false, world = 'halls') => `
  ${live ? '' : 'window.requestAnimationFrame = () => 0;'}
  localStorage.setItem('fw.scheme', ${JSON.stringify(scheme)});
  localStorage.setItem('fw.world', ${JSON.stringify(world)});
  { let s = 12345; Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }`;

// In the page: the current view drawn at w x h, top row first (live: as the
// app draws it, see fw.snap).
const PAGE_HELPERS = `
  window.__snap = (w, h, live = false) => {
    const px = fw.snap(w, h, live), out = new Uint8ClampedArray(w * h * 4);
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
async function load(place, scheme = 'alhambra', live = false, world = 'halls') {
  // (A query that differs every time, so that each load is a whole new page:
  // a change of hash alone would not even reload it.)
  // (A variant goes in the link's query, as a link names one: see fromLink.)
  const variant = /[/=]/.test(world) ? world : null;
  await page.goto(`${base}index.html?${++loads}${variant ? '&' + variant : ''}${PLACES[place] ? '#' + PLACES[place] : ''}`, setup(scheme, live, variant ? 'halls' : world));
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
// A failure already known, and why: shown, but it does not fail the run.
const known = (ok, message, why) => {
  if (!ok) throw Object.assign(new Error(message), { known: why });
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

check('the shader and the JavaScript agree about each world', async () => {
  for (const world of WORLDS) {
    await load('start', 'alhambra', false, world);
    const worst = await page.eval('fw.check(300)');
    // (Never may the JavaScript say there is more air than the shader: the
    // flight would trust it.)
    assert(worst.more.diff < 1e-3, `${world}: the JavaScript says there is more air: ${JSON.stringify(worst.more)}`);
    // (And not only at the camera: the points round it were compared too.)
    assert(worst.compared > 10000, `${world}: only ${worst.compared} comparisons away from the camera`);
    assert(worst.diff < 1e-3, `${world}: they differ by ${JSON.stringify({ ...worst, more: undefined })}`);
  }
});

// And about rays, where the JavaScript answers them: how far a ray goes in a
// level's air, and the surface it meets (fw.checkRays).
check('the shader and the JavaScript agree about rays', async () => {
  for (const world of WORLDS) {
    await load('start', 'alhambra', false, world);
    const r = await page.eval('fw.checkRays(150)');
    assert(r.ratio < 1 && r.apart === 0 && r.facing === 0, `${world}: they differ: ${JSON.stringify(r)}`);
    assert(r.compared > 10000, `${world}: only ${r.compared} rays compared`);
  }
});

// Four levels finer than a town building's wall it stands close to (Basil's
// place, ledger B40), the shader's distance and rays at the wall's level are
// the JavaScript's to a small part of the camera's own cell: single
// precision keeps the point's whole part apart from the rest (see
// wholeNotApart in tests/unit/glsl.js), so that how near the wall is does not
// come out in steps.
check('four levels deep against a town wall, the shader keeps the JavaScript\'s precision', async () => {
  const hash = 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6MywiZnJhYyI6WzAuMTk1MjQ5MDYwNDU1Nzc4OSwwLjI4Mjc1MjQ5MDMzNTkyMDQsMC4yNDczNjcxMzg3MjM3MDU0XSwiZGlnaXRzIjpbWy0xLFs5LDE5LDNdXSxbMCxbMTUsMTEsN11dLFsxLFswLDE5LDE3XV0sWzIsWzAsMiwyMV1dLFszLFswLDksOF1dXSwieWF3IjotMi45NjU3NTk5OTk5OTk5ODYsInBpdGNoIjotMC4wNDA2NDAwMDAwMDAwMDUwNn0=';
  await page.goto(`${base}index.html?${++loads}#${hash}`, setup('alhambra', false, 'arcology'));
  const r = await page.eval(`(() => {
    const recs = fw.pos.levels(-1, fw.pos.F), j = recs.findIndex((q) => q.level === -1), rec = recs[j], { fwd } = fw.flight.basis();
    let seed = 5;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    // (Points round the camera, a few tenths of its cell off, and rays: the
    // way it looks and others; differences in the camera's cells, a ray's
    // less what single precision can tell where it lands: 1e-6 of its reach.)
    const points = [[0, 0, 0]];
    for (let k = 0; k < 15; k++) points.push([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map((x) => x * 0.6));
    const out = { level: rec.level, F: fw.pos.F, d: 0, reach: 0, rays: 0, inAir: 0, near: fw.flight.airAt(rec, [0, 0, 0]) };
    fw.renderer.probe(recs, points).forEach((g, k) => (out.d = Math.max(out.d, Math.abs(g[j] - fw.flight.airAt(rec, points[k])) / rec.sig)));
    for (const e of [fwd, ...Array.from({ length: 7 }, () => [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5])]) {
      const dir = e.map((x) => x / Math.hypot(...e));
      fw.renderer.probe(recs, points, dir).forEach((g, k) => {
        const ray = { dir };
        fw.flight.airAt(rec, points[k], ray);
        if (!ray.known || ray.reach < 0) return;
        out.rays++;
        out.inAir += g[j].reach >= 0;
        const diff = Math.max(0, Math.abs(g[j].reach - ray.reach) - 1e-6 * ray.reach) / rec.sig;
        if (diff > out.reach) (out.reach = diff), (out.at = ray.reach / rec.sig);
      });
    }
    return out;
  })()`);
  assert(!page.errors.length, page.errors.join('\n'));
  // (The place is still the one: the wall within a ten-thousandth of a unit of
  // level -1, the point in its air.)
  assert(r.level === -1 && r.F === 3 && r.rays > 60 && r.near < 0 && r.near > -1e-4, `the place: ${JSON.stringify(r)}`);
  assert(r.d < 2e-3 && r.reach < 2e-3 && r.inAir === r.rays, `the shader and the JavaScript differ by ${JSON.stringify(r)} (in the camera's cells)`);
});

// In the arcology's skin, where the buildings' relief is (fw.check flies
// from the start and seldom gets there): at points in and around the skin
// cells, the camera put there, every level asked about; and about rays, there
// and in the plain cells' openings and the town.
check('the shader and the JavaScript agree in the arcology\'s skin', async () => {
  await agreeInSkin('arcology', await import(join(ROOT, 'src', 'spaces', 'arcology.js')), { skin: 1000, openings: 1000, overlaps: 1000, town: 400, inAir: 100 });
});

// And so at the edges of the plate and the roof band, in the edge the
// building has and each of the other candidates (the variants
// arcology/cornice and so on: see VARIANTS in worlds.js), where they are: in
// the cells at the bands' heights.
check('the shader and the JavaScript agree at the edges, whichever edge', async () => {
  const { VARIANTS } = await import(join(ROOT, 'src', 'worlds.js')), { makeArcology } = await import(join(ROOT, 'src', 'spaces', 'arcology.js'));
  const { shape } = await import(join(ROOT, 'src', 'spaces', 'hexahedron.js'));
  for (const [name, set] of [['arcology', undefined], ...Object.entries(VARIANTS).map(([v, { set }]) => [v, set])]) {
    const made = makeArcology(set), { heights } = shape(made.def.building), y0 = made._V2.ORIGIN[1];
    const band = (y) => y - y0 >= Math.floor(heights.roofLo) - 1 && y - y0 <= Math.ceil(heights.plateHi);
    await agreeInSkin(name, made, { skin: 200, openings: 300, overlaps: 300, inAir: 20 }, band);
  }
});

// The shader and the JavaScript compared in the world named (made: its table
// and parts, as makeArcology gives them): at points in and around its skin
// cells, every level's distance, the camera put there; and rays from there,
// and from its plain cells' openings, where two solids' openings are, and its
// town (n: how many points of each, and at least how many rays of each
// group must be in the relief's air; keep: of cells at what height).
async function agreeInSkin(world, { VOLUME, _V2 }, n, keep = () => true) {
  const { lo, size, kind, data, words, at: cellAt } = VOLUME, { TOWN_AT, SKIN, PLAIN, WIN_AT, SOLID_BITS } = _V2.BITS;
  const groups = { skin: [], openings: [], overlaps: [], town: [] };
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = cellAt([x, y, z]), c = [x + lo[0], y + lo[1], z + lo[2]];
    if (!keep(c[1])) continue;
    if (kind[v] === SKIN) groups.skin.push(c);
    else if (kind[v] === PLAIN && (data[words * v] >>> TOWN_AT) & 1) groups.town.push(c);
    else if (kind[v] === PLAIN && data[words * v + 2]) groups.openings.push(c);
    // (Where two or more solids' openings are, which may overlap.)
    if (WIN_AT.filter((b) => (data[words * v + 2] >>> b) & ((1 << SOLID_BITS) - 1)).length > 1) groups.overlaps.push(c);
  }
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  // (Lattice units of level CITY + 1 from the middle city cell's corner, as
  // fractions of the cell of level CITY - 1 the building is in.)
  const pick = (name, n) => {
    const cells = groups[name];
    assert(cells.length, `${world}: no ${name} cells to look in`);
    return Array.from({ length: n }, () => cells[Math.floor(rnd() * cells.length)].map((x) => (12 + (x - 0.5 + 2 * rnd()) / 24) / 24));
  };
  const points = pick('skin', n.skin);
  await load('start', 'alhambra', false, world);
  const worst = await page.eval(`(() => {
    let worst = { diff: 0 };
    for (const frac of ${JSON.stringify(points)}) {
      fw.pos.F = -3; fw.pos.frac = frac; fw.pos.digits = new Map();
      const recs = fw.pos.levels(-3, 0), [gpu] = fw.renderer.probe(recs);
      recs.forEach((r, j) => {
        const cpu = fw.flight.airAt(r), diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
        if (diff > worst.diff) worst = { diff, level: r.level, frac, cpu, gpu: gpu[j] };
      });
    }
    return worst;
  })()`);
  assert(worst.diff < 1e-3, `${world}: they differ by ${JSON.stringify(worst)}`);
  // (And about rays, where the JavaScript answers them, from the same points,
  // and from others in the plain cells' openings (mostly solid: more of them),
  // where two solids' openings meet, and in the town.)
  for (const [name, at] of [['skin', points], ...['openings', 'overlaps', 'town'].filter((g) => n[g]).map((g) => [g, pick(g, n[g])])]) {
    const sum = await page.eval(`(() => {
      const sum = { ratio: 0, apart: 0, facing: 0, compared: 0, inAir: {} };
      let k = 0;
      for (const frac of ${JSON.stringify(at)}) {
        fw.pos.F = -3; fw.pos.frac = frac; fw.pos.digits = new Map();
        const recs = fw.pos.levels(-3, 0);
        for (let j = 0; j < 3; j++) {
          const a = (k++ * 2.399963) % 6.283, z = ((k * 0.618034) % 1) * 2 - 1, c = Math.sqrt(1 - z * z), d = [c * Math.cos(a), z, c * Math.sin(a)];
          fw.compareRays(recs, [[0, 0, 0]], d, sum);
        }
      }
      return sum;
    })()`);
    if (process.env.VERBOSE) console.log(`  ${world}, ${name}: ${at.length} points, ${sum.compared} rays compared, in air by level ${JSON.stringify(sum.inAir)}`);
    assert(sum.ratio < 1 && sum.apart === 0 && sum.facing === 0, `${world}, ${name}: about rays they differ: ${JSON.stringify(sum)}`);
    // (Rays in the relief's own air, one level finer than the city, not
    // only where all is solid.)
    assert((sum.inAir[-1] ?? 0) > n.inAir, `${world}, ${name}: only ${sum.inAir[-1] ?? 0} rays compared in the relief's air: ${JSON.stringify(sum.inAir)}`);
  }
}

// At the city's level (fw.check seldom flies there): in the plaza's air
// round the buildings, in the city's pockets in their faces, near the solids
// without relief, in the light wells, and at the top of the city's rows:
// the distances and rays of every level, the camera put there.
check('the shader and the JavaScript agree at the city\'s level', async () => {
  const { VOLUME, _V2, ROW_ID } = await import(join(ROOT, 'src', 'spaces', 'arcology.js'));
  const { levelSeed } = await import(join(ROOT, 'src', 'util.js'));
  const { lo, size, kind, at: cellAt } = VOLUME, R = 24;
  let seed = 11;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const skin = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++)
    if (kind[cellAt([x, y, z])] === 2) skin.push([x + lo[0], y + lo[1], z + lo[2]]);
  const middle = lo.map((x, a) => x + size[a] / 2), near = [..._V2.NEAR.keys()].map((k) => k.split(',').map(Number));
  const many = (n, at) => Array.from({ length: n }, at);
  // (Lattice units of the city's level over the middle city cell's corner;
  // and a direction to ask rays along, or a random one.)
  const sets = {
    plaza: many(600, () => near[Math.floor(rnd() * near.length)].map((c) => (c + rnd()) * R)).map((x) => [x, middle.map((m, i) => m - x[i])]),
    pockets: many(600, () => skin[Math.floor(rnd() * skin.length)].map((v) => v + 0.5 + (2 * rnd() - 1) * 6)).map((x) => [x, null]),
    bare: many(400, () => {
      const [l, h] = _V2.BARE_BOX[Math.floor(rnd() * _V2.BARE_BOX.length)].map((b) => b.map((x, a) => x + _V2.ORIGIN[a]));
      return [[0, 1, 2].map((a) => (a === 1 ? l[a] + rnd() * (h[a] - l[a]) : l[a] - 6 + rnd() * (h[a] - l[a] + 12))), [0, 1, 2].map((a) => (l[a] + h[a]) / 2)];
    }).map(([x, m]) => [x, m.map((v, i) => v - x[i])]),
    wells: [],
    // (Rays the pockets take that the solids without relief stop: few, found
    // among many in the JavaScript.)
    stopped: (await import(join(ROOT, 'tests', 'unit', 'clipped.js'))).clippedRays(rnd, 6000),
    sky: many(200, () => [middle[0] + (2 * rnd() - 1) * 2 * R, (2 - rnd() * 0.5) * R, middle[2] + (2 * rnd() - 1) * 2 * R]).map((x) => [x, [rnd() - 0.5, 1, rnd() - 0.5]]),
  };
  for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) {
    const w = _V2.wellOf([_V2.MID + a, ROW_ID, _V2.MID + c], levelSeed(-2));
    if (w) for (let k = 0; k < 40; k++) sets.wells.push([[(a + 0.5) * R + (2 * rnd() - 1) * (w.w - 0.5), rnd() * 4, (c + 0.5) * R + (2 * rnd() - 1) * (w.w - 0.5)], [rnd() - 0.5, k % 2 ? 1 : -1, rnd() - 0.5]]);
  }
  await load('start', 'alhambra', false, 'arcology');
  for (const [name, at] of Object.entries(sets)) {
    const r = await page.eval(`(() => {
      const sum = { ratio: 0, apart: 0, facing: 0, compared: 0, inAir: {} };
      let worst = { diff: 0 }, k = 0;
      for (const [x, e] of ${JSON.stringify(at)}) {
        fw.pos.F = -3; fw.pos.frac = x.map((v) => (12 + v / 24) / 24); fw.pos.digits = new Map();
        const recs = fw.pos.levels(-3, 0), [gpu] = fw.renderer.probe(recs);
        recs.forEach((r, j) => {
          const cpu = fw.flight.airAt(r), diff = Math.abs(cpu - gpu[j]) / Math.max(1, Math.abs(cpu));
          if (diff > worst.diff) worst = { diff, level: r.level, x, cpu, gpu: gpu[j] };
        });
        const a = (k++ * 2.399963) % 6.283, z = ((k * 0.618034) % 1) * 2 - 1, c = Math.sqrt(1 - z * z);
        for (const d of [e, [c * Math.cos(a), z, c * Math.sin(a)]]) if (d) fw.compareRays(recs, [[0, 0, 0]], d.map((u) => u / Math.hypot(...d)), sum);
      }
      return { worst, sum };
    })()`);
    assert(r.worst.diff < 1e-3, `${name}: they differ by ${JSON.stringify(r.worst)}`);
    assert(r.sum.ratio < 1 && r.sum.apart === 0 && r.sum.facing === 0, `${name}: about rays they differ: ${JSON.stringify(r.sum)}`);
    assert((r.sum.inAir[-2] ?? 0) > (name === 'stopped' ? 10 : 50), `${name}: only ${r.sum.inAir[-2] ?? 0} rays compared in the city's air: ${JSON.stringify(r.sum.inAir)}`);
  }
});

// The shader's town and the JavaScript's, both made from one catalogue
// (TOWN_TYPES, src/spaces/town.js): townShape alone, drawn for many hashes,
// every plan's lots and lots of every size, both densities and every box,
// into a texture of whole numbers, and compared. (The pictures show few
// lots; and a GLSL compiler has been seen to get such numbers wrong: ledger
// B20.)
check('the shader\'s town is the JavaScript\'s', async () => {
  const T = await import(join(ROOT, 'src', 'spaces', 'town.js')), { _V2 } = await import(join(ROOT, 'src', 'spaces', 'arcology.js'));
  const { townShape, TOWN, TOWN_PLANS } = _V2;
  const lots = TOWN_PLANS.flat();
  for (let W = 0; W <= 26; W += 2) for (let D = 0; D <= 26; D += 3) lots.push([0, 0, W + 2, D + 2]);
  let seed = 3;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const cases = [];
  for (let it = 0; it < 80; it++) {
    const h = it < 2 ? [0, 0xffffffff][it] : Math.floor(rnd() * 2 ** 32), h2 = it < 2 ? [0, 0xffffffff][it] : Math.floor(rnd() * 2 ** 32);
    for (const r of lots) for (const dens of [..._V2.TOWN_DENSITY, 100]) for (let k = 0; k < T.townShapes(_V2.townTypes); k++) cases.push([h, h2, r, dens, k]);
  }
  const fs = `#version 300 es
precision highp float; precision highp int;
const int TOWN_H = ${TOWN.H};
${T.townShapeGlsl(_V2.townTypes)}
uniform highp usampler2D uIn;
uniform int uW;
out ivec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), q = ivec2(p.x / 2 * 2, p.y);
  uvec4 a = texelFetch(uIn, q, 0), b = texelFetch(uIn, q + ivec2(1, 0), 0);
  vec3 lo, hi;
  bool ok = townShape(a.x, a.y, ivec4(b), a.z, int(a.w), lo, hi);
  o = p.x % 2 == 0 ? ivec4(ok ? 1 : 0, ivec3(lo)) : ivec4(ivec3(hi), 0);
}`;
  const W = 256, H = Math.ceil(cases.length / W), input = new Uint32Array(2 * W * H * 4);
  cases.forEach(([h, h2, r, dens, k], i) => input.set([h, h2, dens, k, ...r], 8 * i));
  await load('start', 'alhambra');
  const got = await page.eval(`(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\\nvoid main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0); }'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, ${JSON.stringify(fs)}));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const tex = (f, data) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, f, ${2 * W}, ${H}); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ${2 * W}, ${H}, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data); return t; };
    const tin = tex(gl.RGBA32UI, new Uint32Array(${JSON.stringify([...input])})), tout = tex(gl.RGBA32I);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tout, 0);
    gl.viewport(0, 0, ${2 * W}, ${H});
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, tin);
    gl.uniform1i(gl.getUniformLocation(p, 'uIn'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Int32Array(${2 * W * H * 4});
    gl.readPixels(0, 0, ${2 * W}, ${H}, gl.RGBA_INTEGER, gl.INT, out);
    return Array.from(out);
  })()`);
  let differ = 0, first = null;
  cases.forEach(([h, h2, r, dens, k], i) => {
    const g = got.slice(8 * i, 8 * i + 8), gpu = g[0] ? [g[1], g[2], g[3], g[4], g[5], g[6]] : null, js = townShape(h, h2, r, dens, k);
    if (JSON.stringify(gpu) !== JSON.stringify(js)) (differ++), (first ??= { h, h2, r, dens, k, js, gpu });
  });
  assert(differ === 0, `${differ} of ${cases.length} boxes differ, as ${JSON.stringify(first)}`);
});

// A variant, named in a link, made as the link says: the shader and the
// JavaScript agree in it too (round the camera, and about rays), and a link
// to a part of its definition there is not, or a world there is not, says so.
check('a variant in a link is made, and the shader and the JavaScript agree in it', async () => {
  for (const variant of ['arcology/cornice&town.density=[30,60,90]&halls.solid=0.5', 'halls&rooms.low.share=0.3', 'arcology&building.slopes.upper=[3,80]', 'arcology&building.bands.storey=2.5', 'halls&byLevel.0.solid=0.4&byLevel.0.walls.none.share=0.05&byLevel.1.furniture.none.share=0.05&byLevel.1.slabs.solid.share=0.3', 'arcology&halls.byLevel.-1.solid=0.8&halls.byLevel.-1.furniture.none.share=0.1&halls.byLevel.0.walls.door.share=0.4', 'halls&solid=0.4&walls.none.share=0.1&walls.door.share=0.42&slabs.solid.share=0.4&slabs.oculus.share=0.48&furniture.none.share=0.1&furniture.piers.share=0.52']) {
    await load('start', 'alhambra', false, variant);
    const shown = await page.eval(`document.querySelector('.world')?.textContent ?? ''`);
    assert(shown.startsWith(variant.split('&')[0]), `the legend says ${shown}`);
    const worst = await page.eval('fw.check(150)');
    assert(worst.diff < 1e-3 && worst.more.diff < 1e-3 && worst.compared > 5000, `${variant}: they differ by ${JSON.stringify({ ...worst, more: worst.more })}`);
    const r = await page.eval('fw.checkRays(80)');
    assert(r.ratio < 1 && r.apart === 0 && r.facing === 0 && r.compared > 3000, `${variant}: about rays they differ: ${JSON.stringify(r)}`);
  }
  // (The query names the world, though the place in the link is another's,
  // which is then no place: it starts as a first visit would.)
  await page.goto(`${base}index.html?${++loads}&arcology/cornice#${PLACES.court}`, setup('alhambra', false, 'halls'));
  const there = await page.eval(`({ world: fw.space.name, shown: document.querySelector('.world').textContent, F: fw.pos.F })`);
  assert(there.world === 'arcology' && there.shown === 'arcology/cornice' && there.F !== 1, `a query and another world's place: ${JSON.stringify(there)}`);
  // (Reloaded, a variant is the same variant, in the same place.)
  await page.eval(`(fw.fly(0.4, { f: 1 }), fw.saveLocation())`);
  const before = await page.eval(`({ href: location.href, F: fw.pos.F, frac: fw.pos.frac })`);
  // (A link changed only in its hash would not reload the page: its number is made new.)
  await page.goto(before.href.replace(/\?\d+/, `?${++loads}`), setup('alhambra', false, 'halls'));
  const after = await page.eval(`({ shown: document.querySelector('.world').textContent, F: fw.pos.F, frac: fw.pos.frac })`);
  assert(after.shown === 'arcology/cornice' && after.F === before.F && JSON.stringify(after.frac) === JSON.stringify(before.frac), `reloaded: ${JSON.stringify({ before, after })}`);
  // (The next world leaves the variant behind: the world after the
  // arcology, as it is, with no query.)
  await page.eval(`(window.__old = true, setTimeout(() => document.getElementById('world-button').click()), 0)`);
  for (let i = 0; i < 600; i++) {
    try {
      if (await page.eval(`!window.__old && !!window.fw`)) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const next = await page.eval(`({ search: location.search, world: fw.space.name, shown: document.querySelector('.world').textContent })`);
  assert(next.search === '' && next.world === 'halls' && next.shown === 'halls', `the next world: ${JSON.stringify(next)}`);
  for (const [link, said] of [['arcology&town.nope=1', /there is no town\.nope/], ['arcology/nope', /there is no world arcology\/nope/], ['arcology&town.density=[30,60', /not one/], ['arcology&vs=nope', /vs: there is no world nope/], ['arcology/cornice&vs=arcology&building.edge="cornice"', /vs: arcology is the same world/]]) {
    await page.goto(`${base}index.html?${++loads}&${link}`, setup('alhambra', false, 'halls'));
    const error = await page.eval(`document.getElementById('help').classList.contains('error') ? document.getElementById('help').textContent : ''`);
    assert(said.test(error), `${link}: the page said ${JSON.stringify(error)}`);
  }
});

// Two worlds compared (&vs=...): flipping between them changes the world
// alone. At rest, A, then B, then A again: the first and last the same to
// the byte; B as B is when its link is opened in the same state; the
// shader's and the JavaScript's agreement there as well; a flip quick (B
// drawn once already, behind the loading screen); and a link saved with B
// shown opens with B shown.
check('two worlds compared flip, and nothing else changes', async () => {
  const STATE = `window.__keep = () => ({ F: fw.pos.F, frac: fw.pos.frac.slice(), digits: [...fw.pos.digits].map(([j, d]) => [j, d.slice()]), yaw: fw.flight.yaw, pitch: fw.flight.pitch, scale: fw.flight.scale, pace: fw.flight.pace, fog: fw.flight.fog, fogTarget: fw.flight.fogTarget, room: fw.flight.room });
    window.__put = (s) => { fw.pos.F = s.F; fw.pos.frac = s.frac.slice(); fw.pos.digits = new Map(s.digits.map(([j, d]) => [j, d.slice()])); Object.assign(fw.flight, { yaw: s.yaw, pitch: s.pitch, scale: s.scale, pace: s.pace, fog: s.fog, fogTarget: s.fogTarget, room: s.room }); };
    window.__pic = (s, ref = false) => { __put(s); fw.reference = ref; const px = fw.snap(320, 240); fw.reference = false; let x = 2166136261; for (let i = 0; i < px.length; i++) x = Math.imul(x ^ px[i], 16777619) >>> 0; return x; };`;
  // (B: the city's pockets deeper, which the place looks into.)
  const A = 'arcology&vs.relief.city.depths=[0,0.25,0.75]', B = 'arcology&relief.city.depths=[0,0.25,0.75]';
  await load('relief', 'alhambra', false, A);
  await page.eval(STATE);
  const s0 = await page.eval('__keep()');
  const r = await page.eval(`(() => {
    const s0 = ${JSON.stringify(s0)}, out = { shown: [fw.shown] };
    // (A's own programs, the probe's and the older one's, made first: B's
    // must be B's.)
    __put(s0);
    out.checkA = fw.check(40).diff;
    out.refA = __pic(s0, true);
    out.a1 = __pic(s0);
    let t0 = performance.now();
    fw.flip();
    out.b = __pic(s0);
    out.ms = performance.now() - t0;
    out.shown.push(fw.shown);
    out.refB = __pic(s0, true);
    out.check = JSON.stringify((__put(s0), fw.check(40)));
    __put(s0);
    out.checkB = fw.check(300);
    fw.flip();
    out.a2 = __pic(s0);
    out.shown.push(fw.shown);
    return out;
  })()`);
  assert(r.shown.join() === 'A,B,A', `shown: ${r.shown}`);
  assert(r.a1 === r.a2, 'A after a flip there and back is not A as it was');
  assert(r.a1 !== r.b, 'A and B look the same: the place does not show what differs');
  assert(r.ms < 250, `a flip and a picture took ${r.ms} ms`);
  assert(r.checkA < 1e-3 && r.checkB.diff < 1e-3 && r.checkB.more.diff < 1e-3, `the shader and the JavaScript differ: in A ${r.checkA}, in B flipped to ${JSON.stringify(r.checkB)}`);
  await load('relief', 'alhambra', false, B);
  await page.eval(STATE);
  const direct = await page.eval(`({ b: __pic(${JSON.stringify(s0)}), ref: __pic(${JSON.stringify(s0)}, true), check: JSON.stringify((__put(${JSON.stringify(s0)}), fw.check(40))) })`);
  assert(direct.b === r.b, 'B flipped to is not B as its own link shows it');
  assert(direct.ref === r.refB, 'B flipped to, drawn the older way, is not B as its own link draws it so');
  assert(direct.check === r.check, `B flipped to and B by its own link differ in what fw.check finds: ${r.check} / ${direct.check}`);
  // (Saved with B shown, opened again: B shown.)
  await load('relief', 'alhambra', false, A);
  await page.eval('(fw.flip(), fw.saveLocation())');
  const href = await page.eval('location.href');
  await page.goto(href.replace(/\?\d+/, `?${++loads}`), setup('alhambra', false, 'halls'));
  const again = await page.eval(`({ shown: fw.shown, label: document.querySelector('.world').textContent })`);
  assert(again.shown === 'B' && again.label === 'B: arcology relief.city.depths=[0,0.25,0.75]', `opened again: ${JSON.stringify(again)}`);
  // (Running as the app runs, at rest: a flip is drawn.)
  await load('relief', 'alhambra', true, A);
  const drawn = await page.eval(`new Promise((ok) => {
    let n = 0;
    const draw = fw.renderer.draw.bind(fw.renderer);
    fw.renderer.draw = (...a) => (n++, draw(...a));
    // (Up to 20 s for the frames: until the GPU has built B's pipeline,
    // which the app starts behind its loading screen but which can take
    // longer on a busy machine, no frame comes back: ledger T13.)
    setTimeout(() => {
      const before = n, kept = fw.renderer.frame.prev !== null, t0 = performance.now();
      fw.flip();
      const prev = fw.renderer.frame.prev;
      const wait = () => (n - before >= 8 || performance.now() - t0 > 20000 ? ok([before, n, kept, prev]) : setTimeout(wait, 100));
      wait();
    }, 1500);
  })`);
  assert(drawn[1] - drawn[0] >= 8, `at rest, a flip drew ${drawn[1] - drawn[0]} frames`);
  assert(drawn[2] && drawn[3] === null, 'the history (there before the flip) was kept across it');
  // (Where the two put their defaults differently, the halls and fewer of
  // them solid: B flipped to and saved opens as B, where it was.)
  await load('start', 'alhambra', false, 'halls&vs.solid=0.3');
  await page.eval(STATE);
  const h = await page.eval(`(() => { fw.flip(); fw.fly(0.3, { f: 1 }); fw.saveLocation(); const s = __keep(); return { s, pic: __pic(s), href: location.href, sky: fw.flight.skyHeight() }; })()`);
  await page.goto(h.href.replace(/\?\d+/, `?${++loads}`), setup('alhambra', false, 'halls'));
  await page.eval(STATE);
  const h2 = await page.eval(`({ shown: fw.shown, F: fw.pos.F, frac: fw.pos.frac, pic: __pic(${JSON.stringify(h.s)}) })`);
  assert(h2.shown === 'B' && h2.F === h.s.F && JSON.stringify(h2.frac) === JSON.stringify(h.s.frac) && h2.pic === h.pic, `the halls compared, saved with B shown: ${JSON.stringify({ was: h.s.F, ...h2, pic: h2.pic === h.pic })}`);
  assert(h.sky > -1e29, 'B, flipped to, has no sky: it stands on the other\'s ground');
});

// Settings in a link (how we fly): taken, refused when there is no such
// one, and compared: the same world, flown two ways, with one program,
// V flipping the settings alone.
check('a link sets how we fly, and two ways of flying are compared', async () => {
  await page.goto(`${base}index.html?${++loads}&arcology&flight.ease=2&vs.flight.speed=0.5`, setup('alhambra', false, 'halls'));
  const r = await page.eval(`(() => {
    const out = { a: { ...fw.flight.settings }, space: fw.space, label: document.querySelector('.world').textContent, programs: fw.renderer.entries.size };
    fw.flip();
    out.b = { ...fw.flight.settings };
    out.same = fw.space === out.space;
    out.blabel = document.querySelector('.world').textContent;
    delete out.space;
    return out;
  })()`);
  assert(!page.errors.length, `errors: ${page.errors.join('\n')}`);
  assert(r.a.ease === 2 && r.a.speed === 1 && r.b.ease === 2 && r.b.speed === 0.5, `the settings: ${JSON.stringify(r)}`);
  assert(r.same && r.programs === 1, `two programs, or two worlds, for one world: ${JSON.stringify(r)}`);
  assert(r.label === 'A: arcology flight.ease=2' && r.blabel === 'B: arcology flight.ease=2 flight.speed=0.5', `labels: ${r.label} / ${r.blabel}`);
  // (On to the next world: how we fly comes along; the world's changes and
  // the one compared are left behind.)
  await page.goto(`${base}index.html?${++loads}&arcology&town.margin=0.5&flight.ease=2&vs.flight.speed=0.5`, setup('alhambra', false, 'halls'));
  await page.eval(`(window.__old = true, setTimeout(() => document.getElementById('world-button').click()), 0)`);
  for (let i = 0; i < 600; i++) {
    try {
      if (await page.eval(`!window.__old && !!window.fw`)) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const next = await page.eval(`({ search: location.search, world: fw.space.name, settings: { ...fw.flight.settings }, shown: fw.shown })`);
  assert(next.search === '?flight.ease=2' && next.world === 'halls' && next.settings.ease === 2 && next.shown === null, `the next world: ${JSON.stringify(next)}`);
  for (const [link, said] of [['arcology&flight.nope=1', /there is no flight\.nope/], ['halls&flight.speed=-1', /flight\.speed is a number more than 0/], ['arcology&vs=arcology&vs.flight.ease=1', /the same world as arcology, as the link changes them, with the same settings/]]) {
    await page.goto(`${base}index.html?${++loads}&${link}`, setup('alhambra', false, 'halls'));
    const error = await page.eval(`document.getElementById('help').classList.contains('error') ? document.getElementById('help').textContent : ''`);
    assert(said.test(error), `${link}: the page said ${JSON.stringify(error)}`);
  }
});

// How frames are drawn, by link (view.history: see VIEW in view.js): the
// first world's way, then, flipped, the other's, each handed to the renderer
// as the frame's; one program for both.
check('a link sets how frames are drawn, and V flips it', async () => {
  await page.goto(`${base}index.html?${++loads}&halls&vs.view.history=depth#${PLACES.court}`, setup('alhambra', false, 'halls'));
  const r = await page.eval(`(() => {
    fw.renderer.timed = () => [];
    let drawn = [];
    const draw = fw.renderer.draw.bind(fw.renderer);
    fw.renderer.draw = (recs, view) => (drawn.push(view.history), draw(recs, view));
    let t = 2 ** 20;
    fw.tick((t += 1000 / 60));
    const a = drawn.at(-1), programs = fw.renderer.entries.size;
    fw.flip();
    fw.tick((t += 1000 / 60));
    const b = drawn.at(-1);
    fw.flip();
    fw.tick((t += 1000 / 60));
    return { a, b, back: drawn.at(-1), programs, label: document.querySelector('.world').textContent };
  })()`);
  assert(!page.errors.length, page.errors.join('\n'));
  assert(r.a === 'range' && r.b === 'depth' && r.back === 'range' && r.programs === 1, `view.history drawn: ${JSON.stringify(r)}`);
  // (And it does something: the gathering program has it, and moving frames
  // drawn the two ways differ.)
  const moving = async (flip) => {
    await page.goto(`${base}index.html?${++loads}&halls&vs.view.history=depth#${PLACES.court}`, setup('alhambra', false, 'halls'));
    await page.eval(PAGE_HELPERS);
    return page.eval(`(() => {
      if (${flip}) fw.flip();
      fw.renderer.reset();
      fw.upscale = 0.5;
      let px;
      for (let i = 0; i < 12; i++) (fw.fly(1 / 60, { f: 1, r: 0.5 }), (px = fw.snap(160, 90, true)));
      let h = 2166136261;
      for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619) >>> 0;
      return { h, has: fw.renderer.frame.taau.u.uRange != null };
    })()`);
  };
  const [range, depth] = [await moving(false), await moving(true)];
  assert(range.has, 'the gathering program has no uRange');
  assert(depth.h !== range.h, 'moving frames drawn with view.history range and depth are the same');
  await page.goto(`${base}index.html?${++loads}&halls&view.history=fog`, setup('alhambra', false, 'halls'));
  const error = await page.eval(`document.getElementById('help').textContent`);
  assert(/view\.history is depth or range, not fog/.test(error), `view.history=fog: the page said ${JSON.stringify(error)}`);
});

// A flip at rest, drawn as the app draws (not by a snapshot, which senses
// afresh): from what the world flipped to says of each level here, the
// flight not having moved (see Flight.setSpace).
check('a flip at rest is drawn from the world flipped to', async () => {
  // (The halls, fewer of them solid in B: the levels here say other things.)
  await load('court', 'alhambra', false, 'halls&vs.solid=0.3');
  const r = await page.eval(`(async () => {
    const { SLACK } = await import('./src/shaders.js');
    fw.renderer.timed = () => [];
    let drawn = null;
    const draw = fw.renderer.draw.bind(fw.renderer);
    fw.renderer.draw = (recs, view) => ((drawn = { recs, view }), draw(recs, view));
    let t = 2 ** 20;
    for (let i = 0; i < 60; i++) fw.tick((t += 1000 / 60));
    const near = (r) => Math.max(0, (fw.flight.airAt(r) - SLACK) / r.sig);
    const was = JSON.stringify([fw.pos.F, fw.pos.frac]);
    const before = new Map(fw.flight.airs.map(({ rec, air }) => [rec.level, air]));
    fw.flip();
    drawn = null;
    fw.tick((t += 1000 / 60));
    if (!drawn) return { drawn: false };
    return {
      drawn: true, shown: fw.shown, still: JSON.stringify([fw.pos.F, fw.pos.frac]) === was,
      own: drawn.recs.every((r) => r.near === near(r)) && fw.flight.airs.every(({ rec, air }) => air === fw.flight.airAt(rec)),
      differ: fw.flight.airs.filter(({ rec, air }) => air !== before.get(rec.level)).length,
    };
  })()`);
  assert(r.drawn && r.shown === 'B' && r.still, `a flip at rest: ${JSON.stringify(r)}`);
  assert(r.own, 'a flip at rest is drawn with levels as the world flipped from has them');
  assert(r.differ > 0, 'the two worlds say the same of every level here: the check proves nothing');
});

// Every program sets, as it draws, every uniform it has (as the program
// itself says: see finish in gl.js), samplers aside (set once, when it is
// made): drawn as the app draws, the older way, and probed, in each world.
// (The tour's look is drawn by the view's program.)
check('every program sets every uniform it has', async () => {
  for (const world of WORLDS) {
    await load('start', 'alhambra', false, world);
    const unset = await page.eval(`(() => {
      const gl = fw.renderer.gl, set = new Map();
      let using = null;
      const use = gl.useProgram.bind(gl);
      gl.useProgram = (p) => ((using = p), use(p));
      for (const k of Object.keys(WebGL2RenderingContext.prototype).filter((k) => /^uniform/.test(k))) {
        const f = gl[k].bind(gl);
        gl[k] = (loc, ...a) => (set.has(using) || set.set(using, new Set()), set.get(using).add(loc), f(loc, ...a));
      }
      fw.renderer.reset();
      fw.upscale = 0.5;
      fw.fly(1 / 60, { f: 1 });
      fw.snap(320, 180, true);
      fw.upscale = 1;
      fw.snap(320, 180, true);
      fw.reference = true;
      fw.snap(320, 180);
      fw.reference = false;
      fw.check(2);
      fw.checkRays(2);
      const e = fw.renderer.entry, f = fw.renderer.frame;
      const out = [];
      for (let err = gl.getError(); err; err = gl.getError()) out.push('a GL error, ' + err);
      for (const [name, p] of [['view', e.viewProg], ['older', e.refProg], ['probe', e.probeProg], ['smoothing', f.smooth], ['upscaling', f.taau]]) {
        const done = set.get(p.prog) ?? new Set();
        for (const [u, loc] of Object.entries(p.u)) if (!(u in p.units) && !done.has(loc)) out.push(name + ': ' + u);
      }
      return out;
    })()`);
    assert(!unset.length, `${world}: uniforms never set, or GL errors: ${unset.join(', ')}`);
  }
});

// From up above each world too, the exact way sees nothing the older one
// does not. (In the arcology it once saw the city as a plain: the cells
// over it claimed to be solid further down than the city's air begins.)
check('from above, each world is stepped through truly', async () => {
  for (const world of WORLDS) {
    // (Flown as flight first went, in proportion to the way open (curve 1)
    // and nothing else (rise and reach 0), so that 4 s up and on is where
    // this has always looked from.)
    await load('start', 'alhambra', false, `${world}&flight.curve=1&flight.rise=0&flight.reach=0`);
    await page.eval('(fw.flight.pitch = -0.4, fw.fly(4, { u: 1, f: 0.5 }))');
    const { newNearer } = await page.eval('fw.compare(320, 180, 0.02)');
    assert(newNearer < 0.002, `${world}: the exact way sees nearer at ${(newNearer * 100).toFixed(2)}% of pixels`);
  }
  // (Just under the sky's plane at the city's edge, where the plaza fades,
  // the two disagree (ledger B33); where it does not, as now, they do not.)
  await page.goto(`${base}index.html?${++loads}#eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjAyMzQzNzUsMC44NjQ1NzkwMDk5MzY4ODA1LDAuNjA4MjQwMjI0NTY0MjM2M10sImRpZ2l0cyI6W1stMixbMTIsMTIsMTFdXV0sInlhdyI6MCwicGl0Y2giOi0wLjR9`, setup('alhambra', false, 'arcology'));
  const { newNearer } = await page.eval('fw.compare(320, 180, 0.02)');
  assert(newNearer < 0.002, `under the sky's plane at the city's edge, the exact way sees nearer at ${(newNearer * 100).toFixed(2)}% of pixels`);
});

// The older way (sphere tracing) stops once within half a pixel of a
// surface, so it lands a little short everywhere and catches the near side of
// every edge: the two never agree exactly. What would be wrong is the exact
// way seeing something nearer than the older one does (a surface that is not
// there, by more than a fiftieth of the distance), or their disagreeing much
// more than they do now (by more than a tenth of the distance, as fractions
// of the picture).
// Per place: at most how many pixels the exact way may see nearer, and at
// most how many may disagree. (The relief: sphere tracing grazes the
// arcology's long faces badly, there as elsewhere in it, and runs out of
// steps in its pockets, short of the rooms the exact way sees in them:
// there the exact way sees further, never nearer.)
// (The start: a first visit, now a court open to the sky, its walls' long
// top edges against it.)
const STEPPING = { court: [0.002, 0.07], ground: [0.002, 0.06], start: [0.002, 0.02], relief: [0.015, 0.12] };
check('the two ways of stepping rays agree', async () => {
  for (const [place, [nearer, most]] of Object.entries(STEPPING)) {
    await load(place);
    const { newNearer } = await page.eval('fw.compare(320, 180, 0.02)');
    assert(newNearer < nearer, `${place}: the exact way sees nearer at ${(newNearer * 100).toFixed(2)}% of pixels`);
    const { off } = await page.eval('fw.compare(320, 180, 0.1)');
    assert(off < most, `${place}: ${(off * 100).toFixed(2)}% of pixels disagree (at most ${most * 100}% expected)`);
  }
});

// Each reference picture: a place, and a scheme. (The halls: the court, the
// ground, the start; then the arcology.)
const PICTURES = [
  ['court', 'alhambra'], ['court', 'nocturne'], ['court', 'de chirico'],
  ['ground', 'alhambra'], ['ground', 'de chirico'],
  ['start', 'alhambra'], ['start', 'de chirico'],
  ['building', 'alhambra'], ['building', 'de chirico'], ['front', 'alhambra'], ['relief', 'alhambra'],
  ['town', 'alhambra'], ['under', 'alhambra'], ['inside', 'alhambra'], ['inside', 'nocturne'],
];
// (Their size.)
const SHOT = [320, 180];
check('views look as they did', async () => {
  const failed = [];
  for (const [place, scheme] of PICTURES) {
    await load(place, scheme);
    const png = await page.eval(`__png(__snap(${SHOT}), ${SHOT})`);
    failed.push(await asBefore(`${place}-${scheme.replace(/\W+/g, '-')}`, png));
  }
  assert(!failed.some(Boolean), failed.filter(Boolean).join('\n') + `\n(the new pictures and their differences are in ${OUT})`);
});

// And as the app draws them (the pictures above are each one frame alone):
// antialiased over the frames before, while moving forward (drawn at half
// the pixels each way, gathered into the full picture, for half a second:
// long enough for the history to hold as much as it keeps moving, see
// TAA_KEEP in frame.js), then come to rest (all of them, until it has
// every sample: see TAA_N).
// (Nothing here depends on the time: the same frames each run.)
const LIVE = [['court', 'alhambra'], ['front', 'alhambra']];
check('views look as they did, as the app draws them moving and at rest', async () => {
  const failed = [];
  for (const [place, scheme] of LIVE) {
    await load(place, scheme);
    const [moving, still] = await page.eval(`(() => {
      const shown = () => __png(__snap(${SHOT}, true), ${SHOT});
      fw.renderer.reset();
      fw.upscale = 0.5;
      for (let i = 0; i < 29; i++) (fw.fly(1 / 60, { f: 1 }), fw.snap(${SHOT}, true));
      fw.fly(1 / 60, { f: 1 });
      const moving = shown();
      fw.upscale = 1;
      for (let i = 0; i < 15; i++) fw.snap(${SHOT}, true);
      return [moving, shown()];
    })()`);
    const name = `live-${place}-${scheme.replace(/\W+/g, '-')}`;
    failed.push(await asBefore(name + '-moving', moving), await asBefore(name + '-still', still));
  }
  assert(!failed.some(Boolean), failed.filter(Boolean).join('\n') + `\n(the new pictures and their differences are in ${OUT})`);
});

// A picture (png, of SHOT's size) against its reference, name: what
// differs, or nothing. (Taken afresh, with --update, or where there is none.)
async function asBefore(name, png) {
  const file = join(GOLDEN, name + '.png');
  if (update || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, Buffer.from(png, 'base64'));
    return null;
  }
  const golden = readFileSync(file).toString('base64');
  // Small differences everywhere would be rounding (another GPU, another
  // browser: on this machine the same picture is drawn to the byte); what
  // counts is how much of the picture has changed visibly. (A town a little
  // sparser changes a few tenths of a percent of a picture of it.)
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
    return { mean: sum / n, big: big / n, diff: __png(diff, ${SHOT}) };
  })()`);
  if (process.env.VERBOSE) console.log(`  ${name}: mean ${d.mean?.toFixed(4)}, ${((d.big ?? 0) * 100).toFixed(3)}% changed visibly`);
  if (!(d.size || d.mean > 0.1 || d.big > 0.0005)) return null;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(png, 'base64'));
  if (d.diff) writeFileSync(join(OUT, name + '-diff.png'), Buffer.from(d.diff, 'base64'));
  return d.size ? `${name}: size changed` : `${name}: mean ${d.mean.toFixed(2)}, ${(d.big * 100).toFixed(2)}% changed visibly`;
}

// Detail too small to show cleanly flickers as we move: count the pixels that
// flash brighter or darker than both the frame before and the frame after,
// flying slowly forward over the ground.
check('distant detail does not sparkle', async () => {
  await load('ground', 'de chirico');
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
  // (Measured in de chirico, 39 on 2026-10-28; in the old sunlit scheme it
  // was 92 before detail went by its size as seen, 55 after, held under 75.)
  assert(perFrame < 50, `${perFrame.toFixed(0)} pixels flicker per frame (39 when this was set)`);
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

// The tour dives some levels, then comes back up some, through rooms it
// did not pass on the way down: out somewhere else (see planner.js).
check('the tour dives, and comes up somewhere else', async () => {
  await load('start');
  const r = await page.eval(`(async () => {
    const p = fw.pilot;
    p.start(fw.pos.F);
    const down = new Set(), levels = [];
    let last = null, fresh = 0, again = 0;
    await fw.tour(360, () => {
      if (!p.last || p.last === last) return;
      last = p.last;
      levels.push(+last.split(':')[0]);
      if (p.phase === 'dive') down.add(last);
      else down.has(last) ? again++ : fresh++;
    });
    const start = levels[0], deepest = Math.max(...levels), at = levels.indexOf(deepest);
    return { start, deepest, after: Math.min(...levels.slice(at)), fresh, again };
  })()`);
  assert(r.deepest >= r.start + 3, `it dived from level ${r.start} only to ${r.deepest}`);
  // (How it comes up again changes with how the flight looks ahead, which
  // it steers by; and since the halls became denser, partly the way it went
  // down: the tour is to be redesigned, ledger F13.)
  const redesign = 'how the tour comes up is to be redesigned (ledger F13)';
  known(r.after <= r.deepest - 2, `from level ${r.deepest}, it came up only to ${r.after}`, redesign);
  known(r.fresh > 2 * r.again, `coming up, ${r.again} of the rooms it came into it had passed going down, and ${r.fresh} it had not`, redesign);
});

// Boxed into a corner, the tour finds somewhere to go.
check('the tour gets out of a corner', async () => {
  await load('corner');
  const found = await page.eval(`(async () => {
    const p = fw.pilot;
    p.start(fw.pos.F);
    p.phase = 'surface';
    let at = null;
    await fw.tour(10, (t) => { if (at === null && p.target && p.kind !== 'aside') at = t; });
    return at;
  })()`);
  assert(found !== null, 'it found nowhere to go in ten seconds');
});

// A great hall seen through a doorway from a small room is seen as far into
// as from inside it, not lost in the small room's haze.
check('a great hall is seen through a doorway', async () => {
  await load('doorway');
  const spread = await page.eval(`(() => { const w = 160, h = 100, p = __snap(w, h); let lo = 765, hi = 0;
    for (let y = 0; y < 0.3 * h; y++) for (let x = 0; x < 0.4 * w; x++) { const i = (y * w + x) * 4, v = p[i] + p[i + 1] + p[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo; })()`);
  assert(spread > 120, `the upper left of the view is nearly flat (spread ${spread}): lost in the haze`);
});

check('rewinding retraces the way we came', async () => {
  await load('court');
  const where = () => page.eval('JSON.stringify({ F: fw.pos.F, frac: fw.pos.frac, d: [...fw.pos.digits].sort() })');
  const before = JSON.parse(await where());
  await page.eval(`(fw.flight.yaw += 0.7, fw.fly(1.5, { f: 1 }), fw.flight.yaw -= 1.2, fw.fly(1.5, { f: 1, r: 0.3 }))`);
  const away = JSON.parse(await where());
  assert(JSON.stringify(away) !== JSON.stringify(before), 'flying went nowhere');
  await page.eval('fw.rewind(3)');
  const back = JSON.parse(await where());
  assert(back.F === before.F, `came back at level ${back.F}, not ${before.F}`);
  for (let a = 0; a < 3; a++) assert(Math.abs(back.frac[a] - before.frac[a]) < 1e-6, `came back at ${back.frac}, not ${before.frac}`);
});

check('N goes somewhere new, with room to stand', async () => {
  await load('court');
  const was = await page.eval('fw.where');
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }))`);
  const now = await page.eval('fw.where');
  const clear = await page.eval('fw.state.clearance');
  assert(now !== was && clear >= 0.08, `still at ${was === now ? 'the same place' : now}, clearance ${clear}`);
});

check('a place survives a reload', async () => {
  await load('court');
  await page.eval(`(fw.flight.yaw += 0.3, fw.fly(0.7, { f: 1 }))`);
  const url = await page.eval('fw.where');
  const here = await page.eval('JSON.stringify([fw.pos.F, fw.pos.frac, fw.flight.yaw, fw.flight.pitch])');
  await page.goto(url.replace(/\?\d*#/, `?${++loads}#`), setup('alhambra'));
  const there = await page.eval('JSON.stringify([fw.pos.F, fw.pos.frac, fw.flight.yaw, fw.flight.pitch])');
  assert(here === there, `${here} became ${there}`);
});

// A link whose place cannot be read (see place.js) starts where a first
// visit would, draws, and says why for a moment; one changed to such a place
// leaves us where we are. One without a facing faces the most open way, as a
// first visit does.
check('a link whose place cannot be read still opens somewhere', async () => {
  const state = 'JSON.stringify([fw.pos.F, fw.pos.frac, fw.flight.yaw, fw.flight.pitch])';
  await load('start');
  const first = await page.eval(state);
  const court = JSON.parse(Buffer.from(PLACES.court, 'base64').toString());
  for (const [name, broken] of [['no level', { ...court, F: undefined }], ['no offset', { ...court, frac: undefined }], ['a digit too fine', { ...court, digits: [[3, [0, 0, 0]]] }], ['a yaw that is text', { ...court, yaw: 'east' }]]) {
    await page.goto(`${base}index.html?${++loads}#${at(broken)}`, setup('alhambra'));
    await page.eval(PAGE_HELPERS);
    const got = await page.eval(`({ error: document.getElementById('help').classList.contains('error'), at: ${state}, spread: (() => { const p = __snap(160, 90); let lo = 765, hi = 0;
      for (let i = 0; i < p.length; i += 4) { const v = p[i] + p[i + 1] + p[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; })() })`);
    assert(!got.error && !page.errors.length, `${name}: the page failed: ${page.errors.join('\n')}`);
    assert(got.at === first, `${name}: opened at ${got.at}, not where a first visit does (${first})`);
    assert(got.spread > 60, `${name}: the picture is nearly flat (spread ${got.spread})`);
  }
  // (Running as the app runs: the legend says why, for a moment; for a link
  // that can be read, it says nothing of the kind.)
  const said = async (hash) => {
    await page.goto(`${base}index.html?${++loads}${hash ? '#' + hash : ''}`, setup('alhambra', true));
    let text = '';
    for (const until = Date.now() + 20000; !text.includes('fps') && Date.now() < until; await new Promise((r) => setTimeout(r, 100))) text = await page.eval(`document.getElementById('hud').textContent`);
    return text;
  };
  const broken = await said(at({ ...court, F: undefined }));
  assert(broken.includes("the link's place: its level is not a whole number") && !page.errors.length, `a link that cannot be read: the legend says ${JSON.stringify(broken)}`);
  const fine = await said(PLACES.court);
  assert(fine.includes('fps') && !fine.includes("the link's place"), `a link that can be read: the legend says ${JSON.stringify(fine)}`);
  // (Changed to a link that cannot be read: nothing moves, and the link is
  // put back to where we are.)
  await load('court');
  const was = await page.eval(state);
  const link = await page.eval('(fw.saveLocation(), location.hash)');
  await page.eval(`location.hash = ${JSON.stringify(at({ ...court, F: undefined }))}`);
  await new Promise((r) => setTimeout(r, 100));
  assert((await page.eval(state)) === was, 'a hash changed to a place that cannot be read moved us');
  assert((await page.eval('location.hash')) === link && !page.errors.length, `a hash changed to a place that cannot be read was left in the link, or failed: ${page.errors.join('\n')}`);
  // (No facing: the place, faced the most open way along the walls.)
  await page.goto(`${base}index.html?${++loads}#${at({ ...court, yaw: undefined, pitch: undefined })}`, setup('alhambra'));
  const [F, frac, yaw, pitch] = JSON.parse(await page.eval(state));
  assert(!page.errors.length, `no facing: the page failed: ${page.errors.join('\n')}`);
  assert(F === court.F && JSON.stringify(frac) === JSON.stringify(court.frac), `no facing: at ${F} ${frac}`);
  assert(pitch === 0 && [0, 1, 2, 3].some((k) => yaw === (k * Math.PI) / 2), `no facing: faced ${yaw}, ${pitch}`);
});

// A link changed only in its digits (where we are, far up) is another place,
// and is drawn, though nothing else in the view's key changes (view.js).
check('a link changed only in its digits is drawn', async () => {
  await load('court');
  const r = await page.eval(`(async () => {
    fw.renderer.timed = () => [];
    let n = 0;
    const draw = fw.renderer.draw.bind(fw.renderer);
    fw.renderer.draw = (...a) => (n++, draw(...a));
    let t = 2 ** 20; // (a fixed clock, so that every run flies the same: see drawlog.mjs)
    const ticks = (k) => { const n0 = n; for (let i = 0; i < k; i++) fw.tick((t += 1000 / 60)); return n - n0; };
    ticks(60);
    const atRest = ticks(5);
    const state = () => JSON.stringify([fw.pos.F, fw.pos.frac, fw.flight.yaw, fw.flight.pitch, fw.flight.scale.toPrecision(3), fw.flight.fog.toPrecision(3)]);
    const was = state();
    const at = JSON.parse(atob(${JSON.stringify(PLACES.court)}));
    const d = fw.space.ancestorDigit(-8).slice();
    d[0] = d[0] > 0 ? d[0] - 1 : d[0] + 1;
    location.hash = btoa(JSON.stringify({ ...at, digits: [...at.digits, [-8, d]] }));
    await new Promise((ok) => setTimeout(ok, 100));
    return { atRest, same: state() === was, drawn: ticks(1), digit: fw.pos.digit(-8).join() === d.join() };
  })()`);
  assert(r.atRest === 0 && r.same && r.digit, `not a change of digits alone, at rest: ${JSON.stringify(r)}`);
  assert(r.drawn === 1, `a link changed only in its digits drew ${r.drawn} frames`);
});

// N at rest goes somewhere new, and it is drawn there every time, though a
// first visit is often at the same level, offset and facing as the last
// (only its digits differ: see viewKey in view.js).
check('N at rest is drawn somewhere new every time', async () => {
  await load('start');
  const drew = await page.eval(`(() => {
    fw.renderer.timed = () => [];
    let n = 0;
    const draw = fw.renderer.draw.bind(fw.renderer);
    fw.renderer.draw = (...a) => (n++, draw(...a));
    let t = 2 ** 20; // (a fixed clock, so that every run flies the same: see drawlog.mjs)
    const ticks = (k) => { const n0 = n; for (let i = 0; i < k; i++) fw.tick((t += 1000 / 60)); return n - n0; };
    ticks(60);
    const drew = [];
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyN' }));
      drew.push(ticks(20));
    }
    return drew;
  })()`);
  assert(drew.every((n) => n > 0), `of 40 presses of N at rest, ${drew.filter((n) => !n).length} drew nothing: ${drew}`);
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
    if (!e.known) failures++;
    console.log(`✖ ${name}${e.known ? ` (known: ${e.known})` : ''}\n  ${String(e.message).split('\n').join('\n  ')}`);
  }
}
page.close();
await chrome.close();
server.close();
if (update) console.log(`reference pictures written to ${GOLDEN}: look at them before committing`);
process.exit(failures ? 1 : 0);
