import crypto from 'crypto';
import type { Album, VinylMeta } from '@/components/types';
import { getArtworkCacheEntryStatus, getArtworkCacheStats, getArtworkFetchRuntimeState } from './artwork-cache';
import { orderedArtworkChoices } from './artwork-resolution';
import { getAlbumMetaJson, getAlbumRecord, getEnrichmentStatus, listArtwork } from './db';
import {
  getDiagnosticsStatus,
  readDiagnosticEvents,
  recordDiagnostic,
  sanitizeUrlForDiagnostics,
  summarizeDiagnosticEvents,
} from './diagnostics';
import { getStoredSettings } from './settings';
import { subsonic } from './subsonic';
import { APP_VERSION } from './version';

const DEFAULT_ARTWORK_ORDER = ['discogs', 'coverartarchive', 'navidrome'];

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
        const first = orderedArtworkChoices(album.id, artworkSourceOrder)[0];
        return first?.kind === 'candidate' ? `${first.artwork.source}:${first.artwork.id}` : first?.kind;
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

export async function getDiagnosticsOverview() {
  const events = readDiagnosticEvents(5000);
  return {
    status: getDiagnosticsStatus(),
    summary: summarizeDiagnosticEvents(events),
    cache: await getArtworkCacheStats(),
    fetchRuntime: getArtworkFetchRuntimeState(),
    enrichment: getEnrichmentStatus(),
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
    schema: 'needledrop-diagnostics-v1',
    generatedAt,
    app: {
      name: 'NeedleDrop',
      version: APP_VERSION,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      nodeEnv: process.env.NODE_ENV,
      puid: process.env.PUID,
      pgid: process.env.PGID,
      umask: process.env.UMASK,
      dataDir: process.env.NEEDLEDROP_DATA_DIR || '/data',
    },
    settings: {
      discogsEnabled: settings.discogsEnabled,
      discogsAuthConfigured: Boolean(settings.discogsToken?.trim()),
      musicbrainzEnabled: settings.musicbrainzEnabled,
      coverArtArchiveEnabled: settings.coverArtArchiveEnabled,
      lastfmEnabled: settings.lastfmEnabled,
      lastfmAuthConfigured: Boolean(settings.lastfmApiKey?.trim()),
      autoEnrich: settings.autoEnrich,
      metadataSourceOrder: settings.metadataSourceOrder,
      artworkSourceOrder,
      defaultPlaybackMode: settings.defaultPlaybackMode,
    },
    diagnostics: {
      status: getDiagnosticsStatus(),
      summary: summarizeDiagnosticEvents(events),
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
