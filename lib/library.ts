import { DatabaseSync } from 'node:sqlite';
import type { Album, AlbumDetail, Song } from '@/components/types';
import { getDatabasePath, getSystemJson, indexAlbums, setSystemJson } from './db';
import { logicalAlbumTitle, normalizedAlbumIdentity, parseSplitDiscTitle, splitDiscGroupKey } from './album-normalization';
import { startEnrichment } from './enrichment';
import { subsonic } from './subsonic';

export type LibraryScanStatus = {
  state: 'idle' | 'running' | 'complete' | 'error';
  phase?: 'starting' | 'navidrome' | 'syncing' | 'enriching';
  albums?: number;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
};

export type DuplicateAlbum = {
  id: string;
  artist: string;
  name: string;
  year?: number;
  coverArt: string;
};

export type DuplicateGroup = {
  key: string;
  artist: string;
  title: string;
  albums: DuplicateAlbum[];
};

export type MergeRecord = {
  aliasId: string;
  aliasArtist: string;
  aliasTitle: string;
  canonicalId: string;
  canonicalArtist: string;
  canonicalTitle: string;
  createdAt: string;
};

let libraryDatabase: DatabaseSync | null = null;
let scanRunning: Promise<void> | null = null;

function connection() {
  // Ensure the canonical database schema exists before opening the auxiliary
  // connection used for merge bookkeeping.
  indexAlbums([]);
  if (libraryDatabase) return libraryDatabase;
  libraryDatabase = new DatabaseSync(getDatabasePath());
  libraryDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS album_merges (
      alias_id TEXT PRIMARY KEY,
      canonical_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_album_merges_canonical ON album_merges(canonical_id);
  `);
  return libraryDatabase;
}

export function getLibraryScanStatus(): LibraryScanStatus {
  return getSystemJson<LibraryScanStatus>('library_scan_status') || { state: 'idle' };
}

export function startLibraryRescan() {
  if (scanRunning) return getLibraryScanStatus();
  const status: LibraryScanStatus = {
    state: 'running',
    phase: 'starting',
    startedAt: new Date().toISOString(),
    message: 'Starting Navidrome library scan…',
  };
  setSystemJson('library_scan_status', status);
  scanRunning = runLibraryRescan(status).finally(() => { scanRunning = null; });
  return status;
}

async function runLibraryRescan(initial: LibraryScanStatus) {
  let status = initial;
  try {
    status = { ...status, phase: 'navidrome', message: 'Asking Navidrome to rescan its music library…' };
    setSystemJson('library_scan_status', status);

    // Navidrome implements the Subsonic scan endpoints. Older or restricted
    // servers may reject them; in that case NeedleDrop still refreshes its own
    // index from whatever Navidrome currently exposes.
    try {
      await subsonic('startScan', { fullScan: false });
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await delay(2000);
        const scan = await subsonic('getScanStatus').catch(() => null);
        const scanning = Boolean(scan?.scanStatus?.scanning);
        const count = Number(scan?.scanStatus?.count || 0);
        status = {
          ...status,
          phase: 'navidrome',
          message: scanning
            ? `Navidrome is scanning${count ? ` · ${count} items processed` : ''}…`
            : 'Navidrome scan complete. Refreshing NeedleDrop…',
        };
        setSystemJson('library_scan_status', status);
        if (!scanning) break;
      }
    } catch {
      status = { ...status, message: 'Navidrome scan endpoint unavailable. Refreshing NeedleDrop index…' };
      setSystemJson('library_scan_status', status);
    }

    status = { ...status, phase: 'syncing', message: 'Reading the complete album list from Navidrome…' };
    setSystemJson('library_scan_status', status);
    const albums = await loadAllAlbums();
    indexAlbums(albums);
    const visible = prepareVisibleAlbums(albums);

    status = {
      ...status,
      phase: 'enriching',
      albums: visible.length,
      message: `Indexed ${visible.length} logical albums. Checking metadata and artwork…`,
    };
    setSystemJson('library_scan_status', status);
    startEnrichment(visible, false);

    status = {
      ...status,
      state: 'complete',
      phase: undefined,
      albums: visible.length,
      finishedAt: new Date().toISOString(),
      message: `Library rescan complete · ${visible.length} logical albums indexed.`,
    };
    setSystemJson('library_scan_status', status);
  } catch (error) {
    setSystemJson('library_scan_status', {
      ...status,
      state: 'error',
      phase: undefined,
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Library rescan failed',
    } satisfies LibraryScanStatus);
  }
}

export async function loadAllAlbums() {
  const albums: Album[] = [];
  const seen = new Set<string>();
  const size = 500;

  for (let offset = 0; offset < 50000; offset += size) {
    const root = await subsonic('getAlbumList2', { type: 'alphabeticalByArtist', size, offset });
    const page = (root.albumList2?.album || []) as Album[];
    for (const album of page) {
      if (!album?.id || seen.has(album.id)) continue;
      seen.add(album.id);
      albums.push(album);
    }
    if (page.length < size) break;
  }

  return albums;
}

export function prepareVisibleAlbums<T extends Album>(albums: T[]): T[] {
  autoMergeSplitDiscAlbums(albums);
  return filterMergedAlbums(albums).map((album) => ({
    ...album,
    name: displayAlbumTitle(album.id, album.name),
  }));
}

export function autoMergeSplitDiscAlbums(albums: Array<Pick<Album, 'id' | 'artist' | 'name' | 'year'>>) {
  if (albums.length < 2) return;
  const db = connection();
  const existingRows = db.prepare('SELECT alias_id, canonical_id FROM album_merges').all() as Array<{ alias_id: string; canonical_id: string }>;
  const existing = new Map(existingRows.map((row) => [String(row.alias_id), String(row.canonical_id)]));
  const groups = new Map<string, Array<{ album: Pick<Album, 'id' | 'artist' | 'name' | 'year'>; baseTitle: string; discNumber: number }>>();

  for (const album of albums) {
    const split = splitDiscGroupKey(album);
    if (!split) continue;
    const list = groups.get(split.key) || [];
    list.push({ album, baseTitle: split.baseTitle, discNumber: split.discNumber });
    groups.set(split.key, list);
  }

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const discNumbers = entries.map((entry) => entry.discNumber);
    if (!discNumbers.includes(1) || new Set(discNumbers).size !== discNumbers.length) continue;
    const ordered = [...entries].sort((a, b) => a.discNumber - b.discNumber || a.album.id.localeCompare(b.album.id));
    const canonical = ordered.find((entry) => entry.discNumber === 1);
    if (!canonical) continue;
    const ids = new Set(ordered.map((entry) => entry.album.id));
    const conflicts = ordered.some((entry) => {
      const mapped = existing.get(entry.album.id);
      return Boolean(mapped && mapped !== canonical.album.id && !ids.has(mapped));
    });
    if (conflicts || existing.has(canonical.album.id)) continue;

    const aliases = ordered
      .filter((entry) => entry.album.id !== canonical.album.id && existing.get(entry.album.id) !== canonical.album.id)
      .map((entry) => entry.album.id);
    if (!aliases.length) continue;
    mergeAlbums(canonical.album.id, aliases);
    aliases.forEach((aliasId) => existing.set(aliasId, canonical.album.id));
  }
}

export function filterMergedAlbums<T extends { id: string }>(albums: T[]): T[] {
  const rows = connection().prepare('SELECT alias_id FROM album_merges').all() as Array<{ alias_id: string }>;
  if (!rows.length) return albums;
  const hidden = new Set(rows.map((row) => String(row.alias_id)));
  return albums.filter((album) => !hidden.has(album.id));
}

export function resolveCanonicalAlbumId(albumId: string) {
  const row = connection().prepare('SELECT canonical_id FROM album_merges WHERE alias_id=?').get(albumId) as { canonical_id?: string } | undefined;
  return row?.canonical_id || albumId;
}

export function getMergedAlbumIds(albumId: string) {
  const canonicalId = resolveCanonicalAlbumId(albumId);
  const rows = connection().prepare('SELECT alias_id FROM album_merges WHERE canonical_id=? ORDER BY alias_id').all(canonicalId) as Array<{ alias_id: string }>;
  return [canonicalId, ...rows.map((row) => String(row.alias_id))];
}

export function displayAlbumTitle(albumId: string, fallbackTitle: string) {
  if (getMergedAlbumIds(albumId).length < 2) return fallbackTitle;
  return logicalAlbumTitle(fallbackTitle);
}

export function combineMergedAlbumDetails(albums: AlbumDetail[], canonicalId: string): AlbumDetail {
  const canonical = albums.find((album) => album.id === canonicalId) || albums[0];
  if (!canonical || albums.length < 2 || !isSplitDiscFamily(albums)) return canonical;

  const baseTitle = parseSplitDiscTitle(canonical.name)?.baseTitle || logicalAlbumTitle(albums[0].name);
  const members = albums
    .map((album) => ({ album, split: parseSplitDiscTitle(album.name)! }))
    .sort((a, b) => a.split.discNumber - b.split.discNumber || a.album.id.localeCompare(b.album.id));
  const seen = new Set<string>();
  const songs: Song[] = [];

  for (const member of members) {
    for (const song of member.album.song || []) {
      if (!song?.id || seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push({
        ...song,
        album: baseTitle,
        discNumber: member.split.discNumber,
      });
    }
  }

  songs.sort((a, b) =>
    Number(a.discNumber || 1) - Number(b.discNumber || 1) ||
    Number(a.track || Number.MAX_SAFE_INTEGER) - Number(b.track || Number.MAX_SAFE_INTEGER) ||
    a.title.localeCompare(b.title),
  );

  const duration = songs.reduce((sum, song) => sum + Number(song.duration || 0), 0);
  return {
    ...canonical,
    name: baseTitle,
    songCount: songs.length,
    duration: duration || canonical.duration,
    song: songs,
  };
}

export function listDuplicateGroups(): DuplicateGroup[] {
  const db = connection();
  const hiddenRows = db.prepare('SELECT alias_id FROM album_merges').all() as Array<{ alias_id: string }>;
  const hidden = new Set(hiddenRows.map((row) => String(row.alias_id)));
  const rows = db.prepare(`
    SELECT album_id, artist, title, year
    FROM albums
    ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE, year, album_id
  `).all() as Array<Record<string, unknown>>;

  const groups = new Map<string, DuplicateAlbum[]>();
  for (const row of rows) {
    const id = String(row.album_id || '');
    if (!id || hidden.has(id)) continue;
    const artist = String(row.artist || '');
    const title = String(row.title || '');
    const key = `${normalizeIdentity(artist)}\u0000${normalizeIdentity(title)}`;
    if (!artist || !title || key === '\u0000') continue;
    const list = groups.get(key) || [];
    list.push({
      id,
      artist,
      name: title,
      year: row.year == null ? undefined : Number(row.year),
      coverArt: `nd:${id}`,
    });
    groups.set(key, list);
  }

  return [...groups.entries()]
    .filter(([, albums]) => albums.length > 1)
    .map(([key, albums]) => ({ key, artist: albums[0].artist, title: albums[0].name, albums }))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
}

export function listMerges(): MergeRecord[] {
  const rows = connection().prepare(`
    SELECT m.alias_id, m.canonical_id, m.created_at,
           a.artist AS alias_artist, a.title AS alias_title,
           c.artist AS canonical_artist, c.title AS canonical_title
    FROM album_merges m
    LEFT JOIN albums a ON a.album_id=m.alias_id
    LEFT JOIN albums c ON c.album_id=m.canonical_id
    ORDER BY c.artist COLLATE NOCASE, c.title COLLATE NOCASE, a.album_id
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    aliasId: String(row.alias_id),
    aliasArtist: String(row.alias_artist || ''),
    aliasTitle: String(row.alias_title || ''),
    canonicalId: String(row.canonical_id),
    canonicalArtist: String(row.canonical_artist || ''),
    canonicalTitle: String(row.canonical_title || ''),
    createdAt: String(row.created_at || ''),
  }));
}

export function mergeAlbums(canonicalId: string, aliasIds: string[]) {
  const db = connection();
  const canonical = db.prepare('SELECT album_id FROM albums WHERE album_id=?').get(canonicalId) as { album_id?: string } | undefined;
  if (!canonical?.album_id) throw new Error('Canonical album was not found in the NeedleDrop index');
  const aliases = [...new Set(aliasIds.filter((id) => id && id !== canonicalId))];
  if (!aliases.length) return;

  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM album_merges WHERE alias_id=?').run(canonicalId);
    const merge = db.prepare(`
      INSERT INTO album_merges(alias_id, canonical_id, created_at) VALUES(?, ?, ?)
      ON CONFLICT(alias_id) DO UPDATE SET canonical_id=excluded.canonical_id, created_at=excluded.created_at
    `);
    const copyArtwork = db.prepare(`
      INSERT OR IGNORE INTO artwork(album_id, source, scope, role, source_key, source_id, remote_url, width, height, user_selected, created_at, updated_at)
      SELECT ?, source, scope, role, source_key, source_id, remote_url, width, height, 0, created_at, updated_at
      FROM artwork WHERE album_id=?
    `);
    const copyValues = db.prepare(`
      INSERT OR IGNORE INTO metadata_values(album_id, field, value_json, source, source_id, confidence, selected, updated_at)
      SELECT ?, field, value_json, source, source_id, confidence, 0, updated_at
      FROM metadata_values WHERE album_id=?
    `);

    for (const aliasId of aliases) {
      const exists = db.prepare('SELECT album_id FROM albums WHERE album_id=?').get(aliasId) as { album_id?: string } | undefined;
      if (!exists?.album_id) continue;
      merge.run(aliasId, canonicalId, now);
      copyArtwork.run(canonicalId, aliasId);
      copyValues.run(canonicalId, aliasId);
      const targetMeta = db.prepare('SELECT album_id FROM album_meta WHERE album_id=?').get(canonicalId);
      if (!targetMeta) {
        db.prepare(`INSERT OR IGNORE INTO album_meta(album_id, payload, updated_at) SELECT ?, payload, updated_at FROM album_meta WHERE album_id=?`).run(canonicalId, aliasId);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function unmergeAlbum(aliasId: string) {
  connection().prepare('DELETE FROM album_merges WHERE alias_id=?').run(aliasId);
}

function isSplitDiscFamily(albums: AlbumDetail[]) {
  const parsed = albums.map((album) => ({
    album,
    split: parseSplitDiscTitle(album.name),
  }));
  if (parsed.some((entry) => !entry.split)) return false;
  const first = parsed[0];
  const artist = normalizedAlbumIdentity(first.album.artist);
  const title = normalizedAlbumIdentity(first.split!.baseTitle);
  const year = first.album.year || undefined;
  const discNumbers = new Set<number>();
  for (const entry of parsed) {
    if (normalizedAlbumIdentity(entry.album.artist) !== artist) return false;
    if (normalizedAlbumIdentity(entry.split!.baseTitle) !== title) return false;
    if (year && entry.album.year && entry.album.year !== year) return false;
    if (discNumbers.has(entry.split!.discNumber)) return false;
    discNumbers.add(entry.split!.discNumber);
  }
  return discNumbers.has(1) && discNumbers.size === albums.length;
}

function normalizeIdentity(value: string) {
  return normalizedAlbumIdentity(value);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
