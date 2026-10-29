// Code written in both languages from one description: expressions a
// catalogue states once, in words GLSL and JavaScript read the same way,
// checked here and written out for each (see town.js, the first such
// catalogue). What a catalogue declares, its language:
//
//   name      for the messages ('town: ...')
//   helpers   { name: { n, glsl } }: each helper's number of arguments, and
//             how GLSL writes it, given its arguments written out
//   hashes    names that may appear only as the first argument of a hashed
//             helper (the hashes: uint in GLSL)
//   hashed    those helpers
//
// and each helper's JavaScript, as a function (js), and, optionally, as the
// tests have it (checked: throwing where its numbers are out of its range).
//
// An expression may hold whole numbers, + - *, comparisons, && || !, ?: and
// parentheses, the names it is given, and the language's helpers.

const OPS = new Set(['+', '-', '*', '<', '>', '<=', '>=', '==', '!=', '?', ':', '(', ')', ',', '&&', '||', '!']);
const TOKEN = /[A-Za-z_]\w*|\d+|>>>?|<<|\+\+|--|&&|\|\||[<>=!]=|\S/g;

// (The helper called at e[i] (its name's start): its arguments, and where
// its closing parenthesis is.)
function call(lang, e, i) {
  const args = [];
  let depth = 0, from = e.indexOf('(', i) + 1, j = from;
  for (; ; j++) {
    const c = e[j];
    if (c === undefined) throw new Error(`${lang.name}: unclosed ( in ${e}`);
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) break;
    else if (c === ',' && depth === 0) args.push(e.slice(from, j).trim()), (from = j + 1);
  }
  args.push(e.slice(from, j).trim());
  return { args, end: j };
}
// (Where the language's helpers are called: built once for each language.)
const CALLS = new WeakMap();
function calls(lang) {
  if (!CALLS.has(lang)) CALLS.set(lang, new RegExp(`\\b(${Object.keys(lang.helpers).join('|')})\\s*\\(`, 'g'));
  return CALLS.get(lang);
}
const isHelper = (lang, t) => Object.hasOwn(lang.helpers, t);

// Expression e, checked: nothing else may appear but what the language
// allows and names (a Set); the hashes only as the first argument of the
// hashed helpers; each helper with its own number of arguments; commas
// only between them. (where: what it is, for the messages.)
export function words(lang, e, names, where) {
  const bad = (what) => {
    throw new Error(`${lang.name}: ${what} in ${where}: ${e}`);
  };
  const tokens = e.match(TOKEN) ?? bad('nothing');
  // (Each parenthesis: a helper's, or not.)
  const helper = [];
  tokens.forEach((t, i) => {
    if (t === '(') helper.push(isHelper(lang, tokens[i - 1]));
    else if (t === ')') helper.pop();
    else if (t === ',' && !helper.at(-1)) bad('a comma outside a helper');
    const ok = /^\d+$/.test(t) || OPS.has(t) || names.has(t) || isHelper(lang, t) || lang.hashes.includes(t);
    if (!ok) bad(`'${t}'`);
  });
  let hs = 0;
  for (const m of e.matchAll(calls(lang))) {
    const { args } = call(lang, e, m.index), n = lang.helpers[m[1]].n;
    if (args.length !== n) bad(`${m[1]} with ${args.length} arguments, not ${n}`);
    if (lang.hashed.includes(m[1])) {
      if (!lang.hashes.includes(args[0])) bad(`${m[1]} of ${args[0]}, not ${lang.hashes.join(' or ')}`);
      hs++;
    }
  }
  if (tokens.filter((t) => lang.hashes.includes(t)).length !== hs) bad(`${lang.hashes.join(' or ')} outside ${lang.hashed.join(' and ')}`);
  return e;
}

// Expression e in GLSL: each helper written out where it is used, by the
// language's own form for it. (Not as GLSL functions: under Chrome on the
// Mac (ANGLE's Metal), a value shifted right by exactly 16 (or divided by
// 65536) and then taken modulo or divided by a constant not a power of two
// gives wrong numbers when the two meet only once a function is inlined:
// ledger B20.)
export function glsl(lang, e) {
  let out = '', at = 0;
  for (const m of e.matchAll(calls(lang))) {
    if (m.index < at) continue;
    // (Its arguments, each written out first.)
    const { args, end } = call(lang, e, m.index);
    out += e.slice(at, m.index) + lang.helpers[m[1]].glsl(args.map((a) => glsl(lang, a)));
    at = end + 1;
  }
  return out + e.slice(at);
}

// The language's helpers, declared in JavaScript (checked: as the tests
// have them, where a helper has such a form).
export function jsHelpers(lang, checked = false) {
  return Object.entries(lang.helpers).map(([name, h]) => `const ${name} = ${(checked && h.checked) || h.js};`).join('\n');
}

// Helpers more than one catalogue has (each catalogue's language takes
// those it wants): the bit n of hash h; h shifted down n bits, modulo m (m >
// 0); a / b rounded down (a >= 0, b > 0); min and max. (lit: a whole number
// as a uint literal, anything else converted.)
const lit = (x) => (/^\d+$/.test(x) ? `${x}u` : `uint(${x})`);
export const HELPERS = {
  bit: { n: 2, glsl: ([h, n]) => `int((${h} >> ${lit(n)}) & 1u)`, js: '(x, n) => (x >>> n) & 1' },
  field: {
    n: 3,
    glsl: ([h, n, m]) => `int((${h} >> ${lit(n)}) % ${lit(m)})`,
    js: '(x, n, m) => (x >>> n) % m',
    checked: "(x, n, m) => { if (!(m > 0 && n >= 0 && n < 32)) throw new Error('field(' + n + ', ' + m + ')'); return (x >>> n) % m; }",
  },
  div: {
    n: 2,
    glsl: ([a, b]) => `((${a}) / (${b}))`,
    js: '(a, b) => Math.floor(a / b)',
    checked: "(a, b) => { if (!(b > 0 && a >= 0)) throw new Error('div(' + a + ', ' + b + ')'); return Math.floor(a / b); }",
  },
  min: { n: 2, glsl: ([a, b]) => `min(${a}, ${b})`, js: 'Math.min' },
  max: { n: 2, glsl: ([a, b]) => `max(${a}, ${b})`, js: 'Math.max' },
};

// What each of the names declared in vars ([[name, expression], ...]) holds,
// 'number' or 'boolean', found by working them out in JavaScript after
// prelude (the helpers and the names they may use, given values): for
// GLSL's declarations.
export function kinds(prelude, vars) {
  const f = new Function(`${prelude}\n${vars.map(([v, e]) => `const ${v} = ${e};`).join('\n')}\nreturn {${vars.map(([v]) => `${v}: typeof ${v}`).join(', ')}};`);
  return f();
}

// Names GLSL keeps for itself (or its built-in functions), which a
// catalogue may not give its own.
export const GLSL_TAKEN = ['int', 'uint', 'bool', 'float', 'vec2', 'vec3', 'vec4', 'ivec3', 'in', 'out', 'inout', 'if', 'else', 'for', 'while', 'do', 'return', 'true', 'false', 'const', 'discard', 'break', 'continue', 'mod', 'abs', 'sign', 'step'];

// Pieces (see pieces.js and its GLSL twin in shaders.js), written in either
// language (js: true, or GLSL) from their planes. A plane is
//   { span: [x, f, lo, hi, axis] }      two planes across axis, inside when
//                                       lo <= x + f <= hi
//   { diag: [p, sa, sb, ca, cb, k], axes: [a, b] }
//                                       a 45-degree plane (see diag), the
//                                       pair p being axes a and b
//   { corners: [p, ca, cb, k], axes: [a, b] }
//                                       the four such planes round (ca, cb),
//                                       each pair of signs in turn
// x, lo, hi and the diag's numbers are expressions (in either language
// alike), f a name; an axis is 0, 1 or 2, or the name of one (a vec3 in GLSL,
// its number in JavaScript); signs are 1, -1 or names. kind: 'air' or
// 'solid'. Each plane's normal is worked out from its form, so it cannot
// disagree with the plane.
const AXES = ['EX', 'EY', 'EZ'];
export function planes(js, kind, list) {
  const axis = (a) => (typeof a === 'number' ? (js ? String(a) : AXES[a]) : a);
  // (A 45-degree plane's normal: sa along a, sb along b, over root two.)
  const normal = (sa, a, sb, b) => {
    if (!js) {
      const term = (s, e, first) => (s === 1 ? (first ? e : `+ ${e}`) : s === -1 ? (first ? `-${e}` : `- ${e}`) : `${first ? '' : '+ '}float(${s}) * ${e}`);
      return `(${term(sa, axis(a), true)} ${term(sb, axis(b), false)}) * 0.70710678`;
    }
    const part = (s, e, c) => (typeof e === 'number' ? (e === c ? `${s} * H2` : null) : `(${e} === ${c} ? ${s} * H2 : 0)`);
    return [0, 1, 2].map((c) => [part(sa, a, c), part(sb, b, c)].filter(Boolean).join(' + ') || '0').join(', ');
  };
  const plane = (s, n) => (js ? `${kind}Plane(${s} * H2, ${n});` : `${kind}Plane(${s} * 0.70710678, ${n});`);
  const out = [];
  for (const q of list) {
    if (q.span) {
      const [x, f, lo, hi, a] = q.span;
      out.push(`${kind}Span(${x}, ${f}, ${lo}, ${hi}, ${axis(a)});`);
    } else if (q.diag) {
      const [p, sa, sb, ca, cb, k] = q.diag, [a, b] = q.axes;
      out.push(plane(`diag(${p}, ${sa}, ${sb}, ${ca}, ${cb}, ${k})`, normal(sa, a, sb, b)));
    } else if (q.corners) {
      const [p, ca, cb, k] = q.corners, [a, b] = q.axes;
      out.push(js ? 'for (let j = 0; j < 4; j++) {' : 'for (int j = 0; j < 4; j++) {');
      out.push(js ? '  const sx = j & 1 ? 1 : -1, sz = j & 2 ? 1 : -1;' : '  int sx = (j & 1) == 1 ? 1 : -1, sz = (j & 2) == 2 ? 1 : -1;');
      out.push('  ' + plane(`diag(${p}, sx, sz, ${ca}, ${cb}, ${k})`, normal('sx', a, 'sz', b)));
      out.push('}');
    } else throw new Error(`a plane of no form: ${JSON.stringify(q)}`);
  }
  return out;
}
