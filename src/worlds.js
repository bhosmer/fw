// The world there is to visit, the arcology, made when first asked for (it
// takes most of a second), and named variants of it: the world and changes
// to its definition (see makeArcology, and define in util.js). The app and
// the tests take them from here; a link may name one (see fromLink).
//
// A world is a space: a description of ONE cell, in lattice units where the
// cell spans 0..R and one unit is a child cell, which the engine stacks at
// every scale. What a space provides:
//
//   name           the world's name
//   R              children per cell edge
//   glsl           float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level,
//                             out float reach, out vec3 nrm)
//                  signed distance to the cell's air (negative inside air) at
//                  the point L + f. It may understate a distance but must
//                  never overstate one, on either side of the surface.
//                  When gRay is set it also answers for a ray: if the point
//                  is in air, reach is how far the ray goes before leaving
//                  the piece of air it is in (and nrm the surface there);
//                  otherwise reach is negative (see pieces.js). The id of
//                  the cell's parent is in gUp.
//   cellAir        the same in JavaScript, given (L, f, id, seed, dg, level,
//                  up, ray), up the parent's id; the ray ({ dir }, or none)
//                  told how far it goes, and whether the cell says (known)
//   volume         a table the space looks things up in rather
//                  than work them out: { size, data, words }, data a
//                  Uint32Array of `words` numbers (2 or 4) for each of
//                  size[0] * size[1] * size[2] cells, x fastest; in the
//                  shader, the usampler3D uVolume
//   tables         more tables, 2D: [{ name, size, data }] (or none), data
//                  an Int32Array of four numbers for each of size[0] *
//                  size[1], x fastest; in the shader, the isampler2D of that
//                  name (declared for it)
//   openAreaGlsl   float openAreaAt(int level, ivec3 id, ivec3 up, vec3 n):
//                  what fraction of a surface opens at a level, where it is
//                  (see the detail asked after in main, shaders.js), and
//                  whether it is in the surface's own shade (gOwnInk)
//   openArea       roughly what fraction of a surface is openings
//   maxInterior    largest clearance any point in a cell's air can have, as a
//                  fraction of the cell
//   longestWay     the longest way through any one convex piece of a cell's
//                  air, in cells
//   close          how far (fraction of the cell) air is shrunk to fade a level
//                  out with distance
//   openAir        optionally, the one level some of whose air is open at
//                  every distance: its features have no bound, where
//                  maxInterior and longestWay bound every other level's.
//                  The shader does not leave it out for being small or far
//                  itself (a coarser level's bound may still end a step's
//                  asking before it, as for any level); the space fades the
//                  rest of it its own way (see gScale in shaders.js), and
//                  when that is gone leaves only the open air and what
//                  stands in it, as grown as it grows
//   slants         optionally, the whole-number normals of planes, other than
//                  the axes and the diagonals, that the cell is cut by,
//                  carried exactly across levels (see Position.levels)
//   slanted        optionally, slanted(level): whether the slants cut that
//                  level's cells (if not given, every level's)
//   nearOnly       optionally, the levels whose surfaces hold only near the
//                  level we work at: not all on planes carried exactly
//                  across levels (see slants), so that far finer than the
//                  level itself they are not where they are. Coarser than
//                  the levels looked at as a rule, such a level is not drawn
//                  (see visible in view.js); where it is the room we are in,
//                  one plane stands in for it (see outerAir)
//   ancestorDigit  where a cell sits inside its parent when nothing says
//                  otherwise (must be somewhere solid in the parent)
//   start          where in its level-0 cell a visit starts (see elsewhere in
//                  arrival.js)
//   skyPlane       the world has a top: above one horizontal plane there is
//                  only open sky. This says where: skyPlane(j), the plane's
//                  height as a digit at each level j <= 0 (in the cells of
//                  level j), to be compared with ours digit by digit; where
//                  our digits are the default ones, those of the levels
//                  coarser than any we have been elsewhere at must cancel
//   skyClear       optionally, how far under the plane, in level-0 cells, it
//                  is open air everywhere
//   sunReach       optionally, how far under the plane, in level-0 cells,
//                  there can be open air the sun shines into
//   palette, sky, zenith, roof, fogK
//                  its look: each level's colours (palette(level): { wall,
//                  floor }), the haze, the sky's colour overhead, the colour
//                  of the sky's plane seen from above where nothing under it
//                  is drawn, and how far we see in the
//                  room we are in, in its cells
//   room, openings, halfWall
//                  for finding ways (see planner.js): a cell's room, if it
//                  has one, and the openings in its faces (each given the
//                  cell's id, seed and level), and the rooms' walls' half
//                  thickness
//   planned        at which levels the tour may plan its ways (planned(level))
//   entrances      the ways into the rooms from air that is no room: { level,
//                  list } (see Planner.waysFromCity)
import { HEXAHEDRON } from './spaces/hexahedron.js';
import { FLIGHT, flightSettings } from './flight.js';
import { VIEW, viewSettings } from './view.js';
import { byPaths, merge, define, frozen } from './util.js';

// (With the changes set, or as it is. The first is the world a link that
// names none opens.)
const BASES = {
  arcology: async (set) => {
    const m = await import('./spaces/arcology.js');
    return set ? m.makeArcology(set).arcology : m.default;
  },
};
export const WORLDS = Object.keys(BASES);

// The arcology with each of the other edges its bands were given the night
// they were chosen (2026-10-26: see EDGES in hexahedron.js).
export const VARIANTS = Object.fromEntries(
  Object.keys(HEXAHEDRON.edges)
    .filter((e) => e !== HEXAHEDRON.edge)
    .map((e) => [`arcology/${e}`, { base: 'arcology', set: { building: { edge: e } } }]),
);

// A world, or a variant, by name, with changes of its own on top (as
// define takes them): its space, and what it was made from.
export async function makeWorld(name, changes) {
  const v = Object.hasOwn(VARIANTS, name) ? VARIANTS[name] : Object.hasOwn(BASES, name) ? { base: name } : null;
  if (!v) throw new Error(`there is no world ${name} (there are ${[...WORLDS, ...Object.keys(VARIANTS)].join(', ')})`);
  const set = merge(v.set, changes);
  return { space: await BASES[v.base](set), name, base: v.base, set };
}

// What a link's query names: ?variant&part.of.it=value&... (each value as
// JSON: town.density=[10,30,60]; or a word alone, as text:
// view.history=depth): the name of the world it opens (the one it names,
// or else the first of WORLDS), and the changes, as define takes them.
// Passed over: a number alone (as makes a link new), and what is added to
// links as they are passed on (utm_..., and the like). Settings, how we fly
// through it and how its frames are drawn (flight.ease=2: see FLIGHT in
// flight.js; view.history=depth: see VIEW in view.js), are apart from the
// world's changes (settings): they are the same for every world. (So no
// world has a part of that name: the tests see to it.)
// And a second world to compare it with, vs: ...&vs=name (by default the
// first), with the same changes and settings and any of its own on top
// (vs.part.of.it=value); it must differ from the first, if only in its
// settings.
export const ADDED = /^(utm_\w+|fbclid|gclid|msclkid|mc_\w+|ref)$/;
export const SETTINGS = frozen({ flight: FLIGHT, view: VIEW });
// Whether a link's path (part.of.it, or vs.part.of.it) is of a setting.
const isSetting = (path) => Object.hasOwn(SETTINGS, path.replace(/^vs\./, '').split('.')[0]);
// Settings, from a link's (as fromLink gives them), checked and whole.
export function makeSettings(set) {
  const s = define(SETTINGS, set);
  return s === SETTINGS ? s : { ...s, flight: flightSettings(s.flight), view: viewSettings(s.view) };
}
export function fromLink(search) {
  const parts = search.replace(/^\?/, '').split('&').filter(Boolean).map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      throw new Error(`${x}: not a part of a link (a % without its two digits?)`);
    }
  });
  const names = parts.filter((x) => !x.includes('=') && !/^\d+$/.test(x));
  if (names.length > 1) throw new Error(`a link names one world, not ${names.join(' and ')}`);
  const changes = new Map(), theirs = new Map(), settings = new Map(), theirSettings = new Map();
  let vs = null;
  for (const x of parts.filter((x) => x.includes('='))) {
    const i = x.indexOf('='), path = x.slice(0, i), text = x.slice(i + 1);
    if (ADDED.test(path)) continue;
    if (path === 'vs') {
      if (vs !== null) throw new Error('vs is set twice');
      vs = text;
      continue;
    }
    const theirsToo = path.startsWith('vs.'), p = theirsToo ? path.slice(3) : path;
    const into = isSetting(p) ? (theirsToo ? theirSettings : settings) : theirsToo ? theirs : changes;
    if (into.has(p)) throw new Error(`${path} is set twice`);
    try {
      into.set(p, /^[A-Za-z][\w-]*$/.test(text) && !['true', 'false', 'null'].includes(text) ? text : JSON.parse(text));
    } catch {
      throw new Error(`${path}=${text}: the value is not one (a number, true or false, a word, "text", or [a, list])`);
    }
  }
  const set = (m) => (m.size ? byPaths(Object.fromEntries(m)) : undefined);
  const name = names[0] ?? WORLDS[0], mine = set(changes), mySettings = set(settings);
  if (vs === null && !theirs.size && !theirSettings.size) return { name, changes: mine, settings: mySettings, vs: null };
  // (Compared with the world the link opens, unless it names another.)
  if (vs === name && !theirs.size && !theirSettings.size) throw new Error(`vs=${vs}: the same as the world it is to be compared with`);
  return { name, changes: mine, settings: mySettings, vs: { name: vs ?? name, changes: merge(mine, set(theirs)), settings: merge(mySettings, set(theirSettings)) } };
}
