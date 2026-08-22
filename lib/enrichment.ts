import type { Album, VinylMeta } from '@/components/types';
import {
  getAlbumRecord,
  getEnrichmentStatus,
  getMetadataValues,
  indexAlbums,
  setEnrichmentStatus,
  updateAlbumIdentity,
  upsertArtworkCandidate,
  upsertMetadataValue,
  type EnrichmentStatus,
} from './db';
import { resolveCanonicalArtwork } from './artwork-resolution';
import { getMeta, saveMeta } from './store';
import { getStoredSettings } from './settings';
import { findRelease, findReleaseGroup } from './musicbrainz';
import { artworkRole, getCoverArtArchiveImages } from './coverartarchive';
import { getLastFmAlbumInfo } from './lastfm';
import { searchDiscogs } from './discogs';

let running: Promise<void> | null = null;
const ARTWORK_RESOLVER_VERSION = 2;

function recentEnough(value?: string) {
  if (!value) return false;
  const age = Date.now() - new Date(value).getTime();
  return Number.isFinite(age) && age < 30 * 24 * 60 * 60 * 1000;
}

function resolverCurrent(albumId: string) {
  return getMetadataValues(albumId).some((item) =>
    item.field === 'artworkResolverVersion' &&
    item.source === 'needledrop' &&
    Number(item.value) >= ARTWORK_RESOLVER_VERSION,
  );
}

function hasArtwork(albumId: string, sourceOrder?: string[]) {
  const artwork = resolveCanonicalArtwork(albumId, sourceOrder);
  return Boolean(artwork.artwork || artwork.useNavidrome);
}

export async function maybeAutoEnrich(albums: Album[]) {
  const settings = await getStoredSettings();
  if (settings.autoEnrich === false || running) return;
  const pending = albums.filter((album) => {
    const record = getAlbumRecord(album.id);
    if (!record || record.enrichmentStatus !== 'complete' || !recentEnough(record.enrichedAt)) return true;
    return !hasArtwork(album.id, settings.artworkSourceOrder) && !resolverCurrent(album.id);
  });
  if (!pending.length) return;
  startEnrichment(pending, false);
}

export function startEnrichment(albums: Album[], force = false) {
  if (running) return getEnrichmentStatus();
  const status: EnrichmentStatus = {
    state: 'running',
    total: albums.length,
    completed: 0,
    matched: 0,
    artworkResolved: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    message: force ? 'Refreshing collection metadata' : 'Enriching collection metadata',
  };
  setEnrichmentStatus(status);
  running = run(albums, force).finally(() => { running = null; });
  return status;
}

export function enrichmentIsRunning() {
  return Boolean(running);
}

async function run(albums: Album[], force: boolean) {
  let status = getEnrichmentStatus();
  const settings = await getStoredSettings();
  try {
    indexAlbums(albums);
    for (const album of albums) {
      status = { ...status, currentAlbum: `${album.artist} — ${album.name}` };
      setEnrichmentStatus(status);
      const existing = getAlbumRecord(album.id);
      const artworkAlreadyResolved = hasArtwork(album.id, settings.artworkSourceOrder);
      const needsNewArtworkPass = !artworkAlreadyResolved && !resolverCurrent(album.id);
      if (!force && existing?.enrichmentStatus === 'complete' && recentEnough(existing.enrichedAt) && !needsNewArtworkPass) {
        status = {
          ...status,
          completed: status.completed + 1,
          matched: status.matched + (existing.musicbrainzReleaseGroupId || existing.lastfmMbid ? 1 : 0),
          artworkResolved: status.artworkResolved + (artworkAlreadyResolved ? 1 : 0),
        };
        setEnrichmentStatus(status);
        continue;
      }

      try {
        const result = await enrichAlbum(album);
        status = {
          ...status,
          completed: status.completed + 1,
          matched: status.matched + (result.matched ? 1 : 0),
          artworkResolved: status.artworkResolved + (result.artworkResolved ? 1 : 0),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown enrichment error';
        updateAlbumIdentity(album.id, { enrichmentStatus: 'error', enrichmentError: message, enrichedAt: new Date().toISOString() });
        status = { ...status, completed: status.completed + 1, failed: status.failed + 1, message };
      }
      setEnrichmentStatus(status);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    status = {
      ...status,
      state: 'complete',
      currentAlbum: undefined,
      finishedAt: new Date().toISOString(),
      message: `Resolved artwork for ${status.artworkResolved} of ${status.total} albums.`,
    };
    setEnrichmentStatus(status);
  } catch (error) {
    setEnrichmentStatus({
      ...status,
      state: 'error',
      currentAlbum: undefined,
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Collection enrichment failed',
    });
  }
}

export async function enrichAlbum(album: Album) {
  indexAlbums([album]);
  const settings = await getStoredSettings();
  const meta = await getMeta(album.id);
  if (meta) await saveMeta(album.id, {});

  recordDiscogsProvenance(album.id, meta);

  let releaseId = getAlbumRecord(album.id)?.musicbrainzReleaseId;
  let releaseGroupId = getAlbumRecord(album.id)?.musicbrainzReleaseGroupId;
  let matched = false;

  if (settings.musicbrainzEnabled !== false) {
    if (meta?.discogsReleaseId && !releaseId) {
      const exact = await findRelease({
        artist: album.artist,
        title: meta.pressingTitle || album.name,
        country: meta.country,
        year: meta.releaseYear || album.year,
        catalogNumber: meta.catalogNumber,
      }).catch(() => null);
      if (exact) {
        releaseId = exact.id;
        releaseGroupId = exact.releaseGroupId || releaseGroupId;
        upsertMetadataValue(album.id, 'musicbrainzReleaseId', exact.id, 'musicbrainz', exact.id, 'exact-release', true);
        if (exact.releaseGroupId) upsertMetadataValue(album.id, 'musicbrainzReleaseGroupId', exact.releaseGroupId, 'musicbrainz', exact.releaseGroupId, 'exact-release', true);
        matched = true;
      }
    }

    if (!releaseGroupId) {
      const group = await findReleaseGroup(album.artist, album.name).catch(() => null);
      if (group) {
        releaseGroupId = group.id;
        upsertMetadataValue(album.id, 'musicbrainzReleaseGroupId', group.id, 'musicbrainz', group.id, group.score >= 90 ? 'high' : 'matched', true);
        matched = true;
      }
    }
  }

  updateAlbumIdentity(album.id, {
    musicbrainzReleaseId: releaseId,
    musicbrainzReleaseGroupId: releaseGroupId,
    enrichmentStatus: 'running',
    enrichmentError: undefined,
  });

  if (settings.coverArtArchiveEnabled !== false) {
    if (releaseId) await importCoverArt(album.id, 'release', releaseId, 'exact-release');
    if (releaseGroupId) await importCoverArt(album.id, 'release-group', releaseGroupId, 'release-group');
  }

  // If Navidrome and Cover Art Archive still leave the jacket empty, use a
  // Discogs search result as an album-level artwork candidate. This does NOT
  // select that result as the user's physical pressing; exact pressing choice
  // remains a separate explicit action in the metadata drawer.
  if (!hasArtwork(album.id, settings.artworkSourceOrder) && settings.discogsEnabled !== false && settings.discogsToken?.trim()) {
    const results = await searchDiscogs(album.artist, album.name).catch(() => []);
    const usable = results
      .filter((result: Record<string, unknown>) => usableDiscogsImage(result.cover_image) || usableDiscogsImage(result.thumb))
      .slice(0, 4);
    for (const result of usable) {
      const releaseIdValue = Number(result.id);
      const remoteUrl = usableDiscogsImage(result.cover_image) || usableDiscogsImage(result.thumb);
      if (!remoteUrl || !Number.isFinite(releaseIdValue)) continue;
      upsertArtworkCandidate({
        albumId: album.id,
        source: 'discogs',
        scope: 'library',
        role: 'front',
        sourceKey: `discogs-search:${releaseIdValue}`,
        sourceId: String(releaseIdValue),
        remoteUrl,
      });
      upsertMetadataValue(
        album.id,
        'artworkFallbackMatch',
        { releaseId: releaseIdValue, title: result.title, country: result.country, year: result.year },
        'discogs',
        String(releaseIdValue),
        'album-match',
      );
    }
    if (usable.length) matched = true;
  }

  let lastfmPatch: Partial<VinylMeta> = {};
  if (settings.lastfmEnabled !== false && settings.lastfmApiKey?.trim()) {
    const lastfm = await getLastFmAlbumInfo(album.artist, album.name, settings.lastfmApiKey).catch(() => null);
    if (lastfm) {
      updateAlbumIdentity(album.id, {
        lastfmMbid: lastfm.mbid,
        lastfmUrl: lastfm.url,
        lastfmListeners: lastfm.listeners,
        lastfmPlaycount: lastfm.playcount,
        lastfmSummary: lastfm.summary,
        lastfmTags: lastfm.tags,
      });
      if (lastfm.tags.length) upsertMetadataValue(album.id, 'tags', lastfm.tags, 'lastfm', lastfm.mbid || '', 'community');
      if (lastfm.summary) upsertMetadataValue(album.id, 'summary', lastfm.summary, 'lastfm', lastfm.mbid || '', 'community');
      lastfmPatch = { lastfmTags: lastfm.tags, lastfmSummary: lastfm.summary, lastfmUrl: lastfm.url };
      matched = true;
    }
  }

  upsertMetadataValue(album.id, 'artworkResolverVersion', ARTWORK_RESOLVER_VERSION, 'needledrop', 'artwork-v2', 'system', true);

  const enrichedAt = new Date().toISOString();
  updateAlbumIdentity(album.id, { enrichmentStatus: 'complete', enrichmentError: undefined, enrichedAt });
  await saveMeta(album.id, { musicbrainzReleaseId: releaseId, musicbrainzReleaseGroupId: releaseGroupId, ...lastfmPatch, enrichedAt });

  const artwork = resolveCanonicalArtwork(album.id, settings.artworkSourceOrder);
  return { matched, artworkResolved: Boolean(artwork.artwork || artwork.useNavidrome) };
}

function usableDiscogsImage(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return undefined;
  if (/spacer\.gif|no[-_ ]?image|placeholder/i.test(value)) return undefined;
  return value;
}

async function importCoverArt(albumId: string, scope: 'release' | 'release-group', sourceId: string, artScope: 'exact-release' | 'release-group') {
  const images = await getCoverArtArchiveImages(scope, sourceId).catch(() => []);
  images.forEach((image, index) => {
    if (!image.image) return;
    upsertArtworkCandidate({
      albumId,
      source: 'coverartarchive',
      scope: artScope,
      role: artworkRole(image),
      sourceKey: `caa:${scope}:${sourceId}:${image.id || index}`,
      sourceId,
      remoteUrl: image.image,
    });
  });
}

function recordDiscogsProvenance(albumId: string, meta: VinylMeta | null) {
  if (!meta?.discogsReleaseId) return;
  const sourceId = String(meta.discogsReleaseId);
  const values: Array<[string, unknown]> = [
    ['releaseId', meta.discogsReleaseId],
    ['country', meta.country],
    ['year', meta.releaseYear],
    ['label', meta.pressingLabel],
    ['catalogNumber', meta.catalogNumber],
    ['format', meta.formatDescription],
    ['genres', meta.genres],
    ['styles', meta.styles],
    ['credits', meta.credits],
    ['identifiers', meta.identifiers],
  ];
  for (const [field, value] of values) if (value !== undefined && value !== null) upsertMetadataValue(albumId, field, value, 'discogs', sourceId, 'exact-release', true);
}
