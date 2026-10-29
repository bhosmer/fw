// 32-bit integer hash (any int in, uint32 out).
export function hash32(x) {
  x |= 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = Math.imul(x, 9);
  x ^= x >>> 4;
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 15;
  return x >>> 0;
}

// HSV (all 0..1, hue wraps) to linear RGB.
export function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 6) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.pow(c, 2.2);
  };
  return [f(5), f(3), f(1)];
}

// The same cell hash the shaders use (hashCell in shaders.js), bit for bit.
export function hashCell(p, s) {
  let h = Math.imul(p[0], 0x9e3779b1) ^ Math.imul(p[1], 0x85ebca77) ^ Math.imul(p[2], 0xc2b2ae3d) ^ s;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Cell ids repeat with period R^2 (wrapId in shaders.js, the same).
export function wrapId(id, R) {
  const P = R * R;
  return id.map((x) => ((x % P) + P) % P);
}

// What makes one level's cells differ from another's.
export function levelSeed(level) {
  return hash32(level ^ 0x5bd1e995);
}

// A number as a GLSL float literal, and a hash salt as a GLSL uint literal.
export const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
export const hexu = (x) => `0x${(x >>> 0).toString(16).padStart(8, '0')}u`;

// A definition (of a world: see makeArcology): the defaults, with what set
// changes. Objects are changed part by part; anything else (numbers,
// strings, arrays, functions) is replaced whole, by a copy (so that what is
// given is left as it was). A part the defaults do not have, or of another
// kind, is refused, saying where and what there is.
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const kind = (x) => (Array.isArray(x) ? 'array' : x === null ? 'nothing' : Number.isNaN(x) ? 'NaN' : typeof x);
const copy = (x) => (Array.isArray(x) ? x.map(copy) : plain(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, copy(v)])) : x);
export function define(defaults, set, path = '') {
  if (set === undefined) return defaults;
  const k0 = kind(defaults), k1 = kind(set);
  if (k1 !== k0) throw new Error(`definition: ${path.slice(0, -1) || 'it'} is ${k0 === 'object' ? 'a set of parts' : k0 === 'nothing' ? 'nothing' : `${/^[aeiou]/.test(k0) ? 'an' : 'a'} ${k0}`}, not ${k1 === 'function' ? 'a function' : JSON.stringify(set) ?? String(set)}`);
  if (!plain(defaults)) return copy(set);
  const out = { ...defaults };
  for (const [k, v] of Object.entries(set)) {
    if (!Object.hasOwn(defaults, k)) throw new Error(`definition: there is no ${path}${k} (there are ${Object.keys(defaults).map((x) => path + x).join(', ')})`);
    out[k] = define(defaults[k], v, `${path}${k}.`);
  }
  return out;
}
// Changes given by dotted paths ({ 'town.density': [10, 30, 60] }, as from
// a link) as the nested object define takes, the values copied. (No part may
// be named as objects' own workings are, and none set both whole and part by
// part, in either order.)
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export function byPaths(changes) {
  const out = {}, whole = new Set(), seen = new Set();
  for (const [p, v] of Object.entries(changes)) {
    const keys = p.split('.');
    if (keys.some((k) => UNSAFE.has(k) || k === '')) throw new Error(`definition: no such part as ${p}`);
    keys.slice(0, -1).forEach((_, i) => {
      if (whole.has(keys.slice(0, i + 1).join('.'))) throw new Error(`definition: ${p} runs through a part also set whole`);
    });
    if (seen.has(p) || [...seen].some((q) => q.startsWith(`${p}.`))) throw new Error(`definition: ${p} is set twice (whole, and part by part)`);
    let o = out;
    for (const k of keys.slice(0, -1)) o = Object.hasOwn(o, k) ? o[k] : (o[k] = {});
    o[keys.at(-1)] = copy(v);
    whole.add(p);
    keys.forEach((_, i) => seen.add(keys.slice(0, i + 1).join('.')));
  }
  return out;
}
// A definition made fast, parts and all (functions, and typed arrays, aside),
// so that what was made from it cannot drift from it.
export function frozen(x) {
  if (x !== null && typeof x === 'object' && !ArrayBuffer.isView(x)) {
    Object.values(x).forEach(frozen);
    Object.freeze(x);
  }
  return x;
}
