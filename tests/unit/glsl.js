// What a GLSL program would come to if every call were written out in place,
// as the GPU's compiler (Apple's, under Chrome) does: a rough measure of how
// long it takes to build, since that grows with it. Comments and the #if
// EXACT branches not taken are left out; functions are found by their
// headers, calls by their names (an overload counts by its first definition).

const HEADER = /\b(?:void|float|int|bool|uint|[iu]?vec[234])\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;

function preprocess(src) {
  src = src.replace(/\/\/.*$/gm, '');
  const exact = /#define EXACT 1/.test(src);
  const out = [];
  const taken = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#if ')) taken.push(t === '#if EXACT' ? exact : t === '#if !EXACT' ? !exact : true);
    else if (t === '#else') taken.push(!taken.pop());
    else if (t === '#endif') taken.pop();
    else if (taken.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}

const tokens = (s) => (s.match(/[A-Za-z_]\w*|\d+\.?\d*|[^\s\w]/g) ?? []).length;

// For a program's source: how many times each function would be written out
// within main, and how many tokens main would come to.
export function inlined(source) {
  const src = preprocess(source);
  const body = {};
  for (let m; (m = HEADER.exec(src)); ) {
    let i = HEADER.lastIndex;
    for (let depth = 1; depth; i++) depth += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0;
    body[m[1]] ??= src.slice(HEADER.lastIndex, i - 1);
  }
  const names = Object.keys(body);
  const calls = {};
  for (const n of names) {
    calls[n] = names.filter((c) => c !== n).map((c) => [c, (body[n].match(new RegExp(`\\b${c}\\s*\\(`, 'g')) ?? []).length]).filter(([, k]) => k);
  }
  const copies = {};
  const walk = (n, k) => {
    copies[n] = (copies[n] ?? 0) + k;
    for (const [c, j] of calls[n]) walk(c, k * j);
  };
  walk('main', 1);
  const size = {};
  const sizeOf = (n) => (size[n] ??= tokens(body[n]) + calls[n].reduce((s, [c, k]) => s + k * sizeOf(c), 0));
  return { copies, tokens: sizeOf('main') };
}
