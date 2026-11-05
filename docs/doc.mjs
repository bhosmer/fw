#!/usr/bin/env node
// docs/architecture.md, held to the code. The doc stays hand-written; a
// marker after each `##` heading says which files the section covers, its
// byte budget, and the commit at which it was last read against them:
//
//   <!-- files: src/a.js,src/b.js,tests/  budget: 1500  verified: 1a2b3c4 -->
//
// and one after the `#` title gives the whole doc's budget. Named src/ files
// are watched; other entries (tests/, bench/) only say where those are
// covered. This script checks the doc against the code:
//   - every file under src/ is named by some section (a failure otherwise);
//   - every named file exists, and src/ files are named one by one;
//   - each section, and the whole, keeps within its budget (markers left
//     out);
//   - every `backticked` name is found in the section's files or the repo;
//   - phrases that tell history rather than what is (a warning);
//   - stale sections: a watched file has a commit after the last commit
//     that changed the section's prose, between `verified` and HEAD (a
//     warning; a `verified` that is not an ancestor of HEAD is stale too).
//
// Usage: node docs/doc.mjs check | affected | verify <section> | stale --json
// (DOC_REPO names another checkout, for the tests.)

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const DOC = 'docs/architecture.md';
const SECTION_MARK = /^<!-- files: (.*?)\s+budget: (\d+)\s+verified: (\S+) -->$/;
const TITLE_MARK = /^<!-- budget: (\d+) -->$/;
const bytes = (t) => Buffer.byteLength(t);

// A section's id: its heading in lower case, words joined by dashes.
export const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The doc in parts: the title and its budget, the text before the first
// section, and each section with its marker's fields and its prose (the
// heading and body, the marker left out).
export function parse(text) {
  const lines = text.split('\n');
  const doc = { title: null, budget: null, intro: [], sections: [] };
  let at = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('# ') && !doc.title) {
      doc.title = l;
      const m = TITLE_MARK.exec(lines[i + 1] ?? '');
      if (m) { doc.budget = Number(m[1]); i++; }
      continue;
    }
    if (l.startsWith('## ')) {
      const m = SECTION_MARK.exec(lines[i + 1] ?? '');
      at = { id: slug(l.slice(3)), heading: l.slice(3), marked: !!m, line: i + 1,
        files: m ? m[1].split(',').map((f) => f.trim()).filter(Boolean) : [], budget: m ? Number(m[2]) : null, verified: m ? m[3] : null, prose: [l] };
      doc.sections.push(at);
      if (m) i++;
      continue;
    }
    (at ? at.prose : doc.intro).push(l);
  }
  for (const s of doc.sections) s.text = s.prose.join('\n');
  doc.prose = [doc.title, ...doc.intro, ...doc.sections.map((s) => s.text)].join('\n');
  return doc;
}

// The doc with its markers taken out: what the text says.
export const strip = (text) => text.split('\n').filter((l) => !SECTION_MARK.test(l) && !TITLE_MARK.test(l)).join('\n');

const git = (repo, ...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });

// Every file under a folder of the repo.
function filesUnder(repo, folder) {
  const out = [];
  const walk = (rel) => {
    for (const f of readdirSync(join(repo, rel))) {
      const p = `${rel}/${f}`;
      if (statSync(join(repo, p)).isDirectory()) walk(p); else out.push(p);
    }
  };
  if (existsSync(join(repo, folder))) walk(folder);
  return out;
}
const isWatched = (f) => f.startsWith('src/') && !f.endsWith('/');

// The text a name is looked for in: a section's files, then the repo's
// tracked text files (the doc itself left out).
function corpus(repo) {
  const tracked = git(repo, 'ls-files').stdout.split('\n').filter((f) => f && f !== DOC && /\.(m?js|html|json|md|py|css|glsl)$/.test(f));
  const text = new Map();
  for (const f of tracked) if (existsSync(join(repo, f))) text.set(f, readFileSync(join(repo, f), 'utf8'));
  return text;
}

// Is a backticked name there? As written, or by its head (what comes before
// '(', '=', a space or '?', leading punctuation left out), or by the last
// part of a dotted head; a path (with a slash or a file's extension) must
// exist, in the repo or as some tracked file's name, and a path with a `*`
// must match some tracked file.
export function nameFound(name, inFiles, everywhere, repo, tracked) {
  const head = name.replace(/^[^\w$./*]+/, '').split(/[\s(=?]/)[0].replace(/[.,;:]+$/, '');
  const pathy = /\//.test(head) || /\.(m?js|html|json|md|py|css|glsl)$/.test(head);
  if (pathy && head.includes('*')) {
    const glob = new RegExp(`^${head.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
    return tracked.some((f) => glob.test(f));
  }
  if (pathy) return existsSync(join(repo, head)) || tracked.some((f) => f === head || f.endsWith('/' + head));
  const tries = [name, head, ...(head.includes('.') ? [head.split('.').pop()] : [])].filter((x) => x);
  const has = (hay, n) => (/^[\w$]+$/.test(n) ? new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(hay) : hay.includes(n));
  return tries.some((n) => inFiles.some((t) => has(t, n)) || everywhere.some((t) => has(t, n)));
}

// Phrases that tell how things came to be rather than how they are.
export const HISTORY = [/\bas it was\b/i, /\bas they were\b/i, /\bused to\b/i, /\bpreviously\b/i, /\bno longer\b/i, /\bany ?more\b/i, /\bformerly\b/i,
  /\bsince \d{4}-\d{2}-\d{2}\b/i, /\bas of\b/i, /\buntil recently\b/i, /\bsupersed/i, /\bwe tried\b/i];

// Which sections are stale, and why.
export function stale(repo, doc = parse(readFileSync(join(repo, DOC), 'utf8'))) {
  const head = git(repo, 'rev-parse', 'HEAD');
  if (head.status !== 0) return [];
  // The doc's prose at each commit that changed it, newest first.
  const changes = git(repo, 'log', '--format=%H', '--', DOC).stdout.split('\n').filter(Boolean);
  const proseAt = new Map();
  const sectionsAt = (sha) => {
    if (!proseAt.has(sha)) {
      const r = git(repo, 'show', `${sha}:${DOC}`);
      proseAt.set(sha, r.status === 0 ? new Map(parse(r.stdout).sections.map((s) => [s.id, s.text])) : new Map());
    }
    return proseAt.get(sha);
  };
  const atHead = sectionsAt('HEAD');
  const out = [];
  for (const s of doc.sections) {
    const watched = s.files.filter(isWatched);
    if (!watched.length) continue;
    if (!s.verified || git(repo, 'merge-base', '--is-ancestor', s.verified, 'HEAD').status !== 0) {
      out.push({ id: s.id, why: `verified at an unknown commit (${s.verified ?? 'none'})` });
      continue;
    }
    // The prose changed but not yet committed: newer than any commit.
    if (atHead.get(s.id) !== s.text) continue;
    // The last commit that changed this section's prose.
    let last = null;
    for (const sha of changes) {
      const parent = git(repo, 'rev-parse', '--verify', '-q', `${sha}^`).stdout.trim();
      if (!parent || sectionsAt(sha).get(s.id) !== sectionsAt(parent).get(s.id)) { last = sha; break; }
    }
    const commits = git(repo, 'log', '--format=%h', `${s.verified}..HEAD`, '--', ...watched).stdout.split('\n').filter(Boolean);
    const after = commits.filter((c) => !last || git(repo, 'merge-base', '--is-ancestor', c, last).status !== 0);
    if (after.length) out.push({ id: s.id, why: `${after.length} commit${after.length > 1 ? 's' : ''} to its files since it was read (${after.slice(0, 3).join(', ')}${after.length > 3 ? ', …' : ''})` });
  }
  return out;
}

// Everything check finds: failures, and warnings.
export function check(repo) {
  const text = readFileSync(join(repo, DOC), 'utf8');
  const doc = parse(text);
  const failures = [];
  const warnings = [];
  if (doc.budget == null) failures.push(`${DOC}: no "<!-- budget: N -->" after its title`);
  else if (bytes(doc.prose) > doc.budget) failures.push(`${DOC}: ${bytes(doc.prose)} bytes, over its budget of ${doc.budget}`);
  const tracked = git(repo, 'ls-files').stdout.split('\n').filter(Boolean);
  const all = corpus(repo);
  const everywhere = [...all.values()];
  const named = new Set();
  const texts = (s) => s.files.flatMap((f) => (f.endsWith('/') ? filesUnder(repo, f.slice(0, -1)) : [f])).map((f) => all.get(f) ?? (existsSync(join(repo, f)) && statSync(join(repo, f)).isFile() ? readFileSync(join(repo, f), 'utf8') : ''));
  for (const s of doc.sections) {
    const at = `${DOC}, "${s.heading}"`;
    if (!s.marked) { failures.push(`${at}: no marker after its heading`); continue; }
    if (bytes(s.text) > s.budget) failures.push(`${at}: ${bytes(s.text)} bytes, over its budget of ${s.budget}`);
    for (const f of s.files) {
      if (!existsSync(join(repo, f))) failures.push(`${at}: ${f} does not exist`);
      else if (f.startsWith('src/') && statSync(join(repo, f)).isDirectory()) failures.push(`${at}: ${f} is a folder; name src/ files one by one`);
      named.add(f.replace(/\/$/, ''));
    }
    const inFiles = texts(s);
    for (const m of s.text.matchAll(/`([^`]+)`/g)) {
      if (!nameFound(m[1], inFiles, everywhere, repo, tracked)) failures.push(`${at}: \`${m[1]}\` is in neither the section's files nor the repo`);
    }
  }
  for (const m of doc.intro.join('\n').matchAll(/`([^`]+)`/g)) {
    if (!nameFound(m[1], [], everywhere, repo, tracked)) failures.push(`${DOC}: \`${m[1]}\` is not in the repo`);
  }
  for (const f of filesUnder(repo, 'src')) if (!named.has(f)) failures.push(`${f} is in no section of ${DOC}: name it in the marker of the section that should say what it is`);
  text.split('\n').forEach((l, i) => {
    for (const re of HISTORY) {
      const m = re.exec(l);
      if (m && !SECTION_MARK.test(l)) warnings.push(`${DOC}:${i + 1}: "${m[0]}": say what is, not how it came to be`);
    }
  });
  for (const s of stale(repo, doc)) warnings.push(`stale: "${s.id}": ${s.why} (re-read it, then node docs/doc.mjs verify ${s.id})`);
  return { failures, warnings, doc };
}

// A section by its id or a unique start of it.
function section(doc, name) {
  const exact = doc.sections.find((s) => s.id === name);
  if (exact) return exact;
  const starts = doc.sections.filter((s) => s.id.startsWith(slug(name)));
  if (starts.length !== 1) throw new Error(`${starts.length ? 'more than one' : 'no'} section starts '${name}': ${doc.sections.map((s) => s.id).join(', ')}`);
  return starts[0];
}

export function run(argv, repo) {
  const [cmd, ...rest] = argv;
  const text = () => readFileSync(join(repo, DOC), 'utf8');
  if (cmd === 'check') {
    const { failures, warnings } = check(repo);
    return { code: failures.length ? 1 : 0, text: [...failures.map((f) => `FAIL ${f}`), ...warnings.map((w) => `warn ${w}`),
      failures.length ? `doc check: ${failures.length} failures` : 'doc check: passes'].join('\n') };
  }
  if (cmd === 'stale') {
    const found = stale(repo);
    return { code: 0, text: rest.includes('--json') ? JSON.stringify(found) : found.map((s) => `${s.id}: ${s.why}`).join('\n') || 'nothing stale' };
  }
  if (cmd === 'affected') {
    const staged = git(repo, 'diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean);
    const doc = parse(text());
    const lines = doc.sections.flatMap((s) => {
      const hit = staged.filter((f) => s.files.some((e) => (e.endsWith('/') ? f.startsWith(e) : f === e)));
      return hit.length ? [`${s.id}: ${hit.join(', ')}${hit.some((f) => !isWatched(f)) && !hit.some(isWatched) ? ' (covered by folder, not watched)' : ''}`] : [];
    });
    return { code: 0, text: lines.join('\n') || 'no section covers the staged files' };
  }
  if (cmd === 'verify') {
    if (!rest[0]) throw new Error('verify <section>');
    const doc = parse(text());
    const s = section(doc, rest[0]);
    const head = git(repo, 'rev-parse', '--short=7', 'HEAD').stdout.trim();
    const watched = s.files.filter(isWatched);
    const known = s.verified && git(repo, 'merge-base', '--is-ancestor', s.verified, 'HEAD').status === 0;
    const diff = !watched.length ? '(no watched files)' : known ? git(repo, 'diff', '--stat', `${s.verified}..HEAD`, '--', ...watched).stdout.trim() || '(no change)' : `(verified at an unknown commit: ${s.verified})`;
    const lines = text().split('\n');
    lines[s.line] = `<!-- files: ${s.files.join(',')}  budget: ${s.budget}  verified: ${head} -->`;
    writeFileSync(join(repo, DOC), lines.join('\n'));
    return { code: 0, text: `${s.text}\n\nSince ${s.verified}:\n${diff}\n\n"${s.id}" verified at ${head}.` };
  }
  return { code: 2, text: 'node docs/doc.mjs check | affected | verify <section> | stale --json' };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { code, text } = run(process.argv.slice(2), process.env.DOC_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    if (text) console.log(text);
    process.exitCode = code;
  } catch (e) {
    console.error(`doc: ${e.message}`);
    process.exitCode = 1;
  }
}
