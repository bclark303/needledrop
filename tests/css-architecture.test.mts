import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readProjectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('keeps global CSS limited to tokens, reset and accessibility defaults', () => {
  const globals = readProjectFile('app/globals.css');

  assert.match(globals, /:root\s*{/);
  assert.match(globals, /prefers-reduced-motion/);
  assert.doesNotMatch(globals, /\.app-shell|\.settings-panel|\.record-grid|\.turntable-/);
});

test('loads one application stylesheet after the global foundation', () => {
  const layout = readProjectFile('app/layout.tsx');

  assert.match(layout, /import '\.\/globals\.css';\s*import '\.\/needledrop\.css';/);
  assert.doesNotMatch(layout, /discogs\.css/);
});

test('uses feature sections and canonical design-token names', () => {
  const css = readProjectFile('app/needledrop.css');

  assert.doesNotMatch(css, /\/\*\s*v\d+\.\d+/i);
  assert.doesNotMatch(css, /--panel2|--panel3/);
  assert.match(css, /\/\* Shared interface primitives \*\//);
  assert.match(css, /\/\* Release metadata and pressing details \*\//);
});
