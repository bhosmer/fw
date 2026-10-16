import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const { SCHEMES, loadScheme, saveScheme } = await import('../../src/schemes.js');

beforeEach(() => store.clear());

test('schemes have distinct names', () => {
  const names = SCHEMES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

test('a first visit starts in alhambra', () => {
  assert.equal(SCHEMES[loadScheme()].name, 'alhambra');
});

test('a chosen scheme is remembered', () => {
  saveScheme(SCHEMES.findIndex((s) => s.name === 'nocturne'));
  assert.equal(SCHEMES[loadScheme()].name, 'nocturne');
});

test('a remembered scheme that no longer exists falls back to the first', () => {
  store.set('fw.scheme', 'blueprint');
  assert.equal(SCHEMES[loadScheme()].name, 'alhambra');
});
