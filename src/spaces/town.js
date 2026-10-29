// The town's buildings, as one catalogue: the shader's townShape and the
// JavaScript's are both made from it, so they cannot disagree, and a new
// kind of building is one entry.
//
// A lot [x0, z0, x1, z1] (units over its cell's corner) holds a building of
// one of the types below, picked by its hash h (the other, h2, sizes it);
// box k of it is [x0, y0, z0, x1, y1, z1] (units, up from the town's floor),
// or none. Each value is an expression, in words both languages read the
// same way: whole numbers, + - *, comparisons, && || !, ?: and parentheses;
// the lot's names (below, PREAMBLE), k, the type's own vars (in order); and
// these, which keep the two languages' integers alike:
//   bit(h, n)       the bit n of h (h or h2), 0 or 1
//   field(h, n, m)  h shifted down n bits, modulo m (m > 0)
//   top(y)          y, no higher than the town (TOWN.H)
//   div(a, b)       a / b rounded down (a >= 0, b > 0)
//   min, max
// h and h2 appear only inside bit and field.
//
// A type whose needs are not met gives way to its else (which may give way
// in turn). Its vars are worked out only once its needs are met (a field
// modulo something that could be 0 or less must be guarded by them).

import * as twin from '../twin.js';

// The lot's own names, worked out first, in order.
const PREAMBLE = {
  ix0: 'x0 + 1', iz0: 'z0 + 1', ix1: 'x1 - 1', iz1: 'z1 - 1',
  W: 'ix1 - ix0', D: 'iz1 - iz0',
  h1: 'top(3 + field(h, 10, 10))', hb: 'top(3 + field(h2, 7, 10))',
};

// After real towns' buildings.
export const TOWN_TYPES = [
  // A block, its sides nudged in by a unit or not.
  { name: 'block', boxes: [['ix0 + bit(h, 14)', '0', 'iz0 + bit(h, 15)', 'ix1 - bit(h, 16)', 'h1', 'iz1 - bit(h, 17)']] },
  // A block with a raised core, set back from its edges.
  { name: 'setback', needs: 'W >= 4 && D >= 4', else: 'block', vars: { s: '1 + bit(h, 14)' },
    boxes: [['ix0', '0', 'iz0', 'ix1', 'h1', 'iz1'], ['ix0 + s', '0', 'iz0 + s', 'ix1 - s', 'top(h1 + 2 + field(h, 18, 4))', 'iz1 - s']] },
  // An L: two wings along the lot's two sides.
  { name: 'L', needs: 'W >= 5 && D >= 5', else: 'block',
    vars: { a: '2 + field(h2, 11, W - 3)', b: '2 + field(h2, 15, D - 3)', fx: 'bit(h, 14) == 1', fz: 'bit(h, 15) == 1' },
    boxes: [['fx ? ix1 - a : ix0', '0', 'iz0', 'fx ? ix1 : ix0 + a', 'h1', 'iz1'], ['ix0', '0', 'fz ? iz1 - b : iz0', 'ix1', 'hb', 'fz ? iz1 : iz0 + b']] },
  // A court: a ring round an open yard, one side raised.
  { name: 'court', needs: 'W >= 9 && D >= 9', else: 'L', vars: { w: '2 + bit(h2, 11)', hh: 'top(3 + field(h2, 12, 6))' },
    boxes: [['ix0', '0', 'iz0', 'ix1', 'hh', 'iz0 + w'], ['ix0', '0', 'iz1 - w', 'ix1', 'hh', 'iz1'], ['ix0', '0', 'iz0 + w', 'ix0 + w', 'hh', 'iz1 - w'], ['ix1 - w', '0', 'iz0 + w', 'ix1', 'top(hh + field(h2, 16, 3))', 'iz1 - w']] },
  // A tower on a podium.
  { name: 'tower', needs: 'W >= 6 && D >= 6', else: 'setback',
    vars: { s: '2 + field(h2, 12, 3)', ox: 'ix0 + 1 + field(h2, 14, W - s - 1)', oz: 'iz0 + 1 + field(h2, 18, D - s - 1)' },
    boxes: [['ix0', '0', 'iz0', 'ix1', 'top(2 + bit(h2, 11))', 'iz1'], ['ox', '0', 'oz', 'ox + s', 'top(8 + field(h2, 22, 5))', 'oz + s']] },
  // A row of attached houses along a long lot, each its own height.
  { name: 'row', needs: 'max(W, D) >= 14', else: 'block',
    vars: { n: '2 + field(h2, 11, 3)', along: 'W >= D', a0: 'along ? ix0 : iz0', w: 'along ? W : D' },
    count: 'n', most: 4, each: { u0: 'a0 + div(w * k, n)', u1: 'a0 + div(w * (k + 1), n)', hk: 'top(3 + field(h2, 14 + 3 * k, 8))' },
    box: ['along ? u0 : ix0', '0', 'along ? iz0 : u0', 'along ? u1 : ix1', 'hk', 'along ? iz1 : u1'] },
];

// The words a catalogue of buildings is written in (see twin.js): the
// shared helpers, and top.
const LANG = {
  name: 'town',
  hashes: ['h', 'h2'],
  hashed: ['bit', 'field'],
  helpers: {
    bit: twin.HELPERS.bit,
    field: twin.HELPERS.field,
    top: { n: 1, glsl: ([y]) => `min(TOWN_H, ${y})`, js: '(y) => Math.min(TOWN_H, y)' },
    div: twin.HELPERS.div,
    min: twin.HELPERS.min,
    max: twin.HELPERS.max,
  },
};
const words = (e, names, where) => twin.words(LANG, e, names, where);
const glsl = (e) => twin.glsl(LANG, e);
// (Names a type may not give its own: the function's, the preamble's, the
// helpers', and GLSL's.)
const TAKEN = new Set(['h', 'h2', 'k', 'r', 'dens', 'lo', 'hi', 't', 'x0', 'z0', 'x1', 'z1', ...Object.keys(PREAMBLE), ...Object.keys(LANG.helpers), ...twin.GLSL_TAKEN]);

// The types in the order their needs are asked: each before the one it
// gives way to (so one pass follows any chain of them).
function demotion(types) {
  const at = new Map();
  types.forEach((t, i) => {
    if (at.has(t.name)) throw new Error(`town: two types named ${t.name}`);
    if (!t.needs !== !t.else) throw new Error(`town: ${t.name} has ${t.needs ? 'needs and nothing to give way to' : 'something to give way to and no needs'}`);
    if (t.needs && !types.some((u) => u.name === t.else)) throw new Error(`town: ${t.name} gives way to ${t.else}, which is no type`);
    for (const v of [...Object.keys(t.vars ?? {}), ...Object.keys(t.each ?? {})]) if (TAKEN.has(v)) throw new Error(`town: ${t.name} names a var ${v}, which is taken`);
    at.set(t.name, i);
  });
  const post = [], done = new Set(), on = new Set();
  const visit = (i) => {
    if (done.has(i)) return;
    if (on.has(i)) throw new Error(`town: ${types[i].name} gives way in a circle`);
    on.add(i);
    if (types[i].needs) visit(at.get(types[i].else));
    on.delete(i);
    done.add(i);
    post.push(i);
  };
  types.forEach((_, i) => visit(i));
  return { order: post.reverse(), at };
}

// What each name a type declares holds, number or true or false, found by
// working it out (for GLSL's declarations): on a lot as big as a cell, any
// hashes, its first box.
function kinds(types) {
  const lot = `const h = 0x9e3779b9, h2 = 0x7f4a7c15, x0 = 0, z0 = 0, x1 = 24, z1 = 24, k = 0;\n${Object.entries(PREAMBLE).map(([v, e]) => `const ${v} = ${e};`).join('\n')}`;
  return types.map((t) => twin.kinds(`const TOWN_H = 24;\n${twin.jsHelpers(LANG)}\n${lot}`, Object.entries({ ...t.vars, ...t.each })));
}

// The most boxes a building of a catalogue has (by default, TOWN_TYPES).
export const townShapes = (types = TOWN_TYPES) => Math.max(...types.map((t) => (t.box ? t.most : t.boxes.length)));
export const TOWN_SHAPES = townShapes();

// Write the function in either language, `js` (true) or GLSL, for a
// catalogue of types.
function write(js, types) {
  const { order, at } = demotion(types), KINDS = kinds(types);
  const index = (n) => at.get(n);
  const lot = new Set(['x0', 'z0', 'x1', 'z1', 'k', ...Object.keys(PREAMBLE)]);
  const out = [];
  const name = (e) => (js ? e : glsl(e));
  const decl = (v, e, kind) => (js ? `const ${v} = ${name(e)};` : `${kind === 'boolean' ? 'bool' : 'int'} ${v} = ${name(e)};`);
  const box = (b) => (js ? `return [${b.map(name).join(', ')}];` : `lo = vec3(${b.slice(0, 3).map(name).join(', ')}); hi = vec3(${b.slice(3).map(name).join(', ')}); return true;`);
  const none = js ? 'return null;' : 'return false;';
  for (const [v, e] of Object.entries(PREAMBLE)) out.push(decl(v, words(e, lot, `the preamble's ${v}`), 'number'));
  out.push(js ? `let t = field(h, 7, ${types.length});` : `int t = ${glsl(`field(h, 7, ${types.length})`)};`);
  for (const i of order) {
    const t = types[i];
    if (t.needs) out.push(`if (t == ${i} && !(${name(words(t.needs, lot, `${t.name}'s needs`))})) t = ${index(t.else)};`);
  }
  types.forEach((t, i) => {
    const names = new Set(lot);
    out.push(`if (t == ${i}) {`);
    for (const [v, e] of Object.entries(t.vars ?? {})) out.push('  ' + decl(v, words(e, names, `${t.name}'s ${v}`), KINDS[i][v])), names.add(v);
    if (t.box) {
      if (t.boxes) throw new Error(`town: ${t.name} has both box and boxes`);
      out.push(`  if (k >= ${name(words(t.count, names, `${t.name}'s count`))}) ${none}`);
      for (const [v, e] of Object.entries(t.each ?? {})) out.push('  ' + decl(v, words(e, names, `${t.name}'s ${v}`), KINDS[i][v])), names.add(v);
      out.push('  ' + box(t.box.map((e) => words(e, names, `${t.name}'s box`))));
    } else {
      t.boxes.forEach((b, j) => out.push(`  if (k == ${j}) { ${box(b.map((e) => words(e, names, `${t.name}'s box ${j}`)))} }`));
      out.push(`  ${none}`);
    }
    out.push('}');
  });
  out.push(none);
  return out.join('\n');
}

// The JavaScript: townShape(h, h2, r, dens, k) gives box k of lot r, or
// null (none when h2 % 100 >= dens: the cluster's density). checked: the
// helpers throw where their numbers are out of their range (for the tests).
// types: the catalogue (by default, TOWN_TYPES); likewise for the GLSL.
export function townShapeJs(H, checked = false, types = TOWN_TYPES) {
  const helpers = `const TOWN_H = ${H};\n${twin.jsHelpers(LANG, checked)}`;
  const body = `${helpers}
return function townShape(h, h2, [x0, z0, x1, z1], dens, k) {
if (h2 % 100 >= dens) return null;
${write(true, types)}
};
//# sourceURL=townShape.gen.js`;
  return new Function(body)();
}

// The GLSL: townShape(h, h2, r, dens, k, lo, hi), true if lot r has box k
// (then lo, hi). Needs TOWN_H.
export function townShapeGlsl(types = TOWN_TYPES) {
  return `bool townShape(uint h, uint h2, ivec4 r, uint dens, int k, out vec3 lo, out vec3 hi) {
  lo = vec3(0.0); hi = vec3(0.0);
  if (h2 % 100u >= dens) return false;
  int x0 = r.x, z0 = r.y, x1 = r.z, z1 = r.w;
${write(false, types).split('\n').map((l) => '  ' + l).join('\n')}
}`;
}
