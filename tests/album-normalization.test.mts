import assert from 'node:assert/strict';
import test from 'node:test';
import {
  albumLookupTitles,
  normalizedAlbumIdentity,
  parseSplitDiscTitle,
  splitDiscGroupKey,
} from '../lib/album-normalization.ts';

test('recognizes strict multi-disc title suffixes', () => {
  assert.deepEqual(parseSplitDiscTitle('The Wall - CD 02'), {
    baseTitle: 'The Wall',
    discNumber: 2,
  });
  assert.deepEqual(parseSplitDiscTitle('Mellon Collie [Disc 1]'), {
    baseTitle: 'Mellon Collie',
    discNumber: 1,
  });
  assert.equal(parseSplitDiscTitle('Volume 2'), null);
});

test('builds one identity for members of a split-disc album', () => {
  const first = splitDiscGroupKey({ artist: 'Pink Floyd', name: 'The Wall CD 1', year: 1979 });
  const second = splitDiscGroupKey({ artist: 'Pink Floyd', name: 'The Wall CD 2', year: 1979 });
  assert.equal(first?.key, second?.key);
  assert.equal(first?.discNumber, 1);
  assert.equal(second?.discNumber, 2);
});

test('keeps literal lookup titles before progressively cleaner fallbacks', () => {
  assert.deepEqual(albumLookupTitles('Dirt (UK 1992 Remastered)'), [
    'Dirt (UK 1992 Remastered)',
    'Dirt',
  ]);
});

test('normalizes punctuation and accents for conservative duplicate matching', () => {
  assert.equal(
    normalizedAlbumIdentity("Sgt. Pepper’s Lonely Hearts Club Band"),
    'sgt pepper s lonely hearts club band',
  );
});
