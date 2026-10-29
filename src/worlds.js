// The worlds there are to visit, each made when first asked for (the
// arcology takes most of a second), and named variants of them: a world and
// changes to its definition (see makeArcology and makeHalls, and define in
// util.js). The app and the tests take them from here; a link names one
// (see fromLink).
import { HEXAHEDRON } from './spaces/hexahedron.js';
import { byPaths, merge } from './util.js';

// (Each with the changes set, or as it is.)
const BASES = {
  halls: async (set) => {
    const m = await import('./spaces/halls.js');
    return set ? m.makeHalls(set).space : m.default;
  },
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
// JSON: town.density=[10,30,60]): its world's name (or none), and the
// changes, as define takes them. Passed over: a number alone (as makes a
// link new), and what is added to links as they are passed on (utm_..., and
// the like). A link with changes names its world (the parts differ).
export const ADDED = /^(utm_\w+|fbclid|gclid|msclkid|mc_\w+|ref)$/;
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
  const changes = new Map();
  for (const x of parts.filter((x) => x.includes('='))) {
    const i = x.indexOf('='), path = x.slice(0, i), text = x.slice(i + 1);
    if (ADDED.test(path)) continue;
    if (changes.has(path)) throw new Error(`${path} is set twice`);
    try {
      changes.set(path, JSON.parse(text));
    } catch {
      throw new Error(`${path}=${text}: the value is not one (a number, true or false, "text", or [a, list])`);
    }
  }
  if (changes.size && !names.length) throw new Error('a link with changes names its world (?arcology&..., ?halls&...)');
  return { name: names[0] ?? null, changes: changes.size ? byPaths(Object.fromEntries(changes)) : undefined };
}
