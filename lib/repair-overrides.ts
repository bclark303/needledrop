import { DatabaseSync } from 'node:sqlite';
import { getDatabasePath } from './db';

export type AlbumRepairOverrides = {
  albumId: string;
  searchTitle?: string;
  folderName?: string;
  updatedAt?: string;
};

let database: DatabaseSync | null = null;

function db() {
  if (database) return database;
  database = new DatabaseSync(getDatabasePath());
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS album_repair_overrides (
      album_id TEXT PRIMARY KEY,
      search_title TEXT,
      folder_name TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

export function getAlbumRepairOverrides(albumId: string): AlbumRepairOverrides {
  const row = db().prepare('SELECT * FROM album_repair_overrides WHERE album_id=?').get(albumId) as Record<string, unknown> | undefined;
  return {
    albumId,
    searchTitle: cleanOptional(row?.search_title),
    folderName: cleanOptional(row?.folder_name),
    updatedAt: cleanOptional(row?.updated_at),
  };
}

export function saveAlbumRepairOverrides(albumId: string, patch: { searchTitle?: string | null; folderName?: string | null }) {
  const current = getAlbumRepairOverrides(albumId);
  const searchTitle = patch.searchTitle === undefined ? current.searchTitle : cleanOptional(patch.searchTitle);
  const folderName = patch.folderName === undefined ? current.folderName : cleanOptional(patch.folderName);

  if (!searchTitle && !folderName) {
    db().prepare('DELETE FROM album_repair_overrides WHERE album_id=?').run(albumId);
    return getAlbumRepairOverrides(albumId);
  }

  const updatedAt = new Date().toISOString();
  db().prepare(`
    INSERT INTO album_repair_overrides(album_id, search_title, folder_name, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(album_id) DO UPDATE SET
      search_title=excluded.search_title,
      folder_name=excluded.folder_name,
      updated_at=excluded.updated_at
  `).run(albumId, searchTitle || null, folderName || null, updatedAt);

  return { albumId, searchTitle, folderName, updatedAt };
}

export function effectiveRepairSearchTitle(albumId: string, fallbackTitle: string) {
  return getAlbumRepairOverrides(albumId).searchTitle || fallbackTitle;
}

export function effectiveRepairFolderName(albumId: string, fallbackTitle: string) {
  return getAlbumRepairOverrides(albumId).folderName || fallbackTitle;
}

function cleanOptional(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || undefined;
}
