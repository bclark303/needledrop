import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('verification excludes historical album rows from the current collection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'needledrop-verify-'));
  const databasePath = path.join(directory, 'needledrop.db');
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE albums (
        album_id TEXT PRIMARY KEY, artist TEXT, title TEXT, artwork_mode TEXT,
        canonical_artwork_id INTEGER, navidrome_cover_art TEXT, updated_at TEXT
      );
      CREATE TABLE artwork (
        id INTEGER PRIMARY KEY, album_id TEXT, source TEXT, scope TEXT, role TEXT,
        remote_url TEXT, user_selected INTEGER
      );
      CREATE TABLE album_meta (album_id TEXT PRIMARY KEY, payload TEXT);
      CREATE TABLE album_merges (alias_id TEXT PRIMARY KEY, canonical_id TEXT, created_at TEXT);
      CREATE TABLE system_kv (key TEXT PRIMARY KEY, value TEXT);
    `);
    const insertAlbum = database.prepare('INSERT INTO albums VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertAlbum.run('disc-1', 'The Beatles', "Sgt. Pepper's Lonely Hearts Club Band - CD 1", 'auto', null, 'cover-1', '2026-09-02T13:00:00Z');
    insertAlbum.run('disc-2', 'The Beatles', "Sgt. Pepper's Lonely Hearts Club Band - CD 2", 'auto', null, 'cover-2', '2026-09-02T13:00:00Z');
    insertAlbum.run('stale-copy', 'The Beatles', "Sgt. Pepper's Lonely Hearts Club Band - CD 1", 'auto', null, 'old-cover', '2026-08-01T00:00:00Z');
    database.prepare('INSERT INTO album_merges VALUES (?, ?, ?)').run('disc-2', 'disc-1', '2026-09-02T13:00:01Z');
    database.prepare('INSERT INTO system_kv VALUES (?, ?)').run('library_scan_status', JSON.stringify({
      state: 'complete',
      startedAt: '2026-09-02T12:59:00Z',
      albums: 1,
    }));
  } finally {
    database.close();
  }

  try {
    const output = execFileSync(process.execPath, ['scripts/verify-collection.mjs', databasePath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const report = JSON.parse(output);
    assert.equal(report.database.indexedAlbums, 2);
    assert.equal(report.database.historicalIndexedRows, 3);
    assert.equal(report.database.visibleAlbums, 1);
    assert.equal(report.collection.sgtPepper.resolved, true);
    assert.deepEqual(report.collection.sgtPepper.indexedCopies.map((album: { albumId: string }) => album.albumId), ['disc-1', 'disc-2']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
