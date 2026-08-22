import { DatabaseSync } from 'node:sqlite';
import type { AlbumDetail, DiscogsSide, DiscogsTrack, Song, VinylMeta } from '@/components/types';
import { getDatabasePath, indexAlbums } from './db';
import { getLidarrProgress, type LidarrAlbumRequest } from './lidarr';
import { startLibraryRescan } from './library';
import { subsonic } from './subsonic';
import { compactMatchText, titleSimilarity } from './text-match';

export type PlaybackProvider = 'navidrome';

export type TrackSource = {
  provider: PlaybackProvider;
  providerTrackId: string;
};

export type ReleaseTrackAvailability = {
  side: string;
  position: string;
  title: string;
  duration?: string;
  available: boolean;
  source?: TrackSource;
};

export type ReleaseAvailability = {
  releaseDefined: boolean;
  status: 'fully-playable' | 'partially-playable' | 'collection-only' | 'digital-library';
  totalTracks: number;
  availableTracks: number;
  missingTracks: ReleaseTrackAvailability[];
  tracks: ReleaseTrackAvailability[];
};

export type VirtualReleaseResolution = {
  album: AlbumDetail;
  meta: VinylMeta | null;
  availability: ReleaseAvailability;
};

export type LidarrRequestState =
  | 'searching'
  | 'downloading'
  | 'search-complete'
  | 'imported'
  | 'waiting-for-navidrome'
  | 'ready'
  | 'unknown';

export type LidarrRequestRecord = {
  id: number;
  albumId: string;
  releaseGroupMbid: string;
  missingTracks: Array<{ position: string; title: string }>;
  lidarrAlbumId: number;
  commandId?: number;
  baselineTrackFiles: number;
  state: LidarrRequestState;
  message?: string;
  scanTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
};

let database: DatabaseSync | null = null;

function db() {
  indexAlbums([]);
  if (database) return database;
  database = new DatabaseSync(getDatabasePath());
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS track_sources (
      album_id TEXT NOT NULL,
      release_key TEXT NOT NULL,
      position TEXT NOT NULL,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_track_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(album_id, release_key, position, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_track_sources_album ON track_sources(album_id, release_key);

    CREATE TABLE IF NOT EXISTS lidarr_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      release_group_mbid TEXT NOT NULL,
      missing_json TEXT NOT NULL,
      lidarr_album_id INTEGER NOT NULL,
      command_id INTEGER,
      baseline_track_files INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      message TEXT,
      scan_triggered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lidarr_requests_album ON lidarr_requests(album_id, id DESC);
  `);
  return database;
}

export async function resolveVirtualRelease(album: AlbumDetail, meta: VinylMeta | null): Promise<VirtualReleaseResolution> {
  indexAlbums([album]);
  if (!meta?.sides?.length) {
    return {
      album,
      meta,
      availability: {
        releaseDefined: false,
        status: album.song?.length ? 'digital-library' : 'collection-only',
        totalTracks: album.song?.length || 0,
        availableTracks: album.song?.length || 0,
        missingTracks: [],
        tracks: (album.song || []).map((song, index) => ({
          side: '',
          position: String(index + 1),
          title: song.title,
          available: true,
          source: { provider: 'navidrome', providerTrackId: song.id },
        })),
      },
    };
  }

  const releaseKey = releaseIdentity(meta);
  const baseSongs = [...(album.song || [])];
  const allSongs = new Map(baseSongs.map((song) => [song.id, song]));
  const used = new Set<string>();
  const updatedSides: DiscogsSide[] = [];
  const rows: ReleaseTrackAvailability[] = [];

  for (const side of meta.sides) {
    const updatedTracks: DiscogsTrack[] = [];
    for (const track of side.tracks) {
      let song: Song | undefined;

      if (track.navidromeSongId) {
        song = allSongs.get(track.navidromeSongId);
        if (!song) song = await loadSong(track.navidromeSongId).catch(() => undefined);
        if (song && !acceptableMatch(track, album, song)) song = undefined;
      }

      if (!song) {
        const cachedId = getCachedSource(album.id, releaseKey, track.position, track.title);
        if (cachedId && !used.has(cachedId)) {
          song = allSongs.get(cachedId) || await loadSong(cachedId).catch(() => undefined);
          if (song && !acceptableMatch(track, album, song)) song = undefined;
        }
      }

      if (!song) song = bestLocalMatch(track, album, baseSongs, used);
      if (!song) song = await searchNavidrome(track, album, used).catch(() => undefined);

      const nextTrack: DiscogsTrack = { ...track };
      if (song && !used.has(song.id)) {
        used.add(song.id);
        allSongs.set(song.id, song);
        nextTrack.navidromeSongId = song.id;
        const baseIndex = baseSongs.findIndex((candidate) => candidate.id === song!.id);
        nextTrack.navidromeIndex = baseIndex >= 0 ? baseIndex : undefined;
        saveCachedSource(album.id, releaseKey, track.position, track.title, song.id);
        rows.push({
          side: side.label,
          position: track.position,
          title: track.title,
          duration: track.duration,
          available: true,
          source: { provider: 'navidrome', providerTrackId: song.id },
        });
      } else {
        delete nextTrack.navidromeSongId;
        delete nextTrack.navidromeIndex;
        rows.push({
          side: side.label,
          position: track.position,
          title: track.title,
          duration: track.duration,
          available: false,
        });
      }
      updatedTracks.push(nextTrack);
    }
    updatedSides.push({ ...side, tracks: updatedTracks });
  }

  const songs = [...allSongs.values()];
  const totalTracks = rows.length;
  const availableTracks = rows.filter((row) => row.available).length;
  const missingTracks = rows.filter((row) => !row.available);
  const status: ReleaseAvailability['status'] = availableTracks === totalTracks && totalTracks
    ? 'fully-playable'
    : availableTracks > 0
      ? 'partially-playable'
      : 'collection-only';

  const warnings = missingTracks.map((track) => `${track.position || track.title}: “${track.title}” is not available from a configured playback source.`);
  return {
    album: { ...album, song: songs },
    meta: { ...meta, sides: updatedSides, trackMappingWarnings: warnings },
    availability: { releaseDefined: true, status, totalTracks, availableTracks, missingTracks, tracks: rows },
  };
}

export function recordLidarrRequest(
  albumId: string,
  releaseGroupMbid: string,
  missingTracks: Array<{ position: string; title: string }>,
  request: LidarrAlbumRequest,
) {
  const now = new Date().toISOString();
  const result = db().prepare(`
    INSERT INTO lidarr_requests(
      album_id, release_group_mbid, missing_json, lidarr_album_id, command_id,
      baseline_track_files, state, message, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, 'searching', ?, ?, ?)
  `).run(
    albumId,
    releaseGroupMbid,
    JSON.stringify(missingTracks),
    request.albumId,
    request.commandId || null,
    request.baselineTrackFiles,
    'Lidarr is searching for a suitable release.',
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

export function getLatestLidarrRequest(albumId: string): LidarrRequestRecord | null {
  const row = db().prepare('SELECT * FROM lidarr_requests WHERE album_id=? ORDER BY id DESC LIMIT 1').get(albumId) as Record<string, unknown> | undefined;
  return row ? mapRequest(row) : null;
}

export async function refreshLatestLidarrRequest(albumId: string, availability?: ReleaseAvailability) {
  const current = getLatestLidarrRequest(albumId);
  if (!current) return null;

  if (availability?.status === 'fully-playable') {
    updateRequest(current.id, 'ready', 'All selected-release tracks are now available in Navidrome.');
    return getLatestLidarrRequest(albumId);
  }

  if (current.state === 'ready') return current;
  const progress = await getLidarrProgress(current.lidarrAlbumId, current.commandId, current.baselineTrackFiles).catch(() => null);
  if (!progress) return current;

  let nextState: LidarrRequestState = progress.state;
  let message = progress.message;
  let scanTriggeredAt = current.scanTriggeredAt;
  if (progress.state === 'imported') {
    nextState = 'waiting-for-navidrome';
    message = 'Lidarr imported new audio. NeedleDrop asked Navidrome to rescan and is waiting for the new tracks.';
    if (!scanTriggeredAt) {
      startLibraryRescan();
      scanTriggeredAt = new Date().toISOString();
    }
  }
  updateRequest(current.id, nextState, message, scanTriggeredAt);
  return getLatestLidarrRequest(albumId);
}

function updateRequest(id: number, state: LidarrRequestState, message: string, scanTriggeredAt?: string) {
  db().prepare(`UPDATE lidarr_requests SET state=?, message=?, scan_triggered_at=COALESCE(?, scan_triggered_at), updated_at=? WHERE id=?`)
    .run(state, message, scanTriggeredAt || null, new Date().toISOString(), id);
}

function mapRequest(row: Record<string, unknown>): LidarrRequestRecord {
  let missingTracks: Array<{ position: string; title: string }> = [];
  try { missingTracks = JSON.parse(String(row.missing_json || '[]')); } catch {}
  return {
    id: Number(row.id),
    albumId: String(row.album_id),
    releaseGroupMbid: String(row.release_group_mbid),
    missingTracks,
    lidarrAlbumId: Number(row.lidarr_album_id),
    commandId: row.command_id == null ? undefined : Number(row.command_id),
    baselineTrackFiles: Number(row.baseline_track_files || 0),
    state: String(row.state || 'unknown') as LidarrRequestState,
    message: row.message ? String(row.message) : undefined,
    scanTriggeredAt: row.scan_triggered_at ? String(row.scan_triggered_at) : undefined,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function releaseIdentity(meta: VinylMeta) {
  if (meta.discogsReleaseId) return `discogs:${meta.discogsReleaseId}`;
  if (meta.musicbrainzReleaseId) return `musicbrainz:${meta.musicbrainzReleaseId}`;
  if (meta.musicbrainzReleaseGroupId) return `musicbrainz-group:${meta.musicbrainzReleaseGroupId}`;
  return `virtual:${meta.pressingId || 'selected'}`;
}

function getCachedSource(albumId: string, releaseKey: string, position: string, title: string) {
  const row = db().prepare(`
    SELECT provider_track_id FROM track_sources
    WHERE album_id=? AND release_key=? AND position=? AND title=? AND provider='navidrome'
    LIMIT 1
  `).get(albumId, releaseKey, position || '', title) as { provider_track_id?: string } | undefined;
  return row?.provider_track_id;
}

function saveCachedSource(albumId: string, releaseKey: string, position: string, title: string, songId: string) {
  db().prepare(`
    INSERT INTO track_sources(album_id, release_key, position, title, provider, provider_track_id, updated_at)
    VALUES(?, ?, ?, ?, 'navidrome', ?, ?)
    ON CONFLICT(album_id, release_key, position, provider) DO UPDATE SET
      title=excluded.title, provider_track_id=excluded.provider_track_id, updated_at=excluded.updated_at
  `).run(albumId, releaseKey, position || '', title, songId, new Date().toISOString());
}

async function loadSong(id: string): Promise<Song | undefined> {
  const root = await subsonic('getSong', { id });
  return root.song as Song | undefined;
}

function bestLocalMatch(track: DiscogsTrack, album: AlbumDetail, songs: Song[], used: Set<string>) {
  let best: Song | undefined;
  let score = 0;
  for (const song of songs) {
    if (used.has(song.id)) continue;
    const next = matchScore(track, album, song);
    if (next > score) {
      score = next;
      best = song;
    }
  }
  return score >= 0.64 ? best : undefined;
}

async function searchNavidrome(track: DiscogsTrack, album: AlbumDetail, used: Set<string>) {
  const compactTitle = compactMatchText(track.title);
  const queries = [`${album.artist} ${track.title}`];
  if (compactTitle && compactTitle !== track.title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')) {
    queries.push(`${album.artist} ${compactTitle}`);
  }

  const candidatesById = new Map<string, Song>();
  for (const query of queries) {
    const root = await subsonic('search3', {
      query,
      artistCount: 0,
      albumCount: 0,
      songCount: 12,
    });
    for (const song of (root.searchResult3?.song || []) as Song[]) {
      if (song?.id) candidatesById.set(song.id, song);
    }
  }

  let best: Song | undefined;
  let score = 0;
  for (const song of candidatesById.values()) {
    if (used.has(song.id)) continue;
    const next = matchScore(track, album, song);
    if (next > score) {
      score = next;
      best = song;
    }
  }
  return score >= 0.72 ? best : undefined;
}

function acceptableMatch(track: DiscogsTrack, album: AlbumDetail, song: Song) {
  return matchScore(track, album, song) >= 0.58;
}

function matchScore(track: DiscogsTrack, album: AlbumDetail, song: Song) {
  const title = titleSimilarity(track.title, song.title);
  const artist = titleSimilarity(album.artist, song.artist || '');
  const albumName = titleSimilarity(album.name, song.album || '');
  const duration = durationSimilarity(track.duration, song.duration);
  return title * 0.64 + artist * 0.2 + albumName * 0.08 + duration * 0.08;
}

function durationSimilarity(value?: string, seconds?: number) {
  if (!value || !seconds) return 0.5;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0.5;
  const expected = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
  if (!expected) return 0.5;
  const diff = Math.abs(expected - seconds);
  if (diff <= 3) return 1;
  if (diff <= 8) return 0.8;
  if (diff <= 20) return 0.55;
  if (diff <= 40) return 0.25;
  return 0;
}
