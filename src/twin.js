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
