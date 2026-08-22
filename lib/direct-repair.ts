import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabasePath, getSystemJson, setSystemJson } from './db';
import { startLibraryRescan } from './library';
import { getNzbRepairSettings, type MissingRepairTrack, type NzbRepairRequest } from './nzb-repair';
import { subsonic } from './subsonic';
import { titleSimilarity } from './text-match';

export type DirectRepairSettings = {
  enabled?: boolean;
  libraryPath?: string;
  updatedAt?: string;
};

export type DirectRepairPublicSettings = {
  enabled: boolean;
  libraryPath: string;
};

export type DirectPromotionState = 'pending' | 'promoting' | 'complete' | 'partial' | 'blocked' | 'failed';

export type DirectPromotion = {
  repairId: number;
  albumId: string;
  state: DirectPromotionState;
  message?: string;
  promotedTracks: string[];
  fallbackTracks: string[];
  createdAt: string;
  updatedAt: string;
};

type InspectedAudio = {
  file: string;
  title?: string;
  artist?: string;
  album?: string;
  track?: number;
  duration?: number;
};

type LibrarySong = {
  path?: string;
  discNumber?: number;
};

type AlbumPathContext = {
  root: string;
  songs: Array<{ file: string; directory: string; discNumber?: number }>;
};

let database: DatabaseSync | null = null;

function db() {
  if (database) return database;
  database = new DatabaseSync(getDatabasePath());
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS nzb_direct_promotions (
      repair_id INTEGER PRIMARY KEY,
      album_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      promoted_json TEXT NOT NULL DEFAULT '[]',
      fallback_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function envDefaults(): DirectRepairSettings {
  return {
    enabled: process.env.NZB_REPAIR_DIRECT_WRITE === 'true',
    libraryPath: process.env.NZB_REPAIR_LIBRARY_PATH?.trim() || '/music',
  };
}

export function getDirectRepairSettings(): DirectRepairSettings {
  const stored = getSystemJson<DirectRepairSettings>('nzb_direct_repair_settings') || {};
  return { ...envDefaults(), ...stored };
}

export function getPublicDirectRepairSettings(): DirectRepairPublicSettings {
  const settings = getDirectRepairSettings();
  return {
    enabled: settings.enabled === true,
    libraryPath: settings.libraryPath || '/music',
  };
}

export function saveDirectRepairSettings(patch: Partial<DirectRepairSettings>) {
  const current = getDirectRepairSettings();
  const next: DirectRepairSettings = { ...current };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.libraryPath === 'string') next.libraryPath = patch.libraryPath.trim() || '/music';
  next.updatedAt = new Date().toISOString();
  setSystemJson('nzb_direct_repair_settings', next);
  return next;
}

export async function testDirectRepairPath(overrides: Partial<DirectRepairSettings> = {}) {
  const settings = { ...getDirectRepairSettings(), ...overrides };
  const libraryPath = path.resolve(settings.libraryPath || '/music');
  const exists = await directoryExists(libraryPath);
  const writable = exists && await access(libraryPath, fsConstants.W_OK).then(() => true).catch(() => false);
  return { libraryPath, exists, writable };
}

export async function validateDirectRepairTarget(albumId: string) {
  const settings = getDirectRepairSettings();
  if (settings.enabled !== true) throw new Error('DIRECT_REPAIR_NOT_ENABLED');
  const context = await loadAlbumPathContext(albumId, settings.libraryPath || '/music');
  const target = resolveTargetDirectory(context);
  if (!target) throw new Error('NeedleDrop could not map this Navidrome album to a writable folder inside the direct-library mount. The safe repair library is still available.');
  const writable = await access(target, fsConstants.W_OK).then(() => true).catch(() => false);
  if (!writable) throw new Error(`NeedleDrop can see the album folder but cannot write to it: ${target}`);
  return { albumDirectory: target };
}

export function requestDirectPromotion(repairId: number, albumId: string) {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO nzb_direct_promotions(
      repair_id, album_id, state, message, promoted_json, fallback_json, created_at, updated_at
    ) VALUES(?, ?, 'pending', ?, '[]', '[]', ?, ?)
    ON CONFLICT(repair_id) DO UPDATE SET
      album_id=excluded.album_id,
      state='pending',
      message=excluded.message,
      promoted_json='[]',
      fallback_json='[]',
      updated_at=excluded.updated_at
  `).run(
    repairId,
    albumId,
    'Direct album-folder promotion requested. NeedleDrop will first retain and verify the track in the isolated repair library.',
    now,
    now,
  );
  return getDirectPromotion(repairId);
}

export function getDirectPromotion(repairId: number): DirectPromotion | null {
  const row = db().prepare('SELECT * FROM nzb_direct_promotions WHERE repair_id=?').get(repairId) as Record<string, unknown> | undefined;
  return row ? mapPromotion(row) : null;
}

export async function maybePromoteDirectRepair(repair: NzbRepairRequest | null) {
  if (!repair) return null;
  const promotion = getDirectPromotion(repair.id);
  if (!promotion) return null;
  if (['complete', 'partial', 'blocked', 'failed'].includes(promotion.state)) return promotion;

  if (!repair.importedTracks.length) {
    if (repair.state === 'failed') {
      updatePromotion(repair.id, 'failed', 'The repair failed before any track was retained, so nothing was written to the album folder.', [], []);
    }
    return getDirectPromotion(repair.id);
  }

  return promoteRetainedTracks(repair);
}

async function promoteRetainedTracks(repair: NzbRepairRequest) {
  const direct = getDirectRepairSettings();
  if (direct.enabled !== true) {
    updatePromotion(repair.id, 'blocked', 'Direct writes were disabled after this repair started. The verified tracks remain in the isolated repair library.', [], repair.importedTracks);
    return getDirectPromotion(repair.id);
  }

  updatePromotion(repair.id, 'promoting', 'Running the stricter direct-write verification pass.', [], []);

  try {
    const nzbSettings = getNzbRepairSettings();
    const safeRoot = path.resolve(nzbSettings.importPath || '/music-repair');
    const safeAlbumDir = safeJoin(safeRoot, safePathPart(repair.artist), safePathPart(repair.albumTitle));
    const safeFiles = await findAudioFiles(safeAlbumDir);
    if (!safeFiles.length) {
      updatePromotion(repair.id, 'blocked', 'The retained repair files were not found in the isolated repair folder. Nothing was written to the main library.', [], repair.importedTracks);
      return getDirectPromotion(repair.id);
    }

    const inspected = await inspectAudioFiles(safeFiles);
    const context = await loadAlbumPathContext(repair.albumId, direct.libraryPath || '/music');
    const promoted: string[] = [];
    const fallback: string[] = [];
    const used = new Set<string>();

    for (const target of repair.missingTracks.filter((item) => repair.importedTracks.some((title) => titleSimilarity(title, item.title) >= 0.94))) {
      const best = bestFileForTarget(target, repair.artist, repair.albumTitle, inspected, used);
      if (!best) {
        fallback.push(target.title);
        continue;
      }

      const verification = strictDirectVerification(target, repair.artist, repair.albumTitle, best);
      const albumDirectory = resolveTargetDirectory(context, target);
      const writable = albumDirectory
        ? await access(albumDirectory, fsConstants.W_OK).then(() => true).catch(() => false)
        : false;

      if (!verification.ok || !albumDirectory || !writable) {
        fallback.push(target.title);
        continue;
      }

      const destination = await uniqueDestination(albumDirectory, path.basename(best.file));
      await copyFile(best.file, destination, fsConstants.COPYFILE_EXCL);
      await rm(best.file, { force: true });
      used.add(best.file);
      promoted.push(target.title);
    }

    if (promoted.length) startLibraryRescan();

    if (!promoted.length) {
      updatePromotion(
        repair.id,
        'blocked',
        'No retained track passed the stricter direct-write checks and album-folder validation. Nothing was written to the main library; the safe repair copies were kept.',
        [],
        uniqueStrings(fallback.length ? fallback : repair.importedTracks),
      );
      return getDirectPromotion(repair.id);
    }

    const remaining = uniqueStrings(fallback);
    const state: DirectPromotionState = remaining.length ? 'partial' : 'complete';
    const message = remaining.length
      ? `Promoted ${promoted.length} strictly verified track${promoted.length === 1 ? '' : 's'} into the existing album folder. ${remaining.length} track${remaining.length === 1 ? '' : 's'} stayed in the isolated repair library because the stricter verification or folder check did not pass.`
      : `Promoted ${promoted.length} strictly verified track${promoted.length === 1 ? '' : 's'} into the existing album folder without overwriting any existing file.`;
    updatePromotion(repair.id, state, message, promoted, remaining);
    return getDirectPromotion(repair.id);
  } catch (error) {
    updatePromotion(
      repair.id,
      'failed',
      `${error instanceof Error ? error.message : 'Direct promotion failed.'} The isolated repair copy was left in place wherever possible.`,
      [],
      repair.importedTracks,
    );
    return getDirectPromotion(repair.id);
  }
}

function bestFileForTarget(
  target: MissingRepairTrack,
  artist: string,
  albumTitle: string,
  files: InspectedAudio[],
  used: Set<string>,
) {
  let best: { file: InspectedAudio; score: number } | null = null;
  for (const file of files) {
    if (used.has(file.file)) continue;
    const filename = cleanAudioFilename(path.basename(file.file, path.extname(file.file)));
    const title = Math.max(titleSimilarity(target.title, file.title || ''), titleSimilarity(target.title, filename));
    const artistScore = file.artist ? titleSimilarity(artist, file.artist) : 0.65;
    const albumScore = file.album ? titleSimilarity(albumTitle, file.album) : 0.65;
    const duration = durationSimilarity(target.duration, file.duration);
    const score = title * 0.72 + artistScore * 0.1 + albumScore * 0.1 + duration * 0.08;
    if (!best || score > best.score) best = { file, score };
  }
  return best && best.score >= 0.8 ? best.file : null;
}

function strictDirectVerification(target: MissingRepairTrack, artist: string, albumTitle: string, file: InspectedAudio) {
  const filename = cleanAudioFilename(path.basename(file.file, path.extname(file.file)));
  const taggedTitle = file.title ? titleSimilarity(target.title, file.title) : 0;
  const filenameTitle = titleSimilarity(target.title, filename);
  const titleScore = Math.max(taggedTitle, filenameTitle);
  const artistScore = file.artist ? titleSimilarity(artist, file.artist) : 0;
  const albumScore = file.album ? titleSimilarity(albumTitle, file.album) : 0;
  const durationScore = durationSimilarity(target.duration, file.duration);

  if (titleScore < 0.92) return { ok: false, score: titleScore };
  if (file.artist && artistScore < 0.78) return { ok: false, score: artistScore };
  if (file.album && albumScore < 0.76) return { ok: false, score: albumScore };
  if (target.duration && file.duration && durationScore < 0.72) return { ok: false, score: durationScore };

  let independentSignals = 0;
  if (file.title && taggedTitle >= 0.9) independentSignals += 1;
  if (file.artist && artistScore >= 0.82) independentSignals += 1;
  if (file.album && albumScore >= 0.8) independentSignals += 1;
  if (target.duration && file.duration && durationScore >= 0.85) independentSignals += 1;
  if (target.ordinal && file.track && target.ordinal === file.track) independentSignals += 1;

  const score = titleScore * 0.58
    + (file.artist ? artistScore : 0.7) * 0.12
    + (file.album ? albumScore : 0.7) * 0.12
    + durationScore * 0.13
    + (target.ordinal && file.track && target.ordinal === file.track ? 1 : 0.5) * 0.05;

  return { ok: independentSignals >= 2 && score >= 0.88, score };
}

async function loadAlbumPathContext(albumId: string, libraryPath: string): Promise<AlbumPathContext> {
  const root = path.resolve(libraryPath || '/music');
  if (!await directoryExists(root)) throw new Error(`The direct-library mount does not exist at ${root}.`);
  const writable = await access(root, fsConstants.W_OK).then(() => true).catch(() => false);
  if (!writable) throw new Error(`The direct-library mount is not writable at ${root}.`);

  const response = await subsonic('getAlbum', { id: albumId });
  const rawSongs = Array.isArray(response?.album?.song) ? response.album.song as LibrarySong[] : [];
  const songs = rawSongs.flatMap((song) => {
    const file = song.path ? resolveNavidromePath(root, song.path) : null;
    return file ? [{ file, directory: path.dirname(file), discNumber: song.discNumber }] : [];
  });

  if (!songs.length) throw new Error('Navidrome did not expose any existing song paths for this album that map inside the configured direct-library mount.');
  return { root, songs };
}

function resolveTargetDirectory(context: AlbumPathContext, target?: MissingRepairTrack) {
  const desiredDisc = target ? sideToDisc(target.side) : undefined;
  const discDirectories = desiredDisc
    ? context.songs.filter((song) => song.discNumber === desiredDisc).map((song) => song.directory)
    : [];
  const directories = uniqueStrings(discDirectories.length ? discDirectories : context.songs.map((song) => song.directory));
  if (!directories.length) return null;
  const common = commonDirectory(directories);
  if (!common || common === context.root || !isWithin(context.root, common)) return null;
  return common;
}

function resolveNavidromePath(root: string, value: string) {
  const normalized = value.replace(/\\/g, path.sep);
  const candidate = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(root, normalized);
  return isWithin(root, candidate) ? candidate : null;
}

function commonDirectory(values: string[]) {
  let common = path.resolve(values[0]);
  for (const value of values.slice(1)) {
    const current = path.resolve(value);
    while (common !== path.dirname(common) && current !== common && !current.startsWith(`${common}${path.sep}`)) common = path.dirname(common);
  }
  return common;
}

function sideToDisc(side?: string) {
  const letter = side?.toUpperCase().match(/[A-Z]/)?.[0];
  if (!letter) return undefined;
  const index = letter.charCodeAt(0) - 65;
  return index >= 0 ? Math.floor(index / 2) + 1 : undefined;
}

async function inspectAudioFiles(files: string[]): Promise<InspectedAudio[]> {
  const result: InspectedAudio[] = [];
  const { parseFile } = await import('music-metadata');
  for (const file of files.slice(0, 100)) {
    try {
      const metadata = await parseFile(file, { duration: true, skipCovers: true });
      result.push({
        file,
        title: metadata.common.title,
        artist: metadata.common.artist,
        album: metadata.common.album,
        track: metadata.common.track?.no || undefined,
        duration: metadata.format.duration,
      });
    } catch {
      result.push({ file });
    }
  }
  return result;
}

async function findAudioFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 3 || !await directoryExists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await findAudioFiles(full, depth + 1));
    else if (entry.isFile() && /\.(flac|mp3|m4a|aac|ogg|opus|wav|ape|wv)$/i.test(entry.name)) result.push(full);
  }
  return result;
}

async function uniqueDestination(directory: string, filename: string) {
  const first = safeJoin(directory, filename);
  if (!await fileExists(first)) return first;
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let index = 1; index <= 99; index += 1) {
    const suffix = index === 1 ? ' [NeedleDrop Repair]' : ` [NeedleDrop Repair ${index}]`;
    const candidate = safeJoin(directory, `${stem}${suffix}${ext}`);
    if (!await fileExists(candidate)) return candidate;
  }
  throw new Error(`Could not choose a non-conflicting filename in ${directory}.`);
}

function durationSimilarity(value?: string, seconds?: number) {
  if (!value || !seconds) return 0.65;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0.65;
  const expected = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
  if (!expected) return 0.65;
  const diff = Math.abs(expected - seconds);
  if (diff <= 3) return 1;
  if (diff <= 8) return 0.9;
  if (diff <= 12) return 0.72;
  if (diff <= 20) return 0.45;
  return 0.1;
}

function cleanAudioFilename(value: string) {
  return path.basename(value, path.extname(value))
    .replace(/^\s*(?:cd|disc)?\s*\d+[ ._-]+/i, '')
    .replace(/^\s*[a-z]\d+[ ._-]+/i, '')
    .replace(/^\s*\d{1,3}[ ._-]+/, '')
    .replace(/[._]+/g, ' ')
    .trim();
}

function safePathPart(value: string) {
  const result = value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (result || 'Unknown').slice(0, 120);
}

function safeJoin(root: string, ...parts: string[]) {
  const resolvedRoot = path.resolve(root);
  const result = path.resolve(resolvedRoot, ...parts);
  if (!isWithin(resolvedRoot, result)) throw new Error('Unsafe direct-repair path rejected.');
  return result;
}

function isWithin(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

async function directoryExists(value: string) {
  try { return (await stat(value)).isDirectory(); } catch { return false; }
}

async function fileExists(value: string) {
  try { return (await stat(value)).isFile(); } catch { return false; }
}

function updatePromotion(
  repairId: number,
  state: DirectPromotionState,
  message: string,
  promotedTracks: string[],
  fallbackTracks: string[],
) {
  db().prepare(`
    UPDATE nzb_direct_promotions SET
      state=?, message=?, promoted_json=?, fallback_json=?, updated_at=?
    WHERE repair_id=?
  `).run(
    state,
    message,
    JSON.stringify(uniqueStrings(promotedTracks)),
    JSON.stringify(uniqueStrings(fallbackTracks)),
    new Date().toISOString(),
    repairId,
  );
}

function mapPromotion(row: Record<string, unknown>): DirectPromotion {
  return {
    repairId: Number(row.repair_id),
    albumId: String(row.album_id),
    state: String(row.state || 'pending') as DirectPromotionState,
    message: row.message ? String(row.message) : undefined,
    promotedTracks: parseJsonArray(row.promoted_json),
    fallbackTracks: parseJsonArray(row.fallback_json),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
