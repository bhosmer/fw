// The world as drawn, faded with distance (.claude/design/test-oracles.md,
// C4): what each level says of a ray, faded as the march would fade it, holds
// (see fadedRayHolds): at places on the plaza and inside, every level round
// them; at the city's level in the plaza's air, in its pockets and by the
// solids without relief; and one level finer, in the openings and the town.
// (In a process of their own: asked in one with others, faded asks slowed
// those after them.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from '../../src/worlds.js';
import arcology, { makeArcology, ARCOLOGY, CITY, ROWS, G, VOLUME, _V2 } from '../../src/spaces/arcology.js';
import { M } from '../../src/spaces/halls.js';
import { airAt } from '../../src/air.js';
import { Flight } from '../../src/flight.js';
import { rand } from './rand.js';
import { places } from './places.js';
import { fadedRayHolds } from './rays.js';
import { FADE_GRID, fadeAt } from './fade.js';
import { clippedRays } from './clipped.js';

const R = arcology.R, P = R * R;
const s = Math.SQRT1_2;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [-s, 0, s], [s, 0, -s], [-s, 0, -s], [0, s, s], [s, -s, 0], [2, 0, 1], [1, 0, -2]];
const unit = (e) => e.map((x) => x / Math.hypot(...e));

// Places on the plaza and inside, as the worlds' tests have them: every
// level round them, at the fades of FADE_GRID; finer than the relief's
// levels (the halls), fading all alike.
const MADE = await Promise.all([makeWorld('arcology'), makeWorld('arcology', { plaza: { fades: true } })]);
for (const { space, set } of MADE) {
  test(`${space.name}${set ? '&plaza.fades=true' : ''}: what a level says of a faded ray holds`, () => {
    for (const within of [false, true]) {
      const rnd = rand(19);
      let rays = 0, inAir = 0;
      for (const flight of places(space, 7, 8, within)) {
        const c = Math.max(flight.clearance, 1e-3);
        for (const r of flight.here) for (let k = 0; k < 12; k++) {
          const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...d), v = d.map((x) => (x / l) * c * 2 * rnd());
          const said = fadedRayHolds(flight, r, v, unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), fadeAt(r, space, FADE_GRID[Math.floor(rnd() * FADE_GRID.length)]), { uniform: r.level > CITY + 1 });
          rays += said.known;
          inAir += said.inAir;
        }
      }
      assert.ok(rays > 2000 && inAir > 120, `${within ? 'inside' : 'first visits'}: ${rays} rays, ${inAir} in air: the test reaches what it means to`);
    }
  });
}

// At the city's level (x: lattice units of it over the middle city cell's
// corner), along e, at the fade g of FADE_GRID: whether in air.
const cityAsk = (flight, space) => (x, e, g) => {
  Object.assign(flight.pos, { F: CITY - 1, frac: x.map((v) => (12 + v / R) / R), digits: new Map() });
  flight.sense();
  const r = flight.pos.levels(CITY, Math.max(CITY, flight.pos.F)).find((q) => q.level === CITY);
  return fadedRayHolds(flight, r, [0, 0, 0], unit(e), fadeAt(r, space, FADE_GRID[g % FADE_GRID.length]), { at: `city point ${x}` }).inAir;
};

// In the plaza's air round the buildings, toward them and every way, and up
// into the sky, where the plaza fades and where it does not (its air then
// unshrunk, its solids grown as the level fades). Among the plaza's solids
// (ledger B52): a slanted solid's planes can be nearer than its bounds, and
// grown, reach the point; and a ray is held back by a solid grown, wherever
// the plaza is. Every ray is asked before the failures are told, so that none
// hides another.
for (const fades of [true, false]) {
  test(`what the city says of a faded ray holds, where the plaza ${fades ? 'fades' : 'does not fade'}`, () => {
    const { arcology: space } = fades === ARCOLOGY.plaza.fades ? { arcology } : makeArcology({ plaza: { fades } });
    const rnd = rand(29), { lo, size } = VOLUME, middle = lo.map((x, a) => x + size[a] / 2);
    const ask = cityAsk(new Flight(space), space), failed = [];
    let plaza = 0, sky = 0, g = 0;
    const tried = (x, e) => {
      try {
        return ask(x, e, g++);
      } catch (err) {
        if (!(err instanceof assert.AssertionError)) throw err;
        failed.push(err.message);
        return 0;
      }
    };
    for (const key of _V2.NEAR.keys()) {
      const [a, b, c] = key.split(',').map(Number);
      for (let k = 0; k < 20; k++) {
        const x = [(a + rnd()) * R, (b + rnd()) * R, (c + rnd()) * R];
        plaza += tried(x, k % 2 ? [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] : middle.map((m, i) => m - x[i]));
      }
    }
    for (let k = 0; k < 200; k++) sky += tried([middle[0] + (2 * rnd() - 1) * 2 * R, (ROWS - rnd() * 0.5) * R, middle[2] + (2 * rnd() - 1) * 2 * R], [rnd() - 0.5, 1, rnd() - 0.5]);
    assert.ok(plaza > 300 && sky > 100, `rays in air: plaza ${plaza}, sky ${sky}: the test reaches what it means to`);
    assert.equal(failed.length, 0, `${failed.length} faded rays fail in the plaza's air; the first: ${failed[0]}`);
  });
}

// Where the plaza fades, its pieces of air shrink as the level fades and
// the solids standing in them grow, a slanted solid's corners faster than
// the air shrinks: so a solid reaches into pieces that its bounds miss
// (ledger B52). From each city cell round each solid, rays toward the point
// of the solid, grown by a whole fade, deepest in the cell's piece (a cell
// past its sides across, M past its row up and down (the bottom row's from
// the floor, G), shrunk as much: see
// plaza in arcology.js), found on a grid from the solid's own planes
// (SOLID_PI, from the building's origin, one level finer), at a fade all
// but whole there: none goes past that point while it is inside the solid
// as grown where the ray meets it. (Where the plaza does not fade, its
// pieces hold those; the rays held there too.)
for (const [{ space }, fades] of [[MADE[0], false], [MADE[1], true]]) {
  test(`a ray stops at a solid grown into its piece of the plaza's air, where the plaza ${fades ? 'fades' : 'does not fade'}`, () => {
    const whole = space.close * R, rnd = rand(5), flight = new Flight(space);
    assert.ok(_V2.GROW < 3.5, `GROW ${_V2.GROW}: the search below keeps within 3.5 whole fades of the bounds`);
    // (How far outside solid s, grown by g, x is (lattice units over the
    // middle city cell's corner): the most of its planes'.)
    const outside = (s, x, g) => Math.max(..._V2.SOLID_PI[s].map((p) => (p[0] * (x[0] - _V2.ORIGIN[0]) + p[1] * (x[1] - _V2.ORIGIN[1]) + p[2] * (x[2] - _V2.ORIGIN[2]) - p[3] / R) / Math.hypot(p[0], p[1], p[2]))) - g;
    let targets = 0, inAir = 0;
    _V2.BOUNDS.forEach(([lo, hi], s) => {
      for (let a = Math.floor(lo[0] / R) - 2; a <= Math.floor(hi[0] / R) + 2; a++)
        for (let b = 0; b < ROWS; b++)
          for (let c = Math.floor(lo[2] / R) - 2; c <= Math.floor(hi[2] / R) + 2; c++) {
            // (The piece shrunk, and within the bounds grown as far as any
            // solid's can be: GROW is under 3.5.)
            const plo = [a * R - R, b === 0 ? G : b * R - M, c * R - R].map((x, q) => Math.max(x + whole, lo[q] - 3.5 * whole));
            const phi = [a * R + 2 * R, b * R + R + M, c * R + 2 * R].map((x, q) => Math.min(x - whole, hi[q] + 3.5 * whole));
            if (!plo.every((x, q) => x < phi[q])) continue;
            let deepest = 0, at = null;
            for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) for (let k = 0; k <= 16; k++) {
              const x = [i, j, k].map((n, q) => plo[q] + ((phi[q] - plo[q]) * n) / 16), o = outside(s, x, whole);
              if (o < deepest) (deepest = o), (at = x);
            }
            if (!at) continue;
            targets++;
            for (let k = 0; k < 16; k++) {
              const x = [(a + rnd()) * R, (b + rnd()) * R, (c + rnd()) * R], t = Math.hypot(...at.map((v, q) => v - x[q]));
              Object.assign(flight.pos, { F: CITY - 1, frac: x.map((v) => (12 + v / R) / R), digits: new Map() });
              flight.sense();
              const r = flight.pos.levels(CITY, Math.max(CITY, flight.pos.F)).find((q) => q.level === CITY);
              // (Faded nine tenths of the way, and wholly at the end of a
              // span reaching the point, but not twice as far.)
              let fade = null;
              for (let pix = 0.064; pix >= 1e-4; pix /= 2) if ((fade = fadeAt(r, space, { rel: 0.9, slant: 1, pix })).span >= t) break;
              if (t > fade.span || !(outside(s, at, fade.o + fade.a * t) < 0)) continue;
              const ray = { dir: unit(at.map((v, q) => v - x[q])) };
              airAt(space, r, [0, 0, 0], ray, fade);
              if (!(ray.reach >= 0)) continue;
              inAir++;
              assert.ok(ray.reach <= t + 1e-9, `solid ${s} grown in cell ${[a, b, c]}'s piece: a ray from ${x} goes ${ray.reach}, past it at ${t} (inside it by ${-outside(s, at, fade.o + fade.a * t)})`);
            }
          }
    });
    assert.ok(targets > 200 && inAir > 1000, `${targets} points, ${inAir} rays in air: the test reaches what it means to`);
  });
}

// In the city's pockets round the buildings' skin (every way, and toward the
// middle), by the solids without relief (toward them), and along the rays
// the pockets take that those solids stop (see clippedRays).
test("what the city's pockets say of a faded ray holds, by the solids without relief too", () => {
  const rnd = rand(29), { lo, size, kind, at: cellAt } = VOLUME, middle = lo.map((x, a) => x + size[a] / 2);
  const ask = cityAsk(new Flight(arcology), arcology), count = { pockets: 0, bare: 0, clipped: 0 };
  let g = 0;
  const skin = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) if (kind[cellAt([x, y, z])] === 2) skin.push([x + lo[0], y + lo[1], z + lo[2]]);
  for (let k = 0; k < 1500; k++) {
    const x = skin[Math.floor(rnd() * skin.length)].map((v) => v + 0.5 + (2 * rnd() - 1) * 6);
    count.pockets += ask(x, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], g++) + ask(x, middle.map((m, i) => (i === 1 ? 0 : m - x[i])), g++);
  }
  for (const [blo, bhi] of _V2.BARE_BOX) {
    const [l, h] = [blo, bhi].map((b) => b.map((x, a) => x + _V2.ORIGIN[a]));
    for (let k = 0; k < 150; k++) {
      const x = [0, 1, 2].map((a) => (a === 1 ? l[a] + rnd() * (h[a] - l[a]) : l[a] - 6 + rnd() * (h[a] - l[a] + 12)));
      count.bare += ask(x, [0, 1, 2].map((a) => (l[a] + h[a]) / 2 + (2 * rnd() - 1) - x[a]), g++);
    }
  }
  for (const [x, e] of clippedRays(rnd, 6000)) count.clipped += ask(x, e, g++);
  assert.ok(count.pockets > 200 && count.bare > 100 && count.clipped >= 5, `rays in air: ${JSON.stringify(count)}: the test reaches what it means to`);
});

// One level finer than the city, in the buildings' openings and the town:
// from points in each skin or plain cell with openings or town of the city's
// own cell, along the axes and diagonals; more where two or more solids'
// openings are, and in the town. (Fewer than the unfaded test asks: each
// faded ray is asked at 31 points more.)
test('what the openings and the town say of a faded ray holds', () => {
  const { TOWN_AT, SKIN, PLAIN, WIN_AT, SOLID_BITS } = _V2.BITS;
  const rnd = rand(19), flight = new Flight(arcology);
  const mine = () => flight.pos.levels(CITY + 1, Math.max(CITY + 1, flight.pos.F)).find((q) => q.level === CITY + 1);
  const at = (x, y, z, frac) => (Object.assign(flight.pos, { F: CITY + 1, frac, digits: new Map([[CITY + 1, [x, y, z]]]) }), mine());
  let cells = 0, inAir = 0, townAir = 0, g = 0;
  for (let x = 0; x < R; x++) for (let y = 0; y < R; y++) for (let z = 0; z < R; z++) {
    const r0 = at(x, y, z, [0.5, 0.5, 0.5]);
    const [m, , wins] = _V2.relief(r0.id.map((q) => ((q % P) + P) % P), r0.pid);
    const kind = m & 3, town = kind === PLAIN && (m >>> TOWN_AT) & 1;
    if (!(kind === SKIN || kind === PLAIN) || !(wins || town)) continue;
    cells++;
    const shared = WIN_AT.filter((b) => (wins >>> b) & ((1 << SOLID_BITS) - 1)).length > 1;
    for (let k = 0; k < (shared || town ? 8 : 1); k++) {
      at(x, y, z, [rnd(), rnd(), rnd()]);
      flight.sense();
      const r = mine();
      for (const e of k ? [DIRS[k % DIRS.length]] : DIRS.filter((_, i) => i % 3 === cells % 3)) {
        const said = fadedRayHolds(flight, r, [0, 0, 0], unit(e), fadeAt(r, arcology, FADE_GRID[g++ % FADE_GRID.length]), { at: `cell ${[x, y, z]}` });
        inAir += said.inAir;
        if (town) townAir += said.inAir;
      }
    }
  }
  assert.ok(cells > 1000 && inAir > 500 && townAir > 100, `${cells} cells, ${inAir} rays in air (${townAir} in the town): the test reaches what it means to`);
});
