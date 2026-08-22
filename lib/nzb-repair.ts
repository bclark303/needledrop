import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabasePath, getSystemJson, setSystemJson } from './db';
import { startLibraryRescan } from './library';
import { normalizeMatchText, titleSimilarity } from './text-match';

export type NzbRepairProvider = 'newznab' | 'nzbhydra2' | 'prowlarr';

export type NzbRepairSettings = {
  provider?: NzbRepairProvider;
  indexerUrl?: string;
  indexerApiKey?: string;
  categories?: string;
  sabUrl?: string;
  sabApiKey?: string;
  sabCategory?: string;
  stagingPath?: string;
  importPath?: string;
  cleanupStaging?: boolean;
  preferLossless?: boolean;
  updatedAt?: string;
};

export type NzbRepairPublicSettings = {
  provider: NzbRepairProvider;
  indexerUrl: string;
  indexerApiKeyConfigured: boolean;
  categories: string;
  sabUrl: string;
  sabApiKeyConfigured: boolean;
  sabCategory: string;
  stagingPath: string;
  importPath: string;
  cleanupStaging: boolean;
  preferLossless: boolean;
};

export type MissingRepairTrack = {
  side?: string;
  position: string;
  title: string;
  duration?: string;
  ordinal?: number;
};

export type NzbRepairCandidate = {
  id: string;
  title: string;
  size?: number;
  indexer?: string;
  publishedAt?: string;
  score: number;
  quality: string;
  manifestVisible: boolean;
  archive: boolean;
  matchedTracks: string[];
  coverage: number;
  manifestFiles: string[];
};

export type NzbRepairState =
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'waiting-for-staging'
  | 'waiting-for-navidrome'
  | 'partial'
  | 'ready'
  | 'failed';

export type NzbRepairRequest = {
  id: number;
  albumId: string;
  token: string;
  artist: string;
  albumTitle: string;
  missingTracks: MissingRepairTrack[];
  candidateId: string;
  candidateTitle: string;
  sabNzoId?: string;
  state: NzbRepairState;
  message?: string;
  importedTracks: string[];
  scanTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
};

type InternalCandidate = NzbRepairCandidate & {
  albumId: string;
  downloadUrl: string;
  guid?: string;
  rawTitle: string;
  createdAt: string;
};

type SearchResult = {
  title: string;
  downloadUrl: string;
  guid?: string;
  size?: number;
  indexer?: string;
  publishedAt?: string;
};

type SabJob = {
  status?: string;
  storage?: string;
  path?: string;
  name?: string;
  nzo_id?: string;
};

type RepairUpdateRow = {
  sab_nzo_id?: string | null;
  state?: string | null;
  message?: string | null;
  imported_json?: string | null;
  scan_triggered_at?: string | null;
};

let database: DatabaseSync | null = null;

function db() {
  if (database) return database;
  database = new DatabaseSync(getDatabasePath());
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS nzb_repair_candidates (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_title TEXT NOT NULL,
      download_url TEXT NOT NULL,
      guid TEXT,
      size INTEGER,
      indexer TEXT,
      published_at TEXT,
      score REAL NOT NULL,
      quality TEXT NOT NULL,
      manifest_visible INTEGER NOT NULL DEFAULT 0,
      archive INTEGER NOT NULL DEFAULT 0,
      matched_json TEXT NOT NULL,
      coverage REAL NOT NULL DEFAULT 0,
      manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nzb_repair_candidates_album
      ON nzb_repair_candidates(album_id, score DESC);

    CREATE TABLE IF NOT EXISTS nzb_repair_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      artist TEXT NOT NULL,
      album_title TEXT NOT NULL,
      missing_json TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_title TEXT NOT NULL,
      sab_nzo_id TEXT,
      state TEXT NOT NULL,
      message TEXT,
      imported_json TEXT NOT NULL DEFAULT '[]',
      scan_triggered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nzb_repair_requests_album
      ON nzb_repair_requests(album_id, id DESC);
  `);
  return database;
}

function envDefaults(): NzbRepairSettings {
  const provider = process.env.NZB_REPAIR_PROVIDER?.trim().toLowerCase();
  return {
    provider: provider === 'prowlarr' || provider === 'nzbhydra2' ? provider : 'newznab',
    indexerUrl: process.env.NZB_INDEXER_URL?.trim() || '',
    indexerApiKey: process.env.NZB_INDEXER_API_KEY?.trim() || '',
    categories: process.env.NZB_INDEXER_CATEGORIES?.trim() || '3000,3040',
    sabUrl: process.env.SABNZBD_URL?.trim() || '',
    sabApiKey: process.env.SABNZBD_API_KEY?.trim() || '',
    sabCategory: process.env.SABNZBD_REPAIR_CATEGORY?.trim() || 'needledrop-repair',
    stagingPath: process.env.NZB_REPAIR_STAGING_PATH?.trim() || '/repair',
    importPath: process.env.NZB_REPAIR_IMPORT_PATH?.trim() || '/music-repair',
    cleanupStaging: process.env.NZB_REPAIR_CLEANUP !== 'false',
    preferLossless: process.env.NZB_REPAIR_PREFER_LOSSLESS !== 'false',
  };
}

export function getNzbRepairSettings(): NzbRepairSettings {
  const stored = getSystemJson<NzbRepairSettings>('nzb_repair_settings') || {};
  return { ...envDefaults(), ...stored };
}

export function getPublicNzbRepairSettings(): NzbRepairPublicSettings {
  const settings = getNzbRepairSettings();
  return {
    provider: settings.provider || 'newznab',
    indexerUrl: settings.indexerUrl || '',
    indexerApiKeyConfigured: Boolean(settings.indexerApiKey?.trim()),
    categories: settings.categories || '3000,3040',
    sabUrl: settings.sabUrl || '',
    sabApiKeyConfigured: Boolean(settings.sabApiKey?.trim()),
    sabCategory: settings.sabCategory || 'needledrop-repair',
    stagingPath: settings.stagingPath || '/repair',
    importPath: settings.importPath || '/music-repair',
    cleanupStaging: settings.cleanupStaging !== false,
    preferLossless: settings.preferLossless !== false,
  };
}

export function saveNzbRepairSettings(patch: Partial<NzbRepairSettings> & {
  clearIndexerApiKey?: boolean;
  clearSabApiKey?: boolean;
}) {
  const current = getNzbRepairSettings();
  const next: NzbRepairSettings = { ...current };
  if (patch.provider === 'newznab' || patch.provider === 'nzbhydra2' || patch.provider === 'prowlarr') next.provider = patch.provider;
  if (typeof patch.indexerUrl === 'string') next.indexerUrl = patch.indexerUrl.trim();
  if (patch.clearIndexerApiKey) next.indexerApiKey = '';
  else if (typeof patch.indexerApiKey === 'string' && patch.indexerApiKey.trim()) next.indexerApiKey = patch.indexerApiKey.trim();
  if (typeof patch.categories === 'string') next.categories = patch.categories.trim();
  if (typeof patch.sabUrl === 'string') next.sabUrl = patch.sabUrl.trim();
  if (patch.clearSabApiKey) next.sabApiKey = '';
  else if (typeof patch.sabApiKey === 'string' && patch.sabApiKey.trim()) next.sabApiKey = patch.sabApiKey.trim();
  if (typeof patch.sabCategory === 'string') next.sabCategory = patch.sabCategory.trim();
  if (typeof patch.stagingPath === 'string') next.stagingPath = patch.stagingPath.trim();
  if (typeof patch.importPath === 'string') next.importPath = patch.importPath.trim();
  if (typeof patch.cleanupStaging === 'boolean') next.cleanupStaging = patch.cleanupStaging;
  if (typeof patch.preferLossless === 'boolean') next.preferLossless = patch.preferLossless;
  next.updatedAt = new Date().toISOString();
  setSystemJson('nzb_repair_settings', next);
  return next;
}

export function nzbRepairConfigured() {
  const settings = getNzbRepairSettings();
  return Boolean(
    settings.indexerUrl?.trim()
    && settings.indexerApiKey?.trim()
    && settings.sabUrl?.trim()
    && settings.sabApiKey?.trim()
    && settings.sabCategory?.trim()
    && settings.stagingPath?.trim()
    && settings.importPath?.trim(),
  );
}

export async function testNzbRepairConnections(overrides: Partial<NzbRepairSettings> = {}) {
  const settings = mergedSettings(overrides);
  const [indexer, sab, paths] = await Promise.all([
    testIndexer(settings),
    testSab(settings),
    testRepairPaths(settings),
  ]);
  return { indexer, sab, paths };
}

export async function searchNzbRepairCandidates(input: {
  albumId: string;
  artist: string;
  albumTitle: string;
  missingTracks: MissingRepairTrack[];
}) {
  const settings = configuredSettings();
  pruneCandidates();
  const results = await searchIndexer(settings, input.artist, input.albumTitle);
  const ranked = results
    .map((result) => ({ result, baseScore: releaseScore(result.title, input.artist, input.albumTitle, settings.preferLossless !== false) }))
    .filter(({ result, baseScore }) => result.downloadUrl && baseScore >= 0.28)
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 12);

  const inspected: InternalCandidate[] = [];
  for (let index = 0; index < ranked.length; index += 3) {
    const batch = ranked.slice(index, index + 3);
    const resolved = await Promise.all(batch.map(async ({ result, baseScore }) => inspectCandidate(
      settings,
      input.albumId,
      result,
      input.missingTracks,
      baseScore,
    ).catch(() => null)));
    for (const candidate of resolved) if (candidate) inspected.push(candidate);
  }

  const sorted = inspected.sort((a, b) => b.score - a.score).slice(0, 8);
  const insert = db().prepare(`
    INSERT INTO nzb_repair_candidates(
      id, album_id, title, raw_title, download_url, guid, size, indexer, published_at,
      score, quality, manifest_visible, archive, matched_json, coverage, manifest_json, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      album_id=excluded.album_id, title=excluded.title, raw_title=excluded.raw_title,
      download_url=excluded.download_url, guid=excluded.guid, size=excluded.size,
      indexer=excluded.indexer, published_at=excluded.published_at, score=excluded.score,
      quality=excluded.quality, manifest_visible=excluded.manifest_visible, archive=excluded.archive,
      matched_json=excluded.matched_json, coverage=excluded.coverage,
      manifest_json=excluded.manifest_json, created_at=excluded.created_at
  `);
  for (const candidate of sorted) {
    insert.run(
      candidate.id,
      candidate.albumId,
      candidate.title,
      candidate.rawTitle,
      candidate.downloadUrl,
      candidate.guid || null,
      candidate.size || null,
      candidate.indexer || null,
      candidate.publishedAt || null,
      candidate.score,
      candidate.quality,
      candidate.manifestVisible ? 1 : 0,
      candidate.archive ? 1 : 0,
      JSON.stringify(candidate.matchedTracks),
      candidate.coverage,
      JSON.stringify(candidate.manifestFiles),
      candidate.createdAt,
    );
  }
  return sorted.map(publicCandidate);
}

export async function startNzbRepair(input: {
  albumId: string;
  artist: string;
  albumTitle: string;
  missingTracks: MissingRepairTrack[];
  candidateId: string;
}) {
  const settings = configuredSettings();
  await assertSabCategory(settings);
  await assertRepairPaths(settings);
  const candidate = getCandidate(input.albumId, input.candidateId);
  if (!candidate) throw new Error('The selected NZB candidate expired. Search again.');

  const token = `NDREP-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const jobName = `${token} ${cleanJobName(input.artist)} - ${cleanJobName(input.albumTitle)}`.slice(0, 180);
  const now = new Date().toISOString();
  const result = db().prepare(`
    INSERT INTO nzb_repair_requests(
      album_id, token, artist, album_title, missing_json, candidate_id, candidate_title,
      state, message, imported_json, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 'queued', ?, '[]', ?, ?)
  `).run(
    input.albumId,
    token,
    input.artist,
    input.albumTitle,
    JSON.stringify(input.missingTracks),
    candidate.id,
    candidate.title,
    'Uploading the selected NZB to SABnzbd.',
    now,
    now,
  );
  const requestId = Number(result.lastInsertRowid);

  try {
    const nzb = await fetchNzb(settings, candidate.downloadUrl);
    const nzoId = await sabAddFile(settings, nzb, `${jobName}.nzb`, jobName);
    updateRepair(requestId, {
      sabNzoId: nzoId,
      state: 'downloading',
      message: 'SABnzbd accepted the repair job and is downloading the temporary release.',
    });
  } catch (error) {
    updateRepair(requestId, {
      state: 'failed',
      message: error instanceof Error ? error.message : 'Could not send the NZB to SABnzbd.',
    });
    throw error;
  }
  return getLatestNzbRepairRequest(input.albumId);
}

export function getLatestNzbRepairRequest(albumId: string): NzbRepairRequest | null {
  const row = db().prepare('SELECT * FROM nzb_repair_requests WHERE album_id=? ORDER BY id DESC LIMIT 1').get(albumId) as Record<string, unknown> | undefined;
  return row ? mapRequest(row) : null;
}

export async function refreshNzbRepairRequest(albumId: string, currentMissing: MissingRepairTrack[]) {
  const request = getLatestNzbRepairRequest(albumId);
  if (!request) return null;
  if (!currentMissing.length) {
    if (request.state !== 'ready') updateRepair(request.id, { state: 'ready', message: 'All selected-release tracks are available in Navidrome.' });
    return getLatestNzbRepairRequest(albumId);
  }
  if (request.state === 'ready' || request.state === 'failed' || request.state === 'partial') return request;

  if (request.state === 'waiting-for-navidrome') {
    if (currentMissing.length < request.missingTracks.length) {
      updateRepair(request.id, {
        state: 'partial',
        message: `${request.missingTracks.length - currentMissing.length} missing track${request.missingTracks.length - currentMissing.length === 1 ? '' : 's'} repaired; ${currentMissing.length} still missing.`,
      });
      return getLatestNzbRepairRequest(albumId);
    }
    return request;
  }

  if (!request.sabNzoId) return request;
  const settings = configuredSettings();
  const sab = await getSabJob(settings, request.sabNzoId);
  if (sab.kind === 'queue') {
    const status = String(sab.job.status || '').toLowerCase();
    const processing = ['verifying', 'repairing', 'extracting', 'moving', 'running'].some((value) => status.includes(value));
    updateRepair(request.id, {
      state: processing ? 'processing' : 'downloading',
      message: processing ? `SABnzbd is ${status || 'post-processing'} the temporary release.` : 'SABnzbd is downloading the temporary release.',
    });
    return getLatestNzbRepairRequest(albumId);
  }
  if (sab.kind === 'history') {
    const status = String(sab.job.status || '').toLowerCase();
    if (status === 'failed') {
      updateRepair(request.id, { state: 'failed', message: 'SABnzbd reported that the repair download failed.' });
      return getLatestNzbRepairRequest(albumId);
    }
    if (status === 'completed') {
      if (request.importedTracks.length) return request;
      return processCompletedRepair(settings, request, sab.job);
    }
  }
  return request;
}

async function processCompletedRepair(settings: NzbRepairSettings, request: NzbRepairRequest, sabJob: SabJob) {
  updateRepair(request.id, { state: 'processing', message: 'SABnzbd finished. NeedleDrop is identifying the requested tracks.' });
  const jobDir = await locateSabJobDirectory(settings, request.token, sabJob);
  if (!jobDir) {
    updateRepair(request.id, {
      state: 'waiting-for-staging',
      message: `SABnzbd completed the job, but NeedleDrop cannot see it under ${settings.stagingPath}. Check the repair staging mount/category path.`,
    });
    return getLatestNzbRepairRequest(request.albumId);
  }

  const audioFiles = await findAudioFiles(jobDir);
  if (!audioFiles.length) {
    updateRepair(request.id, { state: 'failed', message: 'The completed SABnzbd job contained no supported audio files after unpacking.' });
    return getLatestNzbRepairRequest(request.albumId);
  }

  const inspected = await inspectAudioFiles(audioFiles);
  const used = new Set<string>();
  const imported: string[] = [];
  const importRoot = path.resolve(settings.importPath || '/music-repair');
  const albumDir = safeJoin(importRoot, safePathPart(request.artist), safePathPart(request.albumTitle));
  await mkdir(albumDir, { recursive: true });

  for (const target of request.missingTracks) {
    let best: { file: string; score: number } | null = null;
    for (const file of inspected) {
      if (used.has(file.file)) continue;
      const score = audioMatchScore(target, request.artist, request.albumTitle, file);
      if (!best || score > best.score) best = { file: file.file, score };
    }
    if (!best || best.score < 0.76) continue;
    used.add(best.file);
    const extension = path.extname(best.file).toLowerCase() || '.audio';
    const ordinal = target.ordinal && target.ordinal > 0 ? `${String(target.ordinal).padStart(2, '0')} - ` : '';
    const destination = safeJoin(albumDir, `${ordinal}${safePathPart(target.title)}${extension}`);
    await copyFile(best.file, destination);
    imported.push(target.title);
  }

  if (!imported.length) {
    updateRepair(request.id, {
      state: 'failed',
      message: 'NeedleDrop could not confidently identify any of the requested tracks in the completed release. The staging files were left untouched for review.',
    });
    return getLatestNzbRepairRequest(request.albumId);
  }

  let cleanupMessage = '';
  if (settings.cleanupStaging !== false) {
    const stagingRoot = path.resolve(settings.stagingPath || '/repair');
    const resolvedJob = path.resolve(jobDir);
    if (resolvedJob.startsWith(`${stagingRoot}${path.sep}`) && path.basename(resolvedJob).includes(request.token)) {
      await rm(resolvedJob, { recursive: true, force: true }).catch(() => {});
    } else {
      cleanupMessage = ' Temporary files were not automatically deleted because the completed folder could not be safely tied to this repair token.';
    }
  }

  const scanTriggeredAt = new Date().toISOString();
  startLibraryRescan();
  updateRepair(request.id, {
    state: 'waiting-for-navidrome',
    importedTracks: imported,
    scanTriggeredAt,
    message: `Kept ${imported.length}/${request.missingTracks.length} requested track${imported.length === 1 ? '' : 's'} and asked Navidrome to rescan.${cleanupMessage}`,
  });
  return getLatestNzbRepairRequest(request.albumId);
}

async function inspectAudioFiles(files: string[]) {
  const result: Array<{
    file: string;
    title?: string;
    artist?: string;
    album?: string;
    track?: number;
    duration?: number;
  }> = [];
  const { parseFile } = await import('music-metadata');
  for (const file of files.slice(0, 250)) {
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

function audioMatchScore(
  target: MissingRepairTrack,
  artist: string,
  albumTitle: string,
  file: { file: string; title?: string; artist?: string; album?: string; track?: number; duration?: number },
) {
  const filename = cleanAudioFilename(path.basename(file.file, path.extname(file.file)));
  const title = Math.max(titleSimilarity(target.title, file.title || ''), titleSimilarity(target.title, filename));
  const artistScore = file.artist ? titleSimilarity(artist, file.artist) : 0.7;
  const albumScore = file.album ? titleSimilarity(albumTitle, file.album) : 0.7;
  const duration = durationScore(target.duration, file.duration);
  const ordinal = target.ordinal && file.track ? (target.ordinal === file.track ? 1 : 0) : 0.5;
  return title * 0.74 + artistScore * 0.08 + albumScore * 0.07 + duration * 0.07 + ordinal * 0.04;
}

async function findAudioFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await findAudioFiles(full, depth + 1));
    else if (entry.isFile() && isAudioFilename(entry.name)) result.push(full);
    if (result.length >= 300) break;
  }
  return result;
}

async function locateSabJobDirectory(settings: NzbRepairSettings, token: string, sabJob: SabJob) {
  const staging = path.resolve(settings.stagingPath || '/repair');
  const candidates = [sabJob.storage, sabJob.path, sabJob.name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => path.basename(value.replace(/[\\/]+$/, '')))
    .filter(Boolean);
  for (const name of candidates) {
    const candidate = safeJoin(staging, name);
    if (await directoryExists(candidate)) return candidate;
  }
  const entries = await readdir(staging, { withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) => entry.isDirectory() && entry.name.includes(token));
  return match ? safeJoin(staging, match.name) : null;
}

async function getSabJob(settings: NzbRepairSettings, nzoId: string): Promise<{ kind: 'queue' | 'history' | 'none'; job: SabJob }> {
  const history = await sabApi(settings, { mode: 'history', nzo_ids: nzoId, limit: '1' }).catch(() => null) as any;
  const historySlots = asArray(history?.history?.slots || history?.slots);
  const historyJob = historySlots.find((slot) => String(slot.nzo_id || slot.nzoId || '') === nzoId) || historySlots[0];
  if (historyJob) return { kind: 'history', job: historyJob as SabJob };

  const queue = await sabApi(settings, { mode: 'queue', start: '0', limit: '200' }).catch(() => null) as any;
  const queueSlots = asArray(queue?.queue?.slots || queue?.slots);
  const queueJob = queueSlots.find((slot) => String(slot.nzo_id || slot.nzoId || '') === nzoId);
  if (queueJob) return { kind: 'queue', job: queueJob as SabJob };
  return { kind: 'none', job: {} };
}

async function sabAddFile(settings: NzbRepairSettings, nzb: Uint8Array, filename: string, jobName: string) {
  const { url, apiKey } = sabConfig(settings);
  const form = new FormData();
  form.set('mode', 'addfile');
  form.set('apikey', apiKey);
  form.set('output', 'json');
  form.set('cat', settings.sabCategory || 'needledrop-repair');
  form.set('nzbname', jobName);
  form.set('pp', '3');
  form.set('priority', '0');
  const uploadBytes = new Uint8Array(nzb.byteLength);
  uploadBytes.set(nzb);
  form.set('nzbfile', new Blob([uploadBytes.buffer], { type: 'application/x-nzb' }), filename);
  const response = await fetch(`${url}/api`, { method: 'POST', body: form, cache: 'no-store' });
  if (!response.ok) throw new Error(`SABnzbd HTTP ${response.status}`);
  const payload = await response.json().catch(() => ({})) as { status?: boolean; nzo_ids?: string[]; error?: string };
  const nzoId = payload.nzo_ids?.[0];
  if (!payload.status || !nzoId) throw new Error(payload.error || 'SABnzbd did not return a queue ID for the repair job.');
  return nzoId;
}

async function sabApi(settings: NzbRepairSettings, params: Record<string, string>) {
  const { url, apiKey } = sabConfig(settings);
  const endpoint = new URL(`${url}/api`);
  endpoint.searchParams.set('output', 'json');
  endpoint.searchParams.set('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(`SABnzbd HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  if (payload?.error) throw new Error(`SABnzbd: ${payload.error}`);
  return payload;
}

async function assertSabCategory(settings: NzbRepairSettings) {
  const payload = await sabApi(settings, { mode: 'get_cats' }) as { categories?: string[] };
  const category = settings.sabCategory || 'needledrop-repair';
  if (!payload.categories?.includes(category)) {
    throw new Error(`Create a SABnzbd category named “${category}” and point its completed folder at the repair staging share before starting a repair.`);
  }
}

async function testSab(settings: NzbRepairSettings) {
  const payload = await sabApi(settings, { mode: 'version' }) as Record<string, unknown>;
  const cats = await sabApi(settings, { mode: 'get_cats' }) as { categories?: string[] };
  const category = settings.sabCategory || 'needledrop-repair';
  return {
    version: String(payload?.version || payload?.status || ''),
    category,
    categoryExists: Boolean(cats.categories?.includes(category)),
  };
}

async function testIndexer(settings: NzbRepairSettings) {
  const provider = settings.provider || 'newznab';
  if (provider === 'prowlarr') {
    const { url, apiKey } = indexerConfig(settings);
    const response = await fetch(`${url}/api/v1/system/status`, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Prowlarr HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { provider, version: String(payload.version || ''), name: String(payload.appName || 'Prowlarr') };
  }
  const endpoint = newznabEndpoint(settings);
  endpoint.searchParams.set('t', 'caps');
  endpoint.searchParams.set('apikey', indexerConfig(settings).apiKey);
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${provider === 'nzbhydra2' ? 'NZBHydra2' : 'Newznab'} HTTP ${response.status}`);
  return { provider, name: provider === 'nzbhydra2' ? 'NZBHydra2' : 'Newznab indexer' };
}

async function testRepairPaths(settings: NzbRepairSettings) {
  const staging = path.resolve(settings.stagingPath || '/repair');
  const imports = path.resolve(settings.importPath || '/music-repair');
  const stagingReadable = await access(staging, fsConstants.R_OK).then(() => true).catch(() => false);
  const importWritable = await access(imports, fsConstants.W_OK).then(() => true).catch(async () => {
    try {
      await mkdir(imports, { recursive: true });
      await access(imports, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  return { staging, stagingReadable, importPath: imports, importWritable };
}

async function assertRepairPaths(settings: NzbRepairSettings) {
  const status = await testRepairPaths(settings);
  if (!status.stagingReadable) throw new Error(`NeedleDrop cannot read the repair staging path ${status.staging}. Add the SAB repair staging mount to the container.`);
  if (!status.importWritable) throw new Error(`NeedleDrop cannot write to the repair import path ${status.importPath}. Add a dedicated Navidrome-visible repair folder mount.`);
}

async function searchIndexer(settings: NzbRepairSettings, artist: string, albumTitle: string): Promise<SearchResult[]> {
  const provider = settings.provider || 'newznab';
  const query = `${artist} ${albumTitle}`.trim();
  if (provider === 'prowlarr') {
    const { url, apiKey } = indexerConfig(settings);
    const endpoint = new URL(`${url}/api/v1/search`);
    endpoint.searchParams.set('query', query);
    endpoint.searchParams.set('type', 'search');
    endpoint.searchParams.set('limit', '50');
    for (const category of categories(settings.categories)) endpoint.searchParams.append('categories', String(category));
    const response = await fetch(endpoint, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Prowlarr search HTTP ${response.status}`);
    const payload = await response.json().catch(() => []);
    return asArray(payload).map((item) => ({
      title: String(item.title || ''),
      downloadUrl: absoluteUrl(String(item.downloadUrl || item.download_url || ''), url),
      guid: item.guid ? String(item.guid) : undefined,
      size: numberOrUndefined(item.size),
      indexer: item.indexer ? String(item.indexer) : item.indexerId ? `Indexer ${item.indexerId}` : undefined,
      publishedAt: item.publishDate ? String(item.publishDate) : item.ageHours != null ? `${item.ageHours}h ago` : undefined,
    })).filter((item) => item.title && item.downloadUrl);
  }

  const endpoint = newznabEndpoint(settings);
  endpoint.searchParams.set('t', 'search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('apikey', indexerConfig(settings).apiKey);
  endpoint.searchParams.set('o', 'json');
  endpoint.searchParams.set('limit', '50');
  const category = categories(settings.categories).join(',');
  if (category) endpoint.searchParams.set('cat', category);
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${provider === 'nzbhydra2' ? 'NZBHydra2' : 'Indexer'} search HTTP ${response.status}`);
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    const items = asArray(payload?.channel?.item || payload?.item || payload?.results);
    return items.map((item) => parseNewznabItem(item, endpoint.origin)).filter((item): item is SearchResult => Boolean(item?.title && item?.downloadUrl));
  } catch {
    return parseNewznabXml(text, endpoint.origin);
  }
}

function parseNewznabItem(item: any, base: string): SearchResult | null {
  const attrs = new Map<string, string>();
  for (const attr of asArray(item?.attr || item?.['newznab:attr'] || item?.attributes)) {
    const name = String(attr?.['@attributes']?.name || attr?.name || '');
    const value = String(attr?.['@attributes']?.value || attr?.value || '');
    if (name) attrs.set(name, value);
  }
  const enclosure = item?.enclosure?.['@attributes'] || item?.enclosure || {};
  const download = item?.link || enclosure?.url || attrs.get('downloadurl') || '';
  if (!download) return null;
  const guidValue = typeof item?.guid === 'string' ? item.guid : item?.guid?.['#text'] || item?.guid?.text;
  return {
    title: String(item?.title || ''),
    downloadUrl: absoluteUrl(String(download), base),
    guid: guidValue ? String(guidValue) : undefined,
    size: numberOrUndefined(item?.size || enclosure?.length || attrs.get('size')),
    indexer: item?.indexer ? String(item.indexer) : undefined,
    publishedAt: item?.pubDate ? String(item.pubDate) : undefined,
  };
}

function parseNewznabXml(xml: string, base: string): SearchResult[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.map((match) => {
    const block = match[1];
    const title = xmlValue(block, 'title');
    const link = xmlValue(block, 'link') || block.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] || '';
    const size = block.match(/<newznab:attr[^>]+name=["']size["'][^>]+value=["'](\d+)["']/i)?.[1];
    return {
      title: decodeXml(title),
      downloadUrl: absoluteUrl(decodeXml(link), base),
      guid: decodeXml(xmlValue(block, 'guid')) || undefined,
      size: size ? Number(size) : undefined,
      publishedAt: decodeXml(xmlValue(block, 'pubDate')) || undefined,
    };
  }).filter((item) => item.title && item.downloadUrl);
}

async function inspectCandidate(
  settings: NzbRepairSettings,
  albumId: string,
  result: SearchResult,
  missingTracks: MissingRepairTrack[],
  baseScore: number,
): Promise<InternalCandidate> {
  const nzb = await fetchNzb(settings, result.downloadUrl);
  const manifestFiles = parseNzbFiles(new TextDecoder().decode(nzb));
  const audio = manifestFiles.filter(isAudioFilename);
  const archive = manifestFiles.some(isArchiveFilename);
  const matchedTracks = missingTracks
    .filter((target) => audio.some((filename) => titleSimilarity(target.title, cleanAudioFilename(filename)) >= 0.82))
    .map((track) => track.title);
  const coverage = missingTracks.length ? matchedTracks.length / missingTracks.length : 0;
  const quality = qualityLabel(result.title, manifestFiles);
  const manifestVisible = audio.length > 0;
  const qualityBonus = quality.toLowerCase().includes('flac') || quality.toLowerCase().includes('lossless') ? 1 : 0.55;
  const transparency = manifestVisible ? 1 : archive ? 0.45 : 0.2;
  const score = clamp(baseScore * 0.42 + coverage * 0.4 + transparency * 0.12 + qualityBonus * 0.06, 0, 1);
  const id = createHash('sha1').update(`${albumId}|${result.guid || result.downloadUrl}`).digest('hex').slice(0, 20);
  return {
    id,
    albumId,
    title: result.title,
    rawTitle: result.title,
    downloadUrl: result.downloadUrl,
    guid: result.guid,
    size: result.size,
    indexer: result.indexer,
    publishedAt: result.publishedAt,
    score,
    quality,
    manifestVisible,
    archive,
    matchedTracks,
    coverage,
    manifestFiles: manifestFiles.slice(0, 100),
    createdAt: new Date().toISOString(),
  };
}

async function fetchNzb(settings: NzbRepairSettings, downloadUrl: string) {
  const url = new URL(downloadUrl);
  const providerUrl = new URL(indexerConfig(settings).url);
  const headers: Record<string, string> = { Accept: 'application/x-nzb, application/xml, text/xml, */*' };
  if (settings.provider === 'prowlarr' && url.origin === providerUrl.origin) headers['X-Api-Key'] = indexerConfig(settings).apiKey;
  if (settings.provider !== 'prowlarr' && url.origin === providerUrl.origin && !url.searchParams.has('apikey')) url.searchParams.set('apikey', indexerConfig(settings).apiKey);
  const response = await fetch(url, { headers, redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not fetch NZB manifest (HTTP ${response.status}).`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error('NZB manifest is unexpectedly large; candidate skipped.');
  return buffer;
}

function parseNzbFiles(xml: string) {
  const names = new Set<string>();
  for (const match of xml.matchAll(/<file\b[^>]*\bsubject=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const subject = decodeXml(match[1] || match[2] || '');
    for (const quoted of subject.matchAll(/["']([^"']+\.(?:flac|mp3|m4a|aac|ogg|opus|wav|ape|wv|rar|r\d{2}|zip|7z|par2|nfo|sfv))["']/gi)) names.add(path.basename(quoted[1]));
    for (const loose of subject.matchAll(/([^\s"'<>/\\]+\.(?:flac|mp3|m4a|aac|ogg|opus|wav|ape|wv|rar|r\d{2}|zip|7z|par2|nfo|sfv))/gi)) names.add(path.basename(loose[1]));
  }
  return [...names];
}

function getCandidate(albumId: string, candidateId: string): InternalCandidate | null {
  const row = db().prepare('SELECT * FROM nzb_repair_candidates WHERE album_id=? AND id=?').get(albumId, candidateId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    albumId: String(row.album_id),
    title: String(row.title),
    rawTitle: String(row.raw_title),
    downloadUrl: String(row.download_url),
    guid: row.guid ? String(row.guid) : undefined,
    size: row.size == null ? undefined : Number(row.size),
    indexer: row.indexer ? String(row.indexer) : undefined,
    publishedAt: row.published_at ? String(row.published_at) : undefined,
    score: Number(row.score || 0),
    quality: String(row.quality || 'Unknown'),
    manifestVisible: Boolean(row.manifest_visible),
    archive: Boolean(row.archive),
    matchedTracks: parseJsonArray(row.matched_json),
    coverage: Number(row.coverage || 0),
    manifestFiles: parseJsonArray(row.manifest_json),
    createdAt: String(row.created_at || ''),
  };
}

function publicCandidate(candidate: InternalCandidate): NzbRepairCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    size: candidate.size,
    indexer: candidate.indexer,
    publishedAt: candidate.publishedAt,
    score: candidate.score,
    quality: candidate.quality,
    manifestVisible: candidate.manifestVisible,
    archive: candidate.archive,
    matchedTracks: candidate.matchedTracks,
    coverage: candidate.coverage,
    manifestFiles: candidate.manifestFiles,
  };
}

function pruneCandidates() {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  db().prepare('DELETE FROM nzb_repair_candidates WHERE created_at < ?').run(cutoff);
}

function updateRepair(id: number, patch: {
  sabNzoId?: string;
  state?: NzbRepairState;
  message?: string;
  importedTracks?: string[];
  scanTriggeredAt?: string;
}) {
  const current = db().prepare('SELECT sab_nzo_id, state, message, imported_json, scan_triggered_at FROM nzb_repair_requests WHERE id=?').get(id) as RepairUpdateRow | undefined;
  if (!current) return;
  db().prepare(`
    UPDATE nzb_repair_requests SET
      sab_nzo_id=?, state=?, message=?, imported_json=?, scan_triggered_at=?, updated_at=?
    WHERE id=?
  `).run(
    patch.sabNzoId ?? current.sab_nzo_id ?? null,
    patch.state ?? current.state ?? 'queued',
    patch.message ?? current.message ?? null,
    JSON.stringify(patch.importedTracks ?? parseJsonArray(current.imported_json)),
    patch.scanTriggeredAt ?? current.scan_triggered_at ?? null,
    new Date().toISOString(),
    id,
  );
}

function mapRequest(row: Record<string, unknown>): NzbRepairRequest {
  return {
    id: Number(row.id),
    albumId: String(row.album_id),
    token: String(row.token),
    artist: String(row.artist),
    albumTitle: String(row.album_title),
    missingTracks: parseJsonArray(row.missing_json) as MissingRepairTrack[],
    candidateId: String(row.candidate_id),
    candidateTitle: String(row.candidate_title),
    sabNzoId: row.sab_nzo_id ? String(row.sab_nzo_id) : undefined,
    state: String(row.state || 'queued') as NzbRepairState,
    message: row.message ? String(row.message) : undefined,
    importedTracks: parseJsonArray(row.imported_json),
    scanTriggeredAt: row.scan_triggered_at ? String(row.scan_triggered_at) : undefined,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function configuredSettings() {
  const settings = getNzbRepairSettings();
  indexerConfig(settings);
  sabConfig(settings);
  return settings;
}

function mergedSettings(overrides: Partial<NzbRepairSettings>) {
  const stored = getNzbRepairSettings();
  return {
    ...stored,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined && value !== '')),
    indexerApiKey: overrides.indexerApiKey?.trim() || stored.indexerApiKey,
    sabApiKey: overrides.sabApiKey?.trim() || stored.sabApiKey,
  } as NzbRepairSettings;
}

function indexerConfig(settings: NzbRepairSettings) {
  const url = (settings.indexerUrl || '').trim().replace(/\/$/, '');
  const apiKey = (settings.indexerApiKey || '').trim();
  if (!url || !apiKey) throw new Error('NZB_REPAIR_INDEXER_NOT_CONFIGURED');
  return { url, apiKey };
}

function sabConfig(settings: NzbRepairSettings) {
  const url = (settings.sabUrl || '').trim().replace(/\/$/, '');
  const apiKey = (settings.sabApiKey || '').trim();
  if (!url || !apiKey) throw new Error('NZB_REPAIR_SAB_NOT_CONFIGURED');
  return { url, apiKey };
}

function newznabEndpoint(settings: NzbRepairSettings) {
  const { url } = indexerConfig(settings);
  const endpoint = new URL(url);
  if (endpoint.pathname === '/' || !endpoint.pathname) endpoint.pathname = '/api';
  return endpoint;
}

function categories(value?: string) {
  return (value || '3000,3040').split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
}

function releaseScore(title: string, artist: string, album: string, preferLossless: boolean) {
  const release = normalizeMatchText(title);
  const artistText = normalizeMatchText(artist);
  const albumText = normalizeMatchText(album);
  const artistScore = release.includes(artistText) ? 1 : titleSimilarity(title, artist);
  const albumScore = release.includes(albumText) ? 1 : titleSimilarity(title, album);
  const lossless = /\b(flac|lossless|alac|24[ ._-]?bit|16[ ._-]?bit)\b/i.test(title) ? 1 : /\b(mp3|aac)\b/i.test(title) ? 0.35 : 0.6;
  return clamp(albumScore * 0.58 + artistScore * 0.32 + (preferLossless ? lossless : 0.7) * 0.1, 0, 1);
}

function qualityLabel(title: string, files: string[]) {
  const text = `${title} ${files.join(' ')}`;
  if (/24[ ._-]?bit|24\/\d+/i.test(text)) return 'FLAC / Hi-Res';
  if (/\bflac\b|\blossless\b/i.test(text)) return 'FLAC / Lossless';
  if (/\balac\b/i.test(text)) return 'ALAC';
  if (/\b320\b.*\bmp3\b|\bmp3\b.*\b320\b/i.test(text)) return 'MP3 320';
  if (/\bmp3\b/i.test(text)) return 'MP3';
  return 'Unknown';
}

function cleanAudioFilename(value: string) {
  return path.basename(value, path.extname(value))
    .replace(/^\s*(?:cd|disc)?\s*\d+[ ._-]+/i, '')
    .replace(/^\s*[a-z]\d+[ ._-]+/i, '')
    .replace(/^\s*\d{1,3}[ ._-]+/, '')
    .replace(/[._]+/g, ' ')
    .trim();
}

function isAudioFilename(value: string) {
  return /\.(flac|mp3|m4a|aac|ogg|opus|wav|ape|wv)$/i.test(value);
}

function isArchiveFilename(value: string) {
  return /\.(rar|r\d{2}|zip|7z)$/i.test(value);
}

function durationScore(value?: string, seconds?: number) {
  if (!value || !seconds) return 0.65;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0.65;
  const expected = parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
  if (!expected) return 0.65;
  const diff = Math.abs(expected - seconds);
  if (diff <= 3) return 1;
  if (diff <= 8) return 0.85;
  if (diff <= 20) return 0.55;
  return 0.1;
}

function cleanJobName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function safePathPart(value: string) {
  const result = value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (result || 'Unknown').slice(0, 120);
}

function safeJoin(root: string, ...parts: string[]) {
  const resolvedRoot = path.resolve(root);
  const result = path.resolve(resolvedRoot, ...parts);
  if (result !== resolvedRoot && !result.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Unsafe repair path rejected.');
  return result;
}

async function directoryExists(value: string) {
  try { return (await stat(value)).isDirectory(); } catch { return false; }
}

function xmlValue(block: string, tag: string) {
  return block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() || '';
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function absoluteUrl(value: string, base: string) {
  if (!value) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
