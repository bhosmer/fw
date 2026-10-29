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

// (Its words, checked: nothing else may appear; h and h2 only as the first
// argument of bit and field; each helper with its own number of arguments;
// commas only between them.)
const HELPERS = { bit: 2, field: 3, top: 1, div: 2, min: 2, max: 2 };
const OPS = new Set(['+', '-', '*', '<', '>', '<=', '>=', '==', '!=', '?', ':', '(', ')', ',', '&&', '||', '!']);
const TOKEN = /[A-Za-z_]\w*|\d+|>>>?|<<|\+\+|--|&&|\|\||[<>=!]=|\S/g;
// (The helper called at e[i] (its name's start): its arguments, and where
// its closing parenthesis is.)
function call(e, i) {
  const args = [];
  let depth = 0, from = e.indexOf('(', i) + 1, j = from;
  for (; ; j++) {
    const c = e[j];
    if (c === undefined) throw new Error(`town: unclosed ( in ${e}`);
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) break;
    else if (c === ',' && depth === 0) args.push(e.slice(from, j).trim()), (from = j + 1);
  }
  args.push(e.slice(from, j).trim());
  return { args, end: j };
}
const CALL = /\b(bit|field|top|div|min|max)\(/g;
function words(e, names, where) {
  const bad = (what) => {
    throw new Error(`town: ${what} in ${where}: ${e}`);
  };
  const tokens = e.match(TOKEN);
  // (Each parenthesis: a helper's, or not.)
  const helper = [];
  tokens.forEach((t, i) => {
    if (t === '(') helper.push(tokens[i - 1] in HELPERS);
    else if (t === ')') helper.pop();
    else if (t === ',' && !helper.at(-1)) bad('a comma outside a helper');
    const ok = /^\d+$/.test(t) || OPS.has(t) || names.has(t) || t in HELPERS || t === 'h' || t === 'h2';
    if (!ok) bad(`'${t}'`);
  });
  let hs = 0;
  for (const m of e.matchAll(CALL)) {
    const { args } = call(e, m.index), n = HELPERS[m[1]];
    if (args.length !== n) bad(`${m[1]} with ${args.length} arguments, not ${n}`);
    if (['bit', 'field'].includes(m[1])) {
      if (args[0] !== 'h' && args[0] !== 'h2') bad(`${m[1]} of ${args[0]}, not h or h2`);
      hs++;
    }
  }
  if (tokens.filter((t) => t === 'h' || t === 'h2').length !== hs) bad('h or h2 outside bit and field');
  return e;
}
// (Names a type may not give its own: the function's, the preamble's, the
// helpers', and GLSL's.)
const TAKEN = new Set(['h', 'h2', 'k', 'r', 'dens', 'lo', 'hi', 't', 'x0', 'z0', 'x1', 'z1', ...Object.keys(PREAMBLE), ...Object.keys(HELPERS),
  'int', 'uint', 'bool', 'float', 'vec2', 'vec3', 'vec4', 'ivec3', 'in', 'out', 'inout', 'if', 'else', 'for', 'while', 'do', 'return', 'true', 'false', 'const', 'discard', 'break', 'continue', 'mod', 'abs', 'sign', 'step']);

// The types in the order their needs are asked: each before the one it
// gives way to (so one pass follows any chain of them).
function demotion() {
  const at = new Map();
  TOWN_TYPES.forEach((t, i) => {
    if (at.has(t.name)) throw new Error(`town: two types named ${t.name}`);
    if (!t.needs !== !t.else) throw new Error(`town: ${t.name} has ${t.needs ? 'needs and nothing to give way to' : 'something to give way to and no needs'}`);
    if (t.needs && !TOWN_TYPES.some((u) => u.name === t.else)) throw new Error(`town: ${t.name} gives way to ${t.else}, which is no type`);
    for (const v of [...Object.keys(t.vars ?? {}), ...Object.keys(t.each ?? {})]) if (TAKEN.has(v)) throw new Error(`town: ${t.name} names a var ${v}, which is taken`);
    at.set(t.name, i);
  });
  const post = [], done = new Set(), on = new Set();
  const visit = (i) => {
    if (done.has(i)) return;
    if (on.has(i)) throw new Error(`town: ${TOWN_TYPES[i].name} gives way in a circle`);
    on.add(i);
    if (TOWN_TYPES[i].needs) visit(at.get(TOWN_TYPES[i].else));
    on.delete(i);
    done.add(i);
    post.push(i);
  };
  TOWN_TYPES.forEach((_, i) => visit(i));
  return { order: post.reverse(), at };
}

// What each name a type declares holds, number or true or false, found by
// working it out (for GLSL's declarations): on a lot as big as a cell, any
// hashes, its first box.
const JS_HELPERS = 'const bit = (x, n) => (x >>> n) & 1, field = (x, n, m) => (x >>> n) % m, top = (y) => Math.min(24, y), div = (a, b) => Math.floor(a / b), min = Math.min, max = Math.max;';
const KINDS = (() => {
  const lot = `const h = 0x9e3779b9, h2 = 0x7f4a7c15, x0 = 0, z0 = 0, x1 = 24, z1 = 24, k = 0;\n${Object.entries(PREAMBLE).map(([v, e]) => `const ${v} = ${e};`).join('\n')}`;
  return TOWN_TYPES.map((t) => {
    const vs = Object.entries({ ...t.vars, ...t.each });
    const f = new Function(`${JS_HELPERS}\n${lot}\n${vs.map(([v, e]) => `const ${v} = ${e};`).join('\n')}\nreturn {${vs.map(([v]) => `${v}: typeof ${v}`).join(', ')}};`);
    return f();
  });
})();

// The most boxes a building has.
export const TOWN_SHAPES = Math.max(...TOWN_TYPES.map((t) => (t.box ? t.most : t.boxes.length)));

// An expression in GLSL: the helpers written out where they are used, as
// whole numbers and their shifts and modulos, in the forms the shader has
// always had them. (Not as GLSL functions: under Chrome on the Mac (ANGLE's
// Metal), a value shifted right by exactly 16 (or divided by 65536) and then
// taken modulo or divided by a constant not a power of two gives wrong
// numbers when the two meet only once a function is inlined: ledger B20.)
function glsl(e) {
  const lit = (x) => (/^\d+$/.test(x) ? `${x}u` : `uint(${x})`);
  const helper = { bit: ([h, n]) => `int((${h} >> ${lit(n)}) & 1u)`, field: ([h, n, m]) => `int((${h} >> ${lit(n)}) % ${lit(m)})`, top: ([y]) => `min(TOWN_H, ${y})`, div: ([a, b]) => `((${a}) / (${b}))`, min: ([a, b]) => `min(${a}, ${b})`, max: ([a, b]) => `max(${a}, ${b})` };
  let out = '', at = 0;
  for (const m of e.matchAll(CALL)) {
    if (m.index < at) continue;
    // (Its arguments, each written out first.)
    const { args, end } = call(e, m.index);
    out += e.slice(at, m.index) + helper[m[1]](args.map(glsl));
    at = end + 1;
  }
  return out + e.slice(at);
}

// Write the function in either language: `js` (true) or GLSL.
function write(js) {
  const { order, at } = demotion();
  const index = (n) => at.get(n);
  const lot = new Set(['x0', 'z0', 'x1', 'z1', 'k', ...Object.keys(PREAMBLE)]);
  const out = [];
  const name = (e) => (js ? e : glsl(e));
  const decl = (v, e, kind) => (js ? `const ${v} = ${name(e)};` : `${kind === 'boolean' ? 'bool' : 'int'} ${v} = ${name(e)};`);
  const box = (b) => (js ? `return [${b.map(name).join(', ')}];` : `lo = vec3(${b.slice(0, 3).map(name).join(', ')}); hi = vec3(${b.slice(3).map(name).join(', ')}); return true;`);
  const none = js ? 'return null;' : 'return false;';
  for (const [v, e] of Object.entries(PREAMBLE)) out.push(decl(v, words(e, lot, `the preamble's ${v}`), 'number'));
  out.push(js ? `let t = field(h, 7, ${TOWN_TYPES.length});` : `int t = ${glsl(`field(h, 7, ${TOWN_TYPES.length})`)};`);
  for (const i of order) {
    const t = TOWN_TYPES[i];
    if (t.needs) out.push(`if (t == ${i} && !(${name(words(t.needs, lot, `${t.name}'s needs`))})) t = ${index(t.else)};`);
  }
  TOWN_TYPES.forEach((t, i) => {
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
export function townShapeJs(H, checked = false) {
  const helpers = checked
    ? `const bit = (x, n) => (x >>> n) & 1, top = (y) => Math.min(${H}, y), min = Math.min, max = Math.max;
const field = (x, n, m) => { if (!(m > 0 && n >= 0 && n < 32)) throw new Error('town: field(' + n + ', ' + m + ')'); return (x >>> n) % m; };
const div = (a, b) => { if (!(b > 0 && a >= 0)) throw new Error('town: div(' + a + ', ' + b + ')'); return Math.floor(a / b); };`
    : JS_HELPERS.replace('Math.min(24, y)', `Math.min(${H}, y)`);
  const body = `${helpers}
return function townShape(h, h2, [x0, z0, x1, z1], dens, k) {
if (h2 % 100 >= dens) return null;
${write(true)}
};
//# sourceURL=townShape.gen.js`;
  return new Function(body)();
}

// The GLSL: townShape(h, h2, r, dens, k, lo, hi), true if lot r has box k
// (then lo, hi). Needs TOWN_H.
export function townShapeGlsl() {
  return `bool townShape(uint h, uint h2, ivec4 r, uint dens, int k, out vec3 lo, out vec3 hi) {
  lo = vec3(0.0); hi = vec3(0.0);
  if (h2 % 100u >= dens) return false;
  int x0 = r.x, z0 = r.y, x1 = r.z, z1 = r.w;
${write(false).split('\n').map((l) => '  ' + l).join('\n')}
}`;
}
