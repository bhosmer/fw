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
  // Close to a corner where two walls meet, facing into it.
  // Close in front of the Hexahedron's lower, its pockets filling the view.
  relief: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjQ1LDAuNiwwLjk3XSwiZGlnaXRzIjpbXSwieWF3IjowLCJwaXRjaCI6MC4xNX0=',
  corner: 'eyJ3b3JsZCI6ImhhbGxzIiwiRiI6MiwiZnJhYyI6WzAuNzMyOTI0NDcxMDI0NjE1NiwwLjIyODE0MzU3NzQxNjMwOTgzLDAuNzM0NDE2NTc4OTI4MTc5Nl0sImRpZ2l0cyI6W1stMSxbNywxOCwxNl1dLFswLFsxNiwxNyw1XV0sWzEsWzE1LDYsMjFdXSxbMixbMjEsNywyXV1dLCJ5YXciOjE0Ljk2OTQyMzUwNTYxNDc1MywicGl0Y2giOjAuMDAwMTE3NTk3OTM4MDI1Njk2NzZ9',
};

// Run before the app's own code on every load: the frame loop never runs (so
// nothing moves or settles between checks), the scheme is the one asked for,
// and random numbers come out the same every time.
const setup = (scheme, live = false, world = 'halls') => `
  ${live ? '' : 'window.requestAnimationFrame = () => 0;'}
  localStorage.setItem('fw.scheme', ${JSON.stringify(scheme)});
  localStorage.setItem('fw.world', ${JSON.stringify(world)});
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
async function load(place, scheme = 'alhambra', live = false, world = 'halls') {
  // (A query that differs every time, so that each load is a whole new page:
  // a change of hash alone would not even reload it.)
  await page.goto(`${base}index.html?${++loads}${PLACES[place] ? '#' + PLACES[place] : ''}`, setup(scheme, live, world));
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

// In the arcology's skin, where the buildings' relief is (fw.check flies
// from the start and seldom gets there): at points in and around the skin
// cells, the camera put there, every level asked about; and about rays, there
// and in the plain cells' openings and the town.
check('the shader and the JavaScript agree in the arcology\'s skin', async () => {
  const { VOLUME, _V2 } = await import(join(ROOT, 'src', 'spaces', 'arcology.js'));
  const { lo, size, kind, data, words, at: cellAt } = VOLUME, { TOWN_AT, SKIN, PLAIN, WIN_AT, SOLID_BITS } = _V2.BITS;
  const groups = { skin: [], openings: [], overlaps: [], town: [] };
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const v = cellAt([x, y, z]), c = [x + lo[0], y + lo[1], z + lo[2]];
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
  const pick = (cells, n) => Array.from({ length: n }, () => cells[Math.floor(rnd() * cells.length)].map((x) => (12 + (x - 0.5 + 2 * rnd()) / 24) / 24));
  const points = pick(groups.skin, 1000);
  await load('start', 'alhambra', false, 'arcology');
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
  assert(worst.diff < 1e-3, `they differ by ${JSON.stringify(worst)}`);
  // (And about rays, where the JavaScript answers them, from the same points,
  // and from others in the plain cells' openings (mostly solid: more of them),
  // where two solids' openings meet, and in the town.)
  for (const [name, at] of [['skin', points], ['openings', pick(groups.openings, 1000)], ['overlaps', pick(groups.overlaps, 1000)], ['town', pick(groups.town, 400)]]) {
    const rays = await page.eval(`(() => {
      const sum = { ratio: 0, apart: 0, facing: 0, compared: 0, inAir: {} };
      let k = 0;
      for (const frac of ${JSON.stringify(at)}) {
        fw.pos.F = -3; fw.pos.frac = frac; fw.pos.digits = new Map();
        for (let j = 0; j < 3; j++) {
          const a = (k++ * 2.399963) % 6.283, z = ((k * 0.618034) % 1) * 2 - 1, c = Math.sqrt(1 - z * z);
          fw.compareRays(fw.pos.levels(-3, 0), [[0, 0, 0]], [c * Math.cos(a), z, c * Math.sin(a)], sum);
        }
      }
      return sum;
    })()`);
    assert(rays.ratio < 1 && rays.apart === 0 && rays.facing === 0, `${name}: about rays they differ: ${JSON.stringify(rays)}`);
    // (Rays in the relief's own air, one level finer than the city, not
    // only where all is solid.)
    assert((rays.inAir[-1] ?? 0) > 100, `${name}: only ${rays.inAir[-1] ?? 0} rays compared in the relief's air: ${JSON.stringify(rays.inAir)}`);
  }
});

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

// From up above each world too, the exact way sees nothing the older one
// does not. (In the arcology it once saw the city as a plain: the cells
// over it claimed to be solid further down than the city's air begins.)
check('from above, each world is stepped through truly', async () => {
  for (const world of WORLDS) {
    await load('start', 'alhambra', false, world);
    await page.eval('(fw.controls.pitch = -0.4, fw.fly(4, { u: 1, f: 0.5 }))');
    const { newNearer } = await page.eval('fw.compare(320, 180, 0.02)');
    assert(newNearer < 0.002, `${world}: the exact way sees nearer at ${(newNearer * 100).toFixed(2)}% of pixels`);
  }
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

// Each reference picture: a place, a scheme, and how it is drawn.
const PICTURES = [
  ['court', 'alhambra'], ['court', 'nocturne'], ['court', 'de chirico'],
  ['ground', 'alhambra'], ['ground', 'de chirico'],
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
  await page.eval(`(fw.controls.yaw += 0.7, fw.fly(1.5, { f: 1 }), fw.controls.yaw -= 1.2, fw.fly(1.5, { f: 1, r: 0.3 }))`);
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
    if (!e.known) failures++;
    console.log(`✖ ${name}${e.known ? ` (known: ${e.known})` : ''}\n  ${String(e.message).split('\n').join('\n  ')}`);
  }
}
page.close();
await chrome.close();
server.close();
if (update) console.log(`reference pictures written to ${GOLDEN}: look at them before committing`);
process.exit(failures ? 1 : 0);
