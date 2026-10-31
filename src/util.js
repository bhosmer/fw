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

// Whether a space's slants cut a level's cells (see slantLevels in
// worlds.js): only there are they planes of the level, and asked after.
export const slantsCut = (space, level) => !space.slantLevels || (level >= space.slantLevels[0] && level <= space.slantLevels[1]);

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
// kind, is refused, saying where and what there is. A part made by keyed
// holds, for each whole number it is given (by default, those of entries),
// the parts around it as defined, all but except, with that number's
// changes (a number in entries, with its own there first).
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const kind = (x) => (Array.isArray(x) ? 'array' : x === null ? 'nothing' : Number.isNaN(x) ? 'NaN' : typeof x);
const copy = (x) => (Array.isArray(x) ? x.map(copy) : plain(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, copy(v)])) : x);
const KEYED = Symbol('keyed');
export const keyed = (except = [], entries = {}) => ({ [KEYED]: frozen({ except, entries }) });
const isKeyed = (x) => plain(x) && KEYED in x;
const keyedIn = (x) => plain(x) && (isKeyed(x) || Object.values(x).some(keyedIn));
export function define(defaults, set, path = '') {
  if (isKeyed(defaults)) throw new Error(`definition: ${path.slice(0, -1) || 'it'}: a keyed part is a part of something`);
  // (Nothing changed: the defaults as they are, but with keyed parts empty.)
  if (set === undefined) return keyedIn(defaults) ? define(defaults, {}, path) : defaults;
  const k0 = kind(defaults), k1 = kind(set);
  if (k1 !== k0) throw new Error(`definition: ${path.slice(0, -1) || 'it'} is ${k0 === 'object' ? 'a set of parts' : k0 === 'nothing' ? 'nothing' : `${/^[aeiou]/.test(k0) ? 'an' : 'a'} ${k0}`}, not ${k1 === 'function' ? 'a function' : JSON.stringify(set) ?? String(set)}`);
  if (!plain(defaults)) return copy(set);
  for (const k of Object.keys(set)) if (!Object.hasOwn(defaults, k)) throw new Error(`definition: there is no ${path}${k} (there are ${Object.keys(defaults).map((x) => path + x).join(', ')})`);
  // (The other parts first: a keyed part's entries start from them.)
  const out = {};
  for (const [k, v] of Object.entries(defaults)) if (!isKeyed(v)) out[k] = define(v, set[k], `${path}${k}.`);
  for (const [k, v] of Object.entries(defaults)) {
    if (!isKeyed(v)) continue;
    const here = `${path}${k}`, given = merge(v[KEYED].entries, set[k] ?? {});
    if (!plain(given)) throw new Error(`definition: ${here} is a set of parts, one for each of some whole numbers, not ${JSON.stringify(set[k])}`);
    const template = Object.fromEntries(Object.entries(out).filter(([p]) => !v[KEYED].except.includes(p)));
    out[k] = Object.fromEntries(Object.entries(given).map(([n, w]) => {
      if (!(/^-?(0|[1-9]\d*)$/.test(n) && n !== '-0' && Math.abs(+n) < 2 ** 31)) throw new Error(`definition: ${here}.${n}: there are parts only for whole numbers`);
      return [n, define(template, w, `${here}.${n}.`)];
    }));
  }
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, out[k]]));
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
// Two sets of changes as one, the second's winning (objects merged part by
// part, anything else replaced whole): a variant's, and a link's on top.
export function merge(a, b) {
  if (b === undefined) return a;
  if (!plain(a) || !plain(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
  return out;
}

// A digest of what something is made from (text, numbers, typed arrays and
// lists of them), as 16 hex digits: two 32-bit hashes, each of every byte.
export function digest(parts) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  const word = (w) => {
    a = Math.imul(a ^ w, 0x01000193);
    b = Math.imul(b ^ w, 0x5bd1e995);
    b ^= b >>> 13;
  };
  const add = (x) => {
    // (Each part's length, or kind, first: so that no two lists of parts
    // run together into the same words.)
    if (typeof x === 'string') {
      word(x.length + 0x7f4a);
      for (let i = 0; i < x.length; i++) word(x.charCodeAt(i));
    } else if (typeof x === 'number') add(String(x));
    else if (ArrayBuffer.isView(x)) {
      const u8 = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      word(u8.length);
      for (let i = 0; i < u8.length; i++) word(u8[i]);
    } else if (Array.isArray(x)) {
      word(x.length + 0x5bd1);
      x.forEach(add);
    } else throw new Error(`digest: ${typeof x}`);
  };
  add(parts);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// What takes long to make, kept in the browser's store (IndexedDB) by a key
// naming everything it is made from (see digest), and made afresh only where
// none is kept: the store's, or make()'s. Values are what the store can keep
// (typed arrays, plain objects). Without a store (in Node, or where it is
// refused or fails), make()'s. The store keeps the last few made.
const STORE = 'fw-made', KEEP = 8;
export async function stored(key, make) {
  // (No store where opening one throws, fails, is blocked, or does not
  // answer within a few seconds; one that answers late is closed.)
  const db = await new Promise((ok) => {
    let q, done = false, timer = null;
    const end = (x) => (done ? x?.close() : ((done = true), clearTimeout(timer), ok(x)));
    try {
      q = indexedDB.open(STORE, 1);
    } catch {
      return end(null);
    }
    timer = setTimeout(() => end(null), 3000);
    q.onupgradeneeded = () => (q.result.createObjectStore('made'), q.result.createObjectStore('at'));
    q.onsuccess = () => end(q.result);
    q.onerror = q.onblocked = () => end(null);
  });
  if (!db) return make();
  // (Requests in a transaction of their own over both stores: the last one's result, once done.)
  const ask = (mode, f) =>
    new Promise((ok, no) => {
      const t = db.transaction(['made', 'at'], mode), q = f(t.objectStore('made'), t.objectStore('at'));
      t.oncomplete = () => ok(q?.result);
      t.onerror = t.onabort = () => no(t.error);
    });
  try {
    const kept = await ask('readonly', (m) => m.get(key)).catch(() => undefined);
    if (kept !== undefined) return kept;
    const value = make();
    await ask('readwrite', (m, at) => (m.put(value, key), at.put(Date.now(), key)))
      .then(async () => {
        // (The oldest let go, past the last few.)
        const [keys, ats] = await Promise.all([ask('readonly', (m, at) => at.getAllKeys()), ask('readonly', (m, at) => at.getAll())]);
        const old = keys.map((k, i) => [ats[i], k]).sort((x, y) => x[0] - y[0]).slice(0, Math.max(keys.length - KEEP, 0));
        if (old.length) await ask('readwrite', (m, at) => old.forEach(([, k]) => (m.delete(k), at.delete(k))));
      })
      .catch(() => {});
    return value;
  } finally {
    db.close();
  }
}

// Rows of whole numbers ({ data, size }: an Int32Array and its texture's
// size) that take long to make, kept on disk where JavaScript runs outside
// a browser (the checks, the tools: in the system's temporary directory, by
// the key that names all they are made from, see digest), and made afresh
// only where none is kept. In a browser, make()'s (see stored for its own
// store).
export function keptOnDisk(key, make) {
  const node = globalThis.process?.getBuiltinModule;
  if (!node) return make();
  const fs = node('node:fs'), os = node('node:os'), path = node('node:path');
  const dir = path.join(os.tmpdir(), 'fw-made'), file = path.join(dir, `${digest([key])}.bin`);
  try {
    const b = fs.readFileSync(file), size = [b.readInt32LE(0), b.readInt32LE(4)];
    if (b.length !== 8 + 16 * size[0] * size[1]) throw new Error('not whole');
    return { size, data: new Int32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + b.byteLength)) };
  } catch {
    const made = make();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const head = Buffer.alloc(8);
      head.writeInt32LE(made.size[0], 0), head.writeInt32LE(made.size[1], 4);
      // (Written whole, then put in place: so that another run never reads half of it.)
      const part = `${file}.${process.pid}`;
      fs.writeFileSync(part, Buffer.concat([head, Buffer.from(made.data.buffer, made.data.byteOffset, made.data.byteLength)]));
      fs.renameSync(part, file);
      // (The oldest let go, past the last few.)
      const kept = fs.readdirSync(dir).filter((f) => f.endsWith('.bin')).map((f) => [fs.statSync(path.join(dir, f)).mtimeMs, f]).sort((x, y) => y[0] - x[0]);
      for (const [, f] of kept.slice(8)) fs.rmSync(path.join(dir, f), { force: true });
    } catch {}
    return made;
  }
}
