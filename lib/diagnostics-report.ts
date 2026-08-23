import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { Album, VinylMeta } from '@/components/types';
import { getArtworkCacheEntryStatus, getArtworkCacheStats, getArtworkFetchRuntimeState } from './artwork-cache';
import { orderedArtworkChoices } from './artwork-resolution';
import { getAlbumMetaJson, getAlbumRecord, getDatabasePath, getEnrichmentStatus, listArtwork } from './db';
import {
  diagnosticsPaths,
  getDiagnosticsStatus,
  readDiagnosticEvents,
  recordDiagnostic,
  sanitizeDiagnosticValue,
  sanitizeUrlForDiagnostics,
  summarizeDiagnosticEvents,
  type DiagnosticEvent,
} from './diagnostics';
import { getStoredSettings } from './settings';
import { subsonic } from './subsonic';
import { APP_VERSION } from './version';

const DEFAULT_ARTWORK_ORDER = ['discogs', 'coverartarchive', 'navidrome'];
const MAX_INVENTORY_FILES = 25000;

function hashOpaque(value?: string) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function loadAllAlbums() {
  const albums: Album[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const root = await subsonic('getAlbumList2', { type: 'alphabeticalByArtist', size: pageSize, offset });
    const page = (root.albumList2?.album ?? []) as Album[];
    albums.push(...page);
    if (page.length < pageSize) break;
  }
  return albums;
}

async function remoteStatus(value?: string) {
  if (!value) return undefined;
  return {
    url: sanitizeUrlForDiagnostics(value),
    cache: await getArtworkCacheEntryStatus(value),
  };
}

async function buildAlbumDiagnostic(album: Album, artworkSourceOrder: string[]) {
  const record = getAlbumRecord(album.id);
  const meta = getAlbumMetaJson<VinylMeta>(album.id);
  const artwork = listArtwork(album.id);
  const ordered = orderedArtworkChoices(album.id, artworkSourceOrder);

  const candidates = await Promise.all(artwork.map(async (candidate) => ({
    id: candidate.id,
    source: candidate.source,
    scope: candidate.scope,
    role: candidate.role,
    sourceKey: candidate.sourceKey,
    sourceId: candidate.sourceId,
    userSelected: candidate.userSelected,
    ...(candidate.remoteUrl ? await remoteStatus(candidate.remoteUrl) : {}),
  })));

  const legacyImages = await Promise.all((meta?.images || []).map(async (image, index) => ({
    index,
    type: image.type,
    width: image.width,
    height: image.height,
    selected: meta?.artworkSource === 'discogs' && meta.discogsImageIndex === index,
    uri: image.uri ? await remoteStatus(image.uri) : undefined,
    uri150: image.uri150 ? await remoteStatus(image.uri150) : undefined,
  })));

  return {
    id: album.id,
    artist: album.artist,
    title: album.name,
    year: album.year,
    navidrome: {
      albumCoverHandlePresent: Boolean(album.coverArt || record?.navidromeCoverArt),
      albumCoverHandleHash: hashOpaque(album.coverArt || record?.navidromeCoverArt),
    },
    libraryRecord: record ? {
      artworkMode: record.artworkMode,
      canonicalArtworkId: record.canonicalArtworkId,
      musicbrainzReleaseId: record.musicbrainzReleaseId,
      musicbrainzReleaseGroupId: record.musicbrainzReleaseGroupId,
      enrichmentStatus: record.enrichmentStatus,
      enrichmentError: record.enrichmentError,
      enrichedAt: record.enrichedAt,
    } : null,
    savedMeta: meta ? {
      source: meta.source,
      artworkSource: meta.artworkSource,
      discogsImageIndex: meta.discogsImageIndex,
      discogsReleaseId: meta.discogsReleaseId,
      discogsMasterId: meta.discogsMasterId,
      musicbrainzReleaseId: meta.musicbrainzReleaseId,
      musicbrainzReleaseGroupId: meta.musicbrainzReleaseGroupId,
      imageCount: meta.images?.length || 0,
      enrichedAt: meta.enrichedAt,
    } : null,
    orderedChoices: ordered.map((choice) => choice.kind === 'navidrome'
      ? { kind: 'navidrome' }
      : {
          kind: 'candidate',
          id: choice.artwork.id,
          source: choice.artwork.source,
          scope: choice.artwork.scope,
          role: choice.artwork.role,
          sourceKey: choice.artwork.sourceKey,
        }),
    candidates,
    legacyImages,
  };
}

export async function captureCurrentArtworkSnapshot(reason: string) {
  const settings = await getStoredSettings();
  const artworkSourceOrder = settings.artworkSourceOrder || DEFAULT_ARTWORK_ORDER;
  const albums = await loadAllAlbums();
  const compact = albums.map((album) => {
    const record = getAlbumRecord(album.id);
    const meta = getAlbumMetaJson<VinylMeta>(album.id);
    const artwork = listArtwork(album.id);
    return {
      albumId: album.id,
      artist: album.artist,
      title: album.name,
      artworkMode: record?.artworkMode,
      canonicalArtworkId: record?.canonicalArtworkId,
      navidromeCover: Boolean(album.coverArt || record?.navidromeCoverArt),
      canonicalCandidates: artwork.filter((item) => item.role === 'front' && item.remoteUrl).length,
      selectedCandidates: artwork.filter((item) => item.userSelected).map((item) => item.id),
      legacyImages: meta?.images?.length || 0,
      metaArtworkSource: meta?.artworkSource,
      discogsImageIndex: meta?.discogsImageIndex,
      orderedFirst: (() => {
        const first = orderedArtworkChoices(album.id, artworkSourceOrder);
        const value = first[0];
        return value?.kind === 'candidate' ? `${value.artwork.source}:${value.artwork.id}` : value?.kind;
      })(),
    };
  });

  recordDiagnostic('artwork-state-snapshot', {
    reason,
    albumCount: compact.length,
    albums: compact,
    enrichment: getEnrichmentStatus(),
  });
  return { albumCount: compact.length };
}

function collectRuntimeSnapshot() {
  const cpu = os.cpus();
  return {
    node: process.version,
    versions: {
      v8: process.versions.v8,
      uv: process.versions.uv,
      openssl: process.versions.openssl,
      zlib: process.versions.zlib,
    },
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    ppid: process.ppid,
    uptimeSeconds: Math.round(process.uptime()),
    processMemory: process.memoryUsage(),
    processCpu: process.cpuUsage(),
    resourceUsage: process.resourceUsage(),
    system: {
      type: os.type(),
      release: os.release(),
      machine: typeof os.machine === 'function' ? os.machine() : undefined,
      uptimeSeconds: Math.round(os.uptime()),
      loadAverage: os.loadavg(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCount: cpu.length,
      cpuModel: cpu[0]?.model,
      cpuSpeedMhz: cpu[0]?.speed,
      hostnameHash: hashOpaque(os.hostname()),
    },
    nodeEnv: process.env.NODE_ENV,
    container: {
      puid: process.env.PUID,
      pgid: process.env.PGID,
      umask: process.env.UMASK,
      timezone: process.env.TZ,
      dockerEnvPresent: fs.existsSync('/.dockerenv'),
    },
  };
}

function readSmallFile(file: string, limit = 12000) {
  try {
    const value = fs.readFileSync(file, 'utf8');
    return value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;
  } catch {
    return undefined;
  }
}

function fileInfo(file: string) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      bytes: stat.size,
      mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      uid: typeof stat.uid === 'number' ? stat.uid : undefined,
      gid: typeof stat.gid === 'number' ? stat.gid : undefined,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    return { exists: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function directoryInventory(root: string) {
  const groups: Record<string, { files: number; directories: number; bytes: number }> = {};
  const largestFiles: Array<{ path: string; bytes: number }> = [];
  let files = 0;
  let directories = 0;
  let bytes = 0;
  let truncated = false;
  const stack: Array<{ value: string; depth: number }> = [{ value: root, depth: 0 }];

  while (stack.length && files + directories < MAX_INVENTORY_FILES) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current.value, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files + directories >= MAX_INVENTORY_FILES) { truncated = true; break; }
      const absolute = path.join(current.value, entry.name);
      const relative = path.relative(root, absolute) || entry.name;
      const groupName = relative.split(path.sep)[0] || '.';
      const group = groups[groupName] || { files: 0, directories: 0, bytes: 0 };
      if (entry.isDirectory()) {
        directories += 1;
        group.directories += 1;
        if (current.depth < 6) stack.push({ value: absolute, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        files += 1;
        group.files += 1;
        try {
          const size = fs.statSync(absolute).size;
          bytes += size;
          group.bytes += size;
          if (!relative.startsWith(`diagnostics${path.sep}events.jsonl`)) {
            largestFiles.push({ path: relative, bytes: size });
            largestFiles.sort((a, b) => b.bytes - a.bytes);
            if (largestFiles.length > 20) largestFiles.pop();
          }
        } catch {}
      }
      groups[groupName] = group;
    }
  }
  if (stack.length) truncated = true;
  return { files, directories, bytes, truncated, limit: MAX_INVENTORY_FILES, groups, largestFiles };
}

function collectFilesystemDiagnostics() {
  const paths = diagnosticsPaths();
  const databasePath = getDatabasePath();
  const dataDir = paths.dataDir;
  let access: Record<string, unknown> = {};
  try {
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK);
    access = { readable: true, writable: true };
  } catch (error) {
    access = { readable: false, writable: false, error: error instanceof Error ? error.message : String(error) };
  }

  let statfs: Record<string, unknown> | undefined;
  try {
    const stat = fs.statfsSync(dataDir);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    statfs = {
      type: String(stat.type),
      blockSize: Number(stat.bsize),
      blocks: Number(stat.blocks),
      freeBlocks: Number(stat.bfree),
      availableBlocks: Number(stat.bavail),
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usedPercent: totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 10000) / 100 : undefined,
    };
  } catch (error) {
    statfs = { error: error instanceof Error ? error.message : String(error) };
  }

  return {
    dataDir,
    access,
    filesystem: statfs,
    keyPaths: {
      dataDir: fileInfo(dataDir),
      database: fileInfo(databasePath),
      databaseWal: fileInfo(`${databasePath}-wal`),
      databaseShm: fileInfo(`${databasePath}-shm`),
      artworkCache: fileInfo(path.join(dataDir, 'artwork-cache')),
      diagnostics: fileInfo(paths.diagnosticsDir),
      events: fileInfo(paths.eventsFile),
      diagnosticsState: fileInfo(paths.stateFile),
    },
    inventory: directoryInventory(dataDir),
  };
}

function collectDatabaseDiagnostics() {
  const databasePath = getDatabasePath();
  if (!fs.existsSync(databasePath)) return { path: databasePath, exists: false };

  let connection: DatabaseSync | undefined;
  try {
    connection = new DatabaseSync(databasePath, { readOnly: true });
    const tables = ['system_kv', 'album_meta', 'albums', 'artwork', 'metadata_values'];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | undefined;
        counts[table] = Number(row?.count || 0);
      } catch {}
    }
    const integrity = connection.prepare('PRAGMA integrity_check(20)').all();
    const foreignKeyViolations = connection.prepare('PRAGMA foreign_key_check').all();
    return {
      path: databasePath,
      exists: true,
      file: fileInfo(databasePath),
      wal: fileInfo(`${databasePath}-wal`),
      shm: fileInfo(`${databasePath}-shm`),
      pragmas: {
        journalMode: connection.prepare('PRAGMA journal_mode').get(),
        foreignKeys: connection.prepare('PRAGMA foreign_keys').get(),
        busyTimeout: connection.prepare('PRAGMA busy_timeout').get(),
        pageCount: connection.prepare('PRAGMA page_count').get(),
        freeListCount: connection.prepare('PRAGMA freelist_count').get(),
        pageSize: connection.prepare('PRAGMA page_size').get(),
      },
      counts,
      integrity,
      foreignKeyViolationCount: foreignKeyViolations.length,
      foreignKeyViolations: foreignKeyViolations.slice(0, 50),
    };
  } catch (error) {
    return { path: databasePath, exists: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try { connection?.close(); } catch {}
  }
}

function eventDuration(event: DiagnosticEvent) {
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
  const value = Number(data.durationMs);
  return Number.isFinite(value) ? value : undefined;
}

function urlHost(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.host === 'string') return record.host;
  if (record.origin && typeof record.origin === 'object') return urlHost(record.origin);
  return undefined;
}

function buildEventAnalysis(events: DiagnosticEvent[]) {
  const warningsAndErrors = events.filter((event) => event.level === 'warn' || event.level === 'error');
  const issuesByType: Record<string, { count: number; firstAt: string; lastAt: string; levels: Record<string, number> }> = {};
  for (const event of warningsAndErrors) {
    const existing = issuesByType[event.type] || { count: 0, firstAt: event.at, lastAt: event.at, levels: {} };
    existing.count += 1;
    existing.lastAt = event.at;
    existing.levels[event.level] = (existing.levels[event.level] || 0) + 1;
    issuesByType[event.type] = existing;
  }

  const slowestOperations = events
    .map((event) => ({ event, durationMs: eventDuration(event) }))
    .filter((item): item is { event: DiagnosticEvent; durationMs: number } => item.durationMs != null)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 50)
    .map(({ event, durationMs }) => ({
      at: event.at,
      seq: event.seq,
      type: event.type,
      level: event.level,
      durationMs,
      data: sanitizeDiagnosticValue(event.data),
    }));

  const blockedArtworkOrigins: Record<string, number> = {};
  for (const event of events.filter((item) => item.type === 'artwork-external-blocked-url')) {
    const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
    const host = urlHost(data.url) || 'unknown';
    const protocol = data.url && typeof data.url === 'object' && typeof (data.url as Record<string, unknown>).protocol === 'string'
      ? String((data.url as Record<string, unknown>).protocol)
      : 'unknown:';
    const key = `${protocol}//${host}`;
    blockedArtworkOrigins[key] = (blockedArtworkOrigins[key] || 0) + 1;
  }

  let sequenceGaps = 0;
  let missingSequenceNumbers = 0;
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index].seq - events[index - 1].seq;
    if (gap > 1) {
      sequenceGaps += 1;
      missingSequenceNumbers += gap - 1;
    }
  }

  const firstAt = events[0]?.at;
  const lastAt = events[events.length - 1]?.at;
  return {
    window: {
      firstAt,
      lastAt,
      durationMs: firstAt && lastAt ? Math.max(0, new Date(lastAt).getTime() - new Date(firstAt).getTime()) : 0,
      sequenceGaps,
      missingSequenceNumbers,
    },
    issuesByType,
    blockedArtworkOrigins,
    slowestOperations,
    recentWarningsAndErrors: warningsAndErrors.slice(-250),
  };
}

function collectContainerDiagnostics() {
  return {
    procSelfStatus: readSmallFile('/proc/self/status'),
    procSelfLimits: readSmallFile('/proc/self/limits'),
    procCgroup: readSmallFile('/proc/self/cgroup'),
    cgroup: {
      memoryCurrent: readSmallFile('/sys/fs/cgroup/memory.current', 1000)?.trim(),
      memoryMax: readSmallFile('/sys/fs/cgroup/memory.max', 1000)?.trim(),
      cpuMax: readSmallFile('/sys/fs/cgroup/cpu.max', 1000)?.trim(),
      pidsCurrent: readSmallFile('/sys/fs/cgroup/pids.current', 1000)?.trim(),
      pidsMax: readSmallFile('/sys/fs/cgroup/pids.max', 1000)?.trim(),
    },
  };
}

export async function getDiagnosticsOverview() {
  const events = readDiagnosticEvents(5000);
  return {
    status: getDiagnosticsStatus(),
    summary: summarizeDiagnosticEvents(events),
    cache: await getArtworkCacheStats(),
    fetchRuntime: getArtworkFetchRuntimeState(),
    enrichment: getEnrichmentStatus(),
    runtime: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
    },
  };
}

export async function buildDiagnosticsExport() {
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];
  const settings = await getStoredSettings();
  const artworkSourceOrder = settings.artworkSourceOrder || DEFAULT_ARTWORK_ORDER;
  const events = readDiagnosticEvents();
  let albums: Album[] = [];
  try {
    albums = await loadAllAlbums();
  } catch (error) {
    errors.push(`Navidrome album inventory: ${error instanceof Error ? error.message : String(error)}`);
  }

  const albumDiagnostics = [];
  for (const album of albums) {
    try {
      albumDiagnostics.push(await buildAlbumDiagnostic(album, artworkSourceOrder));
    } catch (error) {
      errors.push(`Album ${album.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    schema: 'needledrop-diagnostics-v2',
    generatedAt,
    app: {
      name: 'NeedleDrop',
      version: APP_VERSION,
    },
    privacy: {
      credentialsIncluded: false,
      urlQueryValuesIncluded: false,
      urlQueryKeysIncluded: true,
      authorizationHeadersIncluded: false,
      note: 'Secrets, credentials, cookies and URL query values are redacted. Opaque IDs, album metadata and sanitized paths are retained because they are needed to correlate failures.',
    },
    runtime: collectRuntimeSnapshot(),
    container: collectContainerDiagnostics(),
    filesystem: collectFilesystemDiagnostics(),
    database: collectDatabaseDiagnostics(),
    settings: {
      navidromeConfigured: Boolean(settings.navidromeUrl?.trim()),
      navidromeUrl: settings.navidromeUrl ? sanitizeUrlForDiagnostics(settings.navidromeUrl) : undefined,
      discogsEnabled: settings.discogsEnabled,
      discogsAuthConfigured: Boolean(settings.discogsToken?.trim()),
      musicbrainzEnabled: settings.musicbrainzEnabled,
      musicbrainzUserAgentConfigured: Boolean(settings.musicbrainzUserAgent?.trim()),
      coverArtArchiveEnabled: settings.coverArtArchiveEnabled,
      lastfmEnabled: settings.lastfmEnabled,
      lastfmAuthConfigured: Boolean(settings.lastfmApiKey?.trim()),
      autoEnrich: settings.autoEnrich,
      metadataSourceOrder: settings.metadataSourceOrder,
      artworkSourceOrder,
      defaultPlaybackMode: settings.defaultPlaybackMode,
      defaultTurntableSpeed: settings.defaultTurntableSpeed,
      simulateSpeed: settings.simulateSpeed,
      changerEnabled: settings.changerEnabled,
      schemaVersion: settings.schemaVersion,
      updatedAt: settings.updatedAt,
    },
    diagnostics: {
      status: getDiagnosticsStatus(),
      summary: summarizeDiagnosticEvents(events),
      analysis: buildEventAnalysis(events),
      events,
    },
    artworkCache: await getArtworkCacheStats(),
    artworkFetchRuntime: getArtworkFetchRuntimeState(),
    enrichment: getEnrichmentStatus(),
    albumCount: albumDiagnostics.length,
    albums: albumDiagnostics,
    errors,
  };
}
