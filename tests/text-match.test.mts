import assert from 'node:assert/strict';
import test from 'node:test';
import { compactMatchText, normalizeMatchText, titleSimilarity } from '../lib/text-match.ts';

test('normalizes provider punctuation and word boundaries', () => {
  assert.equal(normalizeMatchText('God-Smäck (Remastered)'), 'god smack');
  assert.equal(compactMatchText('Sick Man'), 'sickman');
});

test('treats formatting-only title differences as near-exact matches', () => {
  assert.equal(titleSimilarity('God Smack', 'Godsmack'), 0.99);
  assert.equal(titleSimilarity('Sick Man', 'Sickman'), 0.99);
});

test('does not broadly match unrelated titles', () => {
  assert.equal(titleSimilarity('Dirt', 'Nevermind'), 0);
});
