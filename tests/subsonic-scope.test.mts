import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeNavidromeParams } from '../lib/navidrome-library.ts';

test('adds the selected Navidrome library to inventory and search requests', () => {
  assert.deepEqual(
    scopeNavidromeParams('getAlbumList2', { type: 'newest', size: 100 }, '12'),
    { type: 'newest', size: 100, musicFolderId: '12' },
  );
  assert.deepEqual(
    scopeNavidromeParams('search3', { query: 'Beatles' }, '12'),
    { query: 'Beatles', musicFolderId: '12' },
  );
});

test('does not scope direct media operations or override an explicit library', () => {
  const direct = { id: 'album-id' };
  assert.equal(scopeNavidromeParams('getAlbum', direct, '12'), direct);
  assert.deepEqual(
    scopeNavidromeParams('search3', { query: 'Beatles', musicFolderId: '7' }, '12'),
    { query: 'Beatles', musicFolderId: '7' },
  );
});

test('leaves compatible requests unchanged when all libraries are selected', () => {
  const params = { type: 'alphabeticalByArtist', size: 500 };
  assert.equal(scopeNavidromeParams('getAlbumList2', params, ''), params);
});
