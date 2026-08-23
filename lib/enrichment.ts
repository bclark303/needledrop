import type { Album, VinylMeta } from '@/components/types';
import {
  getAlbumRecord,
  getEnrichmentStatus,
  getMetadataValues,
  indexAlbums,
  listArtwork,
  setEnrichmentStatus,
  updateAlbumIdentity,
  upsertArtworkCandidate,
  upsertMetadataValue,
  type EnrichmentStatus,
} from './db';
import { albumLookupTitles } from './album-normalization';
import { resolveCanonicalArtwork } from './artwork-resolution';
import { getMeta, saveMeta } from './store';
import { getStoredSettings } from './settings';
import { findRelease, findReleaseGroup } from './musicbrainz';
import { artworkRole, getCoverArtArchiveImages } from './coverartarchive';
import { getLastFmAlbumInfo } from './lastfm';
import { searchDiscogs } from './discogs';
import { navidromeArtworkKnownGeneric } from './navidrome-artwork';

let running: Promise<void> | null = null;
const ARTWORK_RESOLVER_VERSION = 4;

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
  if (artwork.artwork) return true;
  if (artwork.useNavidrome) return !navidromeArtworkKnownGeneric(albumId);
  return false;
}

export async function maybeAutoEnrich(albums: Album[]) {
  const settings = await getStoredSettings();
  if (settings.autoEnrich === false || running) return;
  const pending = albums.filter((album) => {
    const record = getAlbumRecord(album.id);
    if (!record || record.enrichmentStatus !== 'complete' || !recentEnough(record.enrichedAt)) return true;
    return !resolverCurrent(album.id);
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
      const needsNewArtworkPass = !resolverCurrent(album.id);
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
  const lookupTitles = albumLookupTitles(album.name);

  recordDiscogsProvenance(album.id, meta);

  let releaseId = getAlbumRecord(album.id)?.musicbrainzReleaseId;
  let releaseGroupId = getAlbumRecord(album.id)?.musicbrainzReleaseGroupId;
  let matched = false;

  if (settings.musicbrainzEnabled !== false) {
    if (meta?.discogsReleaseId && !releaseId) {
      const exact = await findRelease({
        artist: album.artist,
        title: meta.pressingTitle || lookupTitles[0] || album.name,
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
      for (const lookupTitle of lookupTitles) {
        const group = await findReleaseGroup(album.artist, lookupTitle).catch(() => null);
        if (!group) continue;
        releaseGroupId = group.id;
        upsertMetadataValue(album.id, 'musicbrainzReleaseGroupId', group.id, 'musicbrainz', group.id, group.score >= 90 ? 'high' : 'matched', true);
        if (lookupTitle !== album.name) upsertMetadataValue(album.id, 'normalizedLookupTitle', lookupTitle, 'needledrop', 'title-normalizer-v1', 'system');
        matched = true;
        break;
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

  // Keep a Discogs search cover as a last-resort external candidate for every
  // auto-mode album. It remains library-scope, so exact/release-group artwork
  // and a legitimate Navidrome cover still win. If Navidrome later fingerprints
  // as a generic placeholder, the artwork route can safely fall through here.
  const indexed = getAlbumRecord(album.id);
  const hasDiscogsCandidate = listArtwork(album.id).some((item) => item.source === 'discogs' && item.role === 'front' && item.remoteUrl);
  const needsDiscogsFallback = indexed?.artworkMode === 'auto' && !hasDiscogsCandidate;
  if (needsDiscogsFallback && settings.discogsEnabled !== false && settings.discogsToken?.trim()) {
    let usable: Array<Record<string, unknown>> = [];
    let matchedLookupTitle = lookupTitles[0] || album.name;
    for (const lookupTitle of lookupTitles) {
      const results = await searchDiscogs(album.artist, lookupTitle).catch(() => []);
      usable = results
        .filter((result: Record<string, unknown>) => usableDiscogsImage(result.cover_image) || usableDiscogsImage(result.thumb))
        .slice(0, 6);
      if (usable.length) {
        matchedLookupTitle = lookupTitle;
        break;
      }
    }
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
        { releaseId: releaseIdValue, title: result.title, country: result.country, year: result.year, lookupTitle: matchedLookupTitle },
        'discogs',
        String(releaseIdValue),
        'album-match',
      );
    }
    if (usable.length) matched = true;
  }

  let lastfmPatch: Partial<VinylMeta> = {};
  if (settings.lastfmEnabled !== false && settings.lastfmApiKey?.trim()) {
    let lastfm: Awaited<ReturnType<typeof getLastFmAlbumInfo>> | null = null;
    for (const lookupTitle of lookupTitles) {
      lastfm = await getLastFmAlbumInfo(album.artist, lookupTitle, settings.lastfmApiKey).catch(() => null);
      if (lastfm) break;
    }
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

  upsertMetadataValue(album.id, 'artworkResolverVersion', ARTWORK_RESOLVER_VERSION, 'needledrop', 'artwork-v4', 'system', true);

  const enrichedAt = new Date().toISOString();
  updateAlbumIdentity(album.id, { enrichmentStatus: 'complete', enrichmentError: undefined, enrichedAt });
  await saveMeta(album.id, { musicbrainzReleaseId: releaseId, musicbrainzReleaseGroupId: releaseGroupId, ...lastfmPatch, enrichedAt });

  return { matched, artworkResolved: hasArtwork(album.id, settings.artworkSourceOrder) };
}

function usableDiscogsImage(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return undefined;
  if (/spacer\.gif|no[-_ ]?image|placeholder/i.test(value)) return undefined;
  return value;
}

async function importCoverArt(albumId: string, scope: 'release' | 'release-group', sourceId: string, artScope: 'exact-release' | 'release-group') {
  // CAA provides a stable "front" route even when the JSON image listing is
  // temporarily unavailable. It is safe to keep this as a candidate because
  // the artwork delivery route verifies the response and falls through on 404.
  upsertArtworkCandidate({
    albumId,
    source: 'coverartarchive',
    scope: artScope,
    role: 'front',
    sourceKey: `caa-front:${scope}:${sourceId}`,
    sourceId,
    remoteUrl: `https://coverartarchive.org/${scope}/${encodeURIComponent(sourceId)}/front-1200`,
  });

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
      remoteUrl: normalizeCoverArtUrl(image.image),
    });
  });
}

function normalizeCoverArtUrl(value: string) {
  return value.replace(/^http:\/\/coverartarchive\.org\//i, 'https://coverartarchive.org/');
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
