import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { Album, VinylMeta } from '@/components/types';

const dataDir = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const databaseFile = path.join(dataDir, 'needledrop.db');
let database: DatabaseSync | null = null;

export type AlbumRecord = {
  albumId: string;
  artist: string;
  title: string;
  year?: number;
  navidromeCoverArt?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  lastfmMbid?: string;
  lastfmUrl?: string;
  lastfmListeners?: number;
  lastfmPlaycount?: number;
  lastfmSummary?: string;
  lastfmTags?: string[];
  artworkMode: 'auto' | 'navidrome' | 'candidate';
  canonicalArtworkId?: number;
  enrichmentStatus?: string;
  enrichmentError?: string;
  enrichedAt?: string;
};

export type ArtworkCandidate = {
  id: number;
  albumId: string;
  source: 'discogs' | 'coverartarchive' | 'navidrome' | 'manual';
  scope: 'exact-release' | 'release-group' | 'library' | 'manual';
  role: string;
  sourceKey: string;
  sourceId?: string;
  remoteUrl?: string;
  width?: number;
  height?: number;
  userSelected: boolean;
};

export type EnrichmentStatus = {
  state: 'idle' | 'running' | 'complete' | 'error';
  total: number;
  completed: number;
  matched: number;
  artworkResolved: number;
  failed: number;
  currentAlbum?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
};

function db() {
  if (database) return database;
  fs.mkdirSync(dataDir, { recursive: true });
  database = new DatabaseSync(databaseFile);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS system_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS album_meta (
      album_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      album_id TEXT PRIMARY KEY,
      artist TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      year INTEGER,
      navidrome_cover_art TEXT,
      musicbrainz_release_id TEXT,
      musicbrainz_release_group_id TEXT,
      lastfm_mbid TEXT,
      lastfm_url TEXT,
      lastfm_listeners INTEGER,
      lastfm_playcount INTEGER,
      lastfm_summary TEXT,
      lastfm_tags TEXT,
      artwork_mode TEXT NOT NULL DEFAULT 'auto',
      canonical_artwork_id INTEGER,
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      enrichment_error TEXT,
      enriched_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artwork (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      source TEXT NOT NULL,
      scope TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'front',
      source_key TEXT NOT NULL,
      source_id TEXT,
      remote_url TEXT,
      width INTEGER,
      height INTEGER,
      user_selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(album_id, source_key)
    );

    CREATE INDEX IF NOT EXISTS idx_artwork_album ON artwork(album_id, role);

    CREATE TABLE IF NOT EXISTS metadata_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      field TEXT NOT NULL,
      value_json TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'matched',
      selected INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(album_id, field, source, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_metadata_album ON metadata_values(album_id, field);
  `);
  migrateLegacy(database);
  return database;
}

function migrateLegacy(connection: DatabaseSync) {
  const marker = connection.prepare('SELECT value FROM system_kv WHERE key = ?').get('legacy_json_migrated_v1') as { value?: string } | undefined;
  if (marker?.value === 'true') return;

  const now = new Date().toISOString();
  const settingsPath = path.join(dataDir, 'settings.json');
  const metadataPath = path.join(dataDir, 'needledrop.json');

  connection.exec('BEGIN IMMEDIATE');
  try {
    if (fs.existsSync(settingsPath)) {
      const payload = fs.readFileSync(settingsPath, 'utf8');
      JSON.parse(payload);
      connection.prepare(`INSERT OR IGNORE INTO system_kv(key, value, updated_at) VALUES('app_settings', ?, ?)`).run(payload, now);
    }

    if (fs.existsSync(metadataPath)) {
      const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { albums?: Record<string, VinylMeta & { updatedAt?: string }> };
      const insert = connection.prepare(`
        INSERT OR REPLACE INTO album_meta(album_id, payload, updated_at)
        VALUES(?, ?, ?)
      `);
      for (const [albumId, value] of Object.entries(parsed.albums || {})) {
        insert.run(albumId, JSON.stringify(value), value.updatedAt || now);
      }
    }

    connection.prepare(`INSERT OR REPLACE INTO system_kv(key, value, updated_at) VALUES('legacy_json_migrated_v1', 'true', ?)`).run(now);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function getDatabasePath() {
  return databaseFile;
}

export function getSystemJson<T>(key: string): T | null {
  const row = db().prepare('SELECT value FROM system_kv WHERE key = ?').get(key) as { value?: string } | undefined;
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}

export function setSystemJson(key: string, value: unknown) {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO system_kv(key, value, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, JSON.stringify(value), now);
}

export function getAlbumMetaJson<T>(albumId: string): T | null {
  const row = db().prepare('SELECT payload FROM album_meta WHERE album_id = ?').get(albumId) as { payload?: string } | undefined;
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

export function setAlbumMetaJson(albumId: string, value: unknown) {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO album_meta(album_id, payload, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(album_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
  `).run(albumId, JSON.stringify(value), now);
}

export function indexAlbums(albums: Album[]) {
  const connection = db();
  const now = new Date().toISOString();
  const statement = connection.prepare(`
    INSERT INTO albums(album_id, artist, title, year, navidrome_cover_art, updated_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(album_id) DO UPDATE SET
      artist=excluded.artist,
      title=excluded.title,
      year=excluded.year,
      navidrome_cover_art=excluded.navidrome_cover_art,
      updated_at=excluded.updated_at
  `);
  connection.exec('BEGIN IMMEDIATE');
  try {
    for (const album of albums) statement.run(album.id, album.artist || '', album.name || '', album.year || null, album.coverArt || null, now);
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function getAlbumRecord(albumId: string): AlbumRecord | null {
  const row = db().prepare('SELECT * FROM albums WHERE album_id = ?').get(albumId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapAlbumRecord(row);
}

function mapAlbumRecord(row: Record<string, unknown>): AlbumRecord {
  let tags: string[] | undefined;
  if (typeof row.lastfm_tags === 'string' && row.lastfm_tags) {
    try { tags = JSON.parse(row.lastfm_tags) as string[]; } catch {}
  }
  return {
    albumId: String(row.album_id),
    artist: String(row.artist || ''),
    title: String(row.title || ''),
    year: row.year == null ? undefined : Number(row.year),
    navidromeCoverArt: row.navidrome_cover_art ? String(row.navidrome_cover_art) : undefined,
    musicbrainzReleaseId: row.musicbrainz_release_id ? String(row.musicbrainz_release_id) : undefined,
    musicbrainzReleaseGroupId: row.musicbrainz_release_group_id ? String(row.musicbrainz_release_group_id) : undefined,
    lastfmMbid: row.lastfm_mbid ? String(row.lastfm_mbid) : undefined,
    lastfmUrl: row.lastfm_url ? String(row.lastfm_url) : undefined,
    lastfmListeners: row.lastfm_listeners == null ? undefined : Number(row.lastfm_listeners),
    lastfmPlaycount: row.lastfm_playcount == null ? undefined : Number(row.lastfm_playcount),
    lastfmSummary: row.lastfm_summary ? String(row.lastfm_summary) : undefined,
    lastfmTags: tags,
    artworkMode: (row.artwork_mode === 'navidrome' || row.artwork_mode === 'candidate') ? row.artwork_mode : 'auto',
    canonicalArtworkId: row.canonical_artwork_id == null ? undefined : Number(row.canonical_artwork_id),
    enrichmentStatus: row.enrichment_status ? String(row.enrichment_status) : undefined,
    enrichmentError: row.enrichment_error ? String(row.enrichment_error) : undefined,
    enrichedAt: row.enriched_at ? String(row.enriched_at) : undefined,
  };
}

export function updateAlbumIdentity(albumId: string, patch: Partial<Omit<AlbumRecord, 'albumId' | 'artist' | 'title' | 'artworkMode'>>) {
  const current = getAlbumRecord(albumId);
  if (!current) return;
  const now = new Date().toISOString();
  db().prepare(`
    UPDATE albums SET
      musicbrainz_release_id=?, musicbrainz_release_group_id=?,
      lastfm_mbid=?, lastfm_url=?, lastfm_listeners=?, lastfm_playcount=?,
      lastfm_summary=?, lastfm_tags=?, enrichment_status=?, enrichment_error=?, enriched_at=?, updated_at=?
    WHERE album_id=?
  `).run(
    patch.musicbrainzReleaseId ?? current.musicbrainzReleaseId ?? null,
    patch.musicbrainzReleaseGroupId ?? current.musicbrainzReleaseGroupId ?? null,
    patch.lastfmMbid ?? current.lastfmMbid ?? null,
    patch.lastfmUrl ?? current.lastfmUrl ?? null,
    patch.lastfmListeners ?? current.lastfmListeners ?? null,
    patch.lastfmPlaycount ?? current.lastfmPlaycount ?? null,
    patch.lastfmSummary ?? current.lastfmSummary ?? null,
    JSON.stringify(patch.lastfmTags ?? current.lastfmTags ?? []),
    patch.enrichmentStatus ?? current.enrichmentStatus ?? 'pending',
    patch.enrichmentError ?? null,
    patch.enrichedAt ?? current.enrichedAt ?? null,
    now,
    albumId,
  );
}

export function upsertArtworkCandidate(input: Omit<ArtworkCandidate, 'id' | 'userSelected'> & { userSelected?: boolean }) {
  const connection = db();
  const now = new Date().toISOString();
  connection.prepare(`
    INSERT INTO artwork(album_id, source, scope, role, source_key, source_id, remote_url, width, height, user_selected, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(album_id, source_key) DO UPDATE SET
      source=excluded.source, scope=excluded.scope, role=excluded.role, source_id=excluded.source_id,
      remote_url=excluded.remote_url, width=excluded.width, height=excluded.height,
      user_selected=MAX(artwork.user_selected, excluded.user_selected), updated_at=excluded.updated_at
  `).run(
    input.albumId, input.source, input.scope, input.role, input.sourceKey, input.sourceId || null,
    input.remoteUrl || null, input.width || null, input.height || null, input.userSelected ? 1 : 0, now, now,
  );
  const row = connection.prepare('SELECT id FROM artwork WHERE album_id=? AND source_key=?').get(input.albumId, input.sourceKey) as { id: number };
  return Number(row.id);
}

export function listArtwork(albumId: string): ArtworkCandidate[] {
  const rows = db().prepare('SELECT * FROM artwork WHERE album_id=? ORDER BY user_selected DESC, id ASC').all(albumId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    albumId: String(row.album_id),
    source: String(row.source) as ArtworkCandidate['source'],
    scope: String(row.scope) as ArtworkCandidate['scope'],
    role: String(row.role),
    sourceKey: String(row.source_key),
    sourceId: row.source_id ? String(row.source_id) : undefined,
    remoteUrl: row.remote_url ? String(row.remote_url) : undefined,
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    userSelected: Number(row.user_selected) === 1,
  }));
}

export function getArtworkById(id: number): ArtworkCandidate | null {
  const row = db().prepare('SELECT * FROM artwork WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return listArtwork(String(row.album_id)).find((item) => item.id === id) || null;
}

export function setArtworkMode(albumId: string, mode: 'auto' | 'navidrome' | 'candidate', candidateId?: number) {
  const connection = db();
  if (mode === 'candidate' && candidateId) {
    connection.prepare('UPDATE artwork SET user_selected=CASE WHEN id=? THEN 1 ELSE 0 END WHERE album_id=?').run(candidateId, albumId);
  }
  connection.prepare('UPDATE albums SET artwork_mode=?, canonical_artwork_id=?, updated_at=? WHERE album_id=?')
    .run(mode, mode === 'candidate' ? candidateId || null : null, new Date().toISOString(), albumId);
}

export function getCanonicalArtwork(albumId: string, sourceOrder: string[] = ['discogs', 'coverartarchive', 'navidrome']) {
  const album = getAlbumRecord(albumId);
  if (!album) return { album: null, artwork: null as ArtworkCandidate | null, useNavidrome: false };
  if (album.artworkMode === 'navidrome') return { album, artwork: null as ArtworkCandidate | null, useNavidrome: true };
  if (album.artworkMode === 'candidate' && album.canonicalArtworkId) {
    return { album, artwork: getArtworkById(album.canonicalArtworkId), useNavidrome: false };
  }

  const candidates = listArtwork(albumId).filter((item) => item.role === 'front' && item.remoteUrl);
  const exact = candidates.filter((item) => item.scope === 'exact-release');
  const group = candidates.filter((item) => item.scope === 'release-group');
  const rank = (candidate: ArtworkCandidate) => {
    const sourceRank = sourceOrder.indexOf(candidate.source);
    return (candidate.userSelected ? -10000 : 0) + (candidate.scope === 'exact-release' ? -1000 : 0) + (sourceRank < 0 ? 100 : sourceRank);
  };
  const chosen = [...exact, ...group].sort((a, b) => rank(a) - rank(b))[0] || null;
  return { album, artwork: chosen, useNavidrome: !chosen && Boolean(album.navidromeCoverArt) };
}

export function upsertMetadataValue(albumId: string, field: string, value: unknown, source: string, sourceId = '', confidence = 'matched', selected = false) {
  db().prepare(`
    INSERT INTO metadata_values(album_id, field, value_json, source, source_id, confidence, selected, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(album_id, field, source, source_id) DO UPDATE SET
      value_json=excluded.value_json, confidence=excluded.confidence,
      selected=MAX(metadata_values.selected, excluded.selected), updated_at=excluded.updated_at
  `).run(albumId, field, JSON.stringify(value), source, sourceId, confidence, selected ? 1 : 0, new Date().toISOString());
}

export function getMetadataValues(albumId: string) {
  const rows = db().prepare('SELECT field, value_json, source, source_id, confidence, selected FROM metadata_values WHERE album_id=? ORDER BY selected DESC, id ASC').all(albumId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let value: unknown = row.value_json;
    try { value = JSON.parse(String(row.value_json)); } catch {}
    return { field: String(row.field), value, source: String(row.source), sourceId: String(row.source_id || ''), confidence: String(row.confidence), selected: Number(row.selected) === 1 };
  });
}

export function getEnrichmentStatus(): EnrichmentStatus {
  return getSystemJson<EnrichmentStatus>('enrichment_status') || { state: 'idle', total: 0, completed: 0, matched: 0, artworkResolved: 0, failed: 0 };
}

export function setEnrichmentStatus(status: EnrichmentStatus) {
  setSystemJson('enrichment_status', status);
}
