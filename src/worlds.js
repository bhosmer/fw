// The world there is to visit, the arcology, made when first asked for (it
// takes most of a second), and named variants of it: the world and changes
// to its definition (see makeArcology, and define in util.js). The app and
// the tests take them from here; a link may name one (see fromLink).
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
