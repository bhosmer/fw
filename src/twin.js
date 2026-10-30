// Code written in both languages from one description: expressions a
// catalogue states once, in words GLSL and JavaScript read the same way,
// checked here and written out for each (see town.js, the first such
// catalogue). What a catalogue declares, its language:
//
//   name      for the messages ('town: ...')
//   helpers   { name: { n, glsl, js, checked } }: each helper's number of
//             arguments; how GLSL writes it, given its arguments written
//             out; its JavaScript, as a function; and, optionally, that as
//             the tests have it (throwing where its numbers are out of its
//             range)
//   hashes    names that may appear only as the first argument of a hashed
//             helper (the hashes: uint in GLSL)
//   hashed    those helpers
//
// An expression may hold whole numbers, + - *, comparisons, && || !, ?: and
// parentheses, the names it is given, and the language's helpers.

import { glf } from './util.js';

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
  // (Plain characters only: a space of another kind would pass for one here
  // and not in GLSL.)
  if (/[^\x20-\x7e\t\n]/.test(e)) bad('a character neither language takes');
  const tokens = e.match(TOKEN) ?? bad('nothing');
  // (Each parenthesis: a helper's, or not.)
  const helper = [];
  tokens.forEach((t, i) => {
    if (t === '(') helper.push(isHelper(lang, tokens[i - 1]));
    else if (t === ')') helper.pop();
    else if (t === ',' && !helper.at(-1)) bad('a comma outside a helper');
    if (/^\d+$/.test(t) && !(/^(0|[1-9]\d*)$/.test(t) && +t < 2 ** 31)) bad(`the number ${t} (whole numbers under 2^31, no leading 0)`);
    const ok = /^\d+$/.test(t) || OPS.has(t) || names.has(t) || (isHelper(lang, t) && tokens[i + 1] === '(') || lang.hashes.includes(t);
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
// 0); a / b rounded down (a >= 0, b > 0); min and max. Each says the kinds of
// its arguments ('hash', 'int') for check, which also takes, of a hashed
// helper, every value it can give (from its other arguments' values). (lit:
// a whole number as a uint literal, anything else converted.)
const lit = (x) => (/^\d+$/.test(x) ? `${x}u` : `uint(${x})`);
export const HELPERS = {
  bit: {
    n: 2,
    args: ['hash', 'int'],
    all: () => [0, 1],
    glsl: ([h, n]) => `int((${h} >> ${lit(n)}) & 1u)`,
    js: '(x, n) => (x >>> n) & 1',
    checked: "(x, n) => { if (!(n >= 0 && n < 32)) throw new Error('bit(' + n + ')'); return (x >>> n) & 1; }",
  },
  field: {
    n: 3,
    args: ['hash', 'int', 'int'],
    all: (n, m) => Array.from({ length: m }, (_, i) => i),
    glsl: ([h, n, m]) => `int((${h} >> ${lit(n)}) % ${lit(m)})`,
    js: '(x, n, m) => (x >>> n) % m',
    checked: "(x, n, m) => { if (!(m > 0 && n >= 0 && n < 32)) throw new Error('field(' + n + ', ' + m + ')'); return (x >>> n) % m; }",
  },
  div: {
    n: 2,
    args: ['int', 'int'],
    glsl: ([a, b]) => `((${a}) / (${b}))`,
    js: '(a, b) => Math.floor(a / b)',
    checked: "(a, b) => { if (!(b > 0 && a >= 0)) throw new Error('div(' + a + ', ' + b + ')'); return Math.floor(a / b); }",
  },
  min: { n: 2, args: ['int', 'int'], glsl: ([a, b]) => `min(${a}, ${b})`, js: 'Math.min' },
  max: { n: 2, args: ['int', 'int'], glsl: ([a, b]) => `max(${a}, ${b})`, js: 'Math.max' },
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
// disagree with the plane. (The JavaScript wants H2, root a half, in scope.)
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
      out.push(js ? '  const sa = j & 1 ? 1 : -1, sb = j & 2 ? 1 : -1;' : '  int sa = (j & 1) == 1 ? 1 : -1, sb = (j & 2) == 2 ? 1 : -1;');
      out.push('  ' + plane(`diag(${p}, sa, sb, ${ca}, ${cb}, ${k})`, normal('sa', a, 'sb', b)));
      out.push('}');
    } else throw new Error(`a plane of no form: ${JSON.stringify(q)}`);
  }
  return out;
}

// Expression e, checked (see words), parsed, and its kind found: 'int' or
// 'bool', each part of the kind GLSL wants there (names: { name: { kind,
// value } }); and every value it can have, each hashed helper giving each of
// its values in turn (independently, even where one is asked twice: so
// perhaps more than it can have, never fewer), none 2^31 or more. Throws,
// saying why, where it is not one both languages read alike.
export function check(lang, e, names, where) {
  const bad = (what) => {
    throw new Error(`${lang.name}: ${what} in ${where}: ${e}`);
  };
  words(lang, e, new Set(Object.keys(names)), where);
  const tokens = e.match(TOKEN);
  let i = 0;
  const peek = () => tokens[i], take = (t) => (tokens[i] === t ? (i++, true) : false);
  const want = (t) => take(t) || bad(`${t} wanted at ${tokens.slice(i).join(' ') || 'its end'}`);
  // (Each node: its kind, and its values.)
  const MOST = 1 << 16;
  const many = (xs) => {
    const out = [...new Set(xs)];
    if (!out.length) bad('no value at all');
    if (out.length > MOST) bad('more values than can be checked');
    for (const x of out) if (typeof x === 'number' && !(Math.abs(x) < 2 ** 31)) bad(`a number out of range (${x})`);
    return out;
  };
  const of = (node, kind, what) => (node.kind === kind ? node : bad(`${what}: ${kind === 'int' ? 'a whole number' : 'true or false'} wanted`));
  const pairs = (a, b, f) => many(a.values.flatMap((x) => b.values.map((y) => f(x, y))));
  const ternary = () => {
    const c = or();
    if (!take('?')) return c;
    of(c, 'bool', '?');
    const a = ternary();
    want(':');
    const b = ternary();
    if (a.kind !== b.kind) bad('the two sides of ?: of two kinds');
    return { kind: a.kind, values: many([...(c.values.includes(true) ? a.values : []), ...(c.values.includes(false) ? b.values : [])]) };
  };
  const chain = (next, ops, f) => () => {
    let a = next();
    for (let op; ops.includes((op = peek())); ) i++, (a = f(op, a, next()));
    return a;
  };
  const or = chain(() => and(), ['||'], (op, a, b) => ({ kind: 'bool', values: pairs(of(a, 'bool', op), of(b, 'bool', op), (x, y) => x || y) }));
  const and = chain(() => same(), ['&&'], (op, a, b) => ({ kind: 'bool', values: pairs(of(a, 'bool', op), of(b, 'bool', op), (x, y) => x && y) }));
  const same = chain(() => order(), ['==', '!='], (op, a, b) => {
    if (a.kind !== b.kind) bad(`${op} between two kinds`);
    return { kind: 'bool', values: pairs(a, b, (x, y) => (op === '==') === (x === y)) };
  });
  // (One comparison at most: a < b < c means something else in each.)
  const order = () => {
    const a = sum(), op = peek();
    if (!['<', '>', '<=', '>='].includes(op)) return a;
    i++;
    const b = sum();
    if (['<', '>', '<=', '>='].includes(peek())) bad('a comparison of a comparison');
    const f = { '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y }[op];
    return { kind: 'bool', values: pairs(of(a, 'int', op), of(b, 'int', op), f) };
  };
  const sum = chain(() => product(), ['+', '-'], (op, a, b) => ({ kind: 'int', values: pairs(of(a, 'int', op), of(b, 'int', op), op === '+' ? (x, y) => x + y : (x, y) => x - y) }));
  const product = chain(() => unary(), ['*'], (op, a, b) => ({ kind: 'int', values: pairs(of(a, 'int', op), of(b, 'int', op), (x, y) => x * y) }));
  const unary = () => {
    if (take('!')) return { kind: 'bool', values: of(unary(), 'bool', '!').values.map((x) => !x) };
    if (take('-')) return { kind: 'int', values: many(of(unary(), 'int', '-').values.map((x) => -x)) };
    return primary();
  };
  const primary = () => {
    const t = tokens[i++];
    if (t === undefined) bad('it ends too soon');
    if (t === '(') {
      const a = ternary();
      want(')');
      return a;
    }
    if (/^\d+$/.test(t)) return { kind: 'int', values: [+t] };
    if (Object.hasOwn(names, t)) return { kind: names[t].kind, values: [names[t].value] };
    if (!Object.hasOwn(lang.helpers, t)) bad(`'${t}' out of place`);
    const h = lang.helpers[t], args = [];
    want('(');
    for (let k = 0; k < h.n; k++) {
      if (k) want(',');
      if (h.args[k] === 'hash') {
        const name = tokens[i++];
        if (!lang.hashes.includes(name)) bad(`${t} of ${name}, not ${lang.hashes.join(' or ')}`);
        args.push(null);
      } else args.push(of(ternary(), 'int', t).values);
    }
    want(')');
    // (Asked as the tests have it, with each of its arguments' values: where
    // the two languages would differ (a division of a number below 0, a
    // shift of 32 or more), it is refused. A hashed helper, for any hash,
    // gives every value it can; another, what it gives.)
    const f = new Function(`return ${h.checked ?? h.js};`)();
    const at = (a) => {
      try {
        return f(...a);
      } catch (err) {
        return bad(`${t}: ${err.message}`);
      }
    };
    const every = args.reduce((acc, xs) => acc.flatMap((a) => (xs ? xs.map((x) => [...a, x]) : [[...a, 0]])), [[]]);
    every.forEach(at);
    return { kind: 'int', values: many(h.all ? every.flatMap((a) => h.all(...a.slice(1))) : every.map(at)) };
  };
  const out = ternary();
  if (i < tokens.length) bad(`${tokens.slice(i).join(' ')} left over`);
  return out;
}

// For a ray, a piece the point is in asked again (d: its distance as first
// asked; ask: asking it), and the furthest way out kept: in JavaScript by
// pieces.through; in GLSL as the cell functions have it, the ray's flag
// clear but while asked, and the way out in reach and nrm.
export const reask = (js, d, ask) =>
  js ? [`through(ray, ${d}, () => ${ask});`] : [`if (ray && ${d} + gO <= 0.0) {`, '  gRay = true;', `  ${ask};`, '  gRay = false;', '  if (gX > reach) { reach = gX; nrm = gN; }', '}'];

// What the cell writers (the halls' pieces, the arcology's) write alike,
// in GLSL or JavaScript (js): each helper says what it writes.
// (state: the name the JavaScript knows the pieces' state by, S unless
// that is taken.)
export function writer(js, state = 'S') {
  // (An expression as one term: in parentheses if it adds or takes away at
  // its top level.)
  const term = (e) => {
    let depth = 0;
    for (let i = 1; i < e.length; i++) {
      if (e[i] === '(' || e[i] === '[') depth++;
      else if (e[i] === ')' || e[i] === ']') depth--;
      else if (depth === 0 && (e[i] === '+' || e[i] === '-') && e[i - 1] === ' ') return `(${e})`;
    }
    return e;
  };
  const take = (cmp) => (js ? `if (${state}.x ${cmp} ray.reach) (ray.reach = ${state}.x), (ray.nx = ${state}.nx), (ray.ny = ${state}.ny), (ray.nz = ${state}.nz);` : `if (gX ${cmp} reach) { reach = gX; nrm = gN; }`);
  // (Lines for the shader alone.)
  const shaderOnly = (...lines) => (js ? [] : lines);
  return {
    // A function's opening line, from its parameters' types; a declaration
    // (changing: one that changes after); a counted loop.
    fn: (type, name, params) => (js ? `function ${name}(${params.map((p) => p.split(' ').pop()).join(', ')}) {` : `${type} ${name}(${params.join(', ')}) {`),
    decl: (type, rest, changing = false) => `${js ? (changing ? 'let' : 'const') : type} ${rest};`,
    loop: (v, from, to) => `for (${js ? 'let' : 'int'} ${v} = ${from}; ${v} < ${to}; ${v}++) {`,
    // A number, as a float (in JavaScript exactly, -0 too).
    num: (x) => (js ? (Object.is(x, -0) ? '-0' : String(x)) : glf(x)),
    // A vector of floats as a function's argument (in JavaScript, three
    // arguments: so only in a call); one of whole numbers (an array in
    // JavaScript).
    vec3Arg: (xs) => (js ? xs.join(', ') : `vec3(${xs.join(', ')})`),
    ivec3: (xs) => (js ? `[${xs.join(', ')}]` : `ivec3(${xs.join(', ')})`),
    ivec2: (xs) => (js ? `[${xs.join(', ')}]` : `ivec2(${xs.join(', ')})`),
    // Vectors of whole numbers added and taken away: in JavaScript by
    // AS_GLSL_VEC's add3 and sub3; in GLSL the right one in parentheses where
    // it is a sum.
    vadd: (a, b) => (js ? `add3(${a}, ${b})` : `${a} + ${term(b)}`),
    vsub: (a, b) => (js ? `sub3(${a}, ${b})` : `${a} - ${term(b)}`),
    // Lines and terms for the shader alone: its fading with distance (fade,
    // faded: the JavaScript's world is as it is, see pieces.js), and the
    // rest, such as gRay's saving and restoring (shaderOnly; fade is the
    // same, named for what it writes).
    fade: shaderOnly,
    faded: (term) => (js ? '' : term),
    shaderOnly,
    // An axis's normal and a vector as a call's arguments (in JavaScript,
    // three, each signed as GLSL's -EX is, -0 too); lines indented.
    axis: (a, sign = '') => (js ? [0, 1, 2].map((b) => `${sign}${b === a ? 1 : 0}`).join(', ') : `${sign}${AXES[a]}`),
    arg3: (v, sign = '') => (js ? [0, 1, 2].map((a) => `${sign}${v}[${a}]`).join(', ') : `${sign}${v}`),
    indent: (lines, by = '  ') => lines.map((l) => by + l),
    // (A struct: its fields by type, in groups, as GLSL declares them (in
    // JavaScript, nothing to declare); a value of it, given every field's by
    // name: GLSL's constructor, in the fields' order, or an object.)
    struct: (name, groups) => {
      const fields = groups.flatMap(([, fs]) => fs);
      return {
        decl: js ? '' : `struct ${name} { ${groups.map(([type, fs]) => `${type} ${fs.join(', ')};`).join(' ')} };`,
        make: (values) => {
          const given = Object.keys(values);
          if (given.length !== fields.length || fields.some((f) => !(f in values))) throw new Error(`twin: a ${name} of ${given.join(', ')}, not ${fields.join(', ')}`);
          return js ? `{ ${fields.map((f) => `${f}: ${values[f]}`).join(', ')} }` : `${name}(${fields.map((f) => values[f]).join(', ')})`;
        },
      };
    },
    // The point along slant k, its whole part into n and the rest: in GLSL
    // slantAt, setting n as it gives the rest; in JavaScript the slants as
    // setPoint sets them, SL, the whole part a statement of its own.
    slant: (k, n) => (js ? { whole: [`${n} = SL.Ls[${k}];`], rest: `SL.Fs[${k}]` } : { whole: [], rest: `slantAt(${k}, ${n})` }),
    // The ray aimed afresh, where the shader starts reach and nrm (in
    // JavaScript P.aim, if there is a ray); how far it goes (REACH: the
    // inout reach in GLSL, the ray's object's in JavaScript; READ_REACH: the
    // same with or without a ray, -1 without one, as the shader's is once
    // aimed); where a piece of its air ends taken for it, with its normal
    // (take: if it compares with the reach as asked; keep: if further).
    aim: (by = '') => (js ? [`${by}if (ray) aim(ray);`] : [`${by}reach = -1.0;`, `${by}nrm = vec3(0.0);`]),
    REACH: js ? 'ray.reach' : 'reach',
    READ_REACH: js ? '(ray ? ray.reach : -1.0)' : 'reach',
    take,
    keep: take('>'),
    // A piece's distance (D), no piece (NOTHING), and the ray's state (RAY:
    // whether there is one; X: how far it goes in the piece).
    D: js ? `${state}.d` : 'gD',
    NOTHING: js ? 'NONE' : '1e9',
    RAY: js ? `${state}.ray` : 'gRay',
    X: js ? `${state}.x` : 'gX',
  };
}
// (In the JavaScript they write, float, abs, int, uint and ceil are as GLSL
// has them.)
export const AS_GLSL = 'const float = (x) => x, abs = Math.abs, int = (x) => x | 0, uint = (x) => x >>> 0, ceil = Math.ceil;';
// (And GLSL's vectors' functions, as the JavaScript they write asks them:
// ivec3, uvec4 made from numbers (one, or each); add3, sub3 (see vadd,
// vsub: whole numbers only, so that their calls stay of one kind and fast);
// any, lessThan, greaterThanEqual, part by part. The rule: a shim only for a
// GLSL builtin called as a function, and exact on arrays and numbers;
// operators, swizzles and conversions go through the writer.)
export const AS_GLSL_VEC =
  "const num = (x) => { if (typeof x !== 'number') throw new Error('a vector from ' + typeof x + ', not numbers'); return x; }, ivec3 = (x, y = x, z = x) => [num(x), num(y), num(z)], uvec4 = (x, y = x, z = x, w = x) => [num(x), num(y), num(z), num(w)], add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], any = (b) => b.some((x) => x), lessThan = (a, b) => a.map((x, i) => x < b[i]), greaterThanEqual = (a, b) => a.map((x, i) => x >= b[i]);";
// Their text in JavaScript, where vectors are arrays: each component of
// the names given, and of any element of a table (L.x, SLO[k].y, GUP[k].w),
// as an element (L[0], SLO[k][1], GUP[k][3]).
export function arrays(text, names) {
  const name = new RegExp(`(${[...names.map((n) => `\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '\\]'].join('|')})\\.([xyzw])\\b`, 'g');
  return text.replace(name, (_, v, a) => `${v}[${'xyzw'.indexOf(a)}]`);
}
// And whole numbers as JavaScript has them: GLSL's unsigned literals (7u)
// as plain, its shifts right as unsigned ones (for text whose shifts right
// are all of uints). (With int and uint as GLSL's: see AS_GLSL. Division is
// the writer's to say: JavaScript's is not whole. Like arrays, it rewrites
// the text's comments too.)
export const unsigned = (text) => text.replace(/\b(0x[0-9a-f]+|\d+)u\b/gi, '$1').replace(/(?<!>)>>(?!>)/g, '>>>');
