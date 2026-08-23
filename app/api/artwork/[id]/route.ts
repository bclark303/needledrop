import crypto from 'crypto';
import type { VinylMeta } from '@/components/types';
import { fetchCachedExternalArtwork } from '@/lib/artwork-cache';
import { orderedArtworkChoices } from '@/lib/artwork-resolution';
import { getAlbumMetaJson, getAlbumRecord } from '@/lib/db';
import { recordDiagnostic } from '@/lib/diagnostics';
import { classifyNavidromeArtwork } from '@/lib/navidrome-artwork';
import { getStoredSettings } from '@/lib/settings';
import { backfillArtworkCandidatesFromMeta } from '@/lib/store';
import { mediaUrl } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const settings = await getStoredSettings();
    const album = getAlbumRecord(id);
    const legacyMeta = getAlbumMetaJson<VinylMeta>(id);
    const requestUrl = new URL(request.url);
    const size = requestUrl.searchParams.get('size') || '1000';

    recordDiagnostic('artwork-request-start', {
      requestId,
      albumId: id,
      route: 'collection',
      size,
      cacheBust: requestUrl.searchParams.has('_ndv'),
      album: album ? {
        artist: album.artist,
        title: album.title,
        artworkMode: album.artworkMode,
        canonicalArtworkId: album.canonicalArtworkId,
        navidromeCover: Boolean(album.navidromeCoverArt),
        enrichmentStatus: album.enrichmentStatus,
        enrichedAt: album.enrichedAt,
      } : null,
      legacy: legacyMeta ? {
        artworkSource: legacyMeta.artworkSource,
        discogsImageIndex: legacyMeta.discogsImageIndex,
        discogsReleaseId: legacyMeta.discogsReleaseId,
        imageCount: legacyMeta.images?.length || 0,
      } : null,
    });

    const backfilled = backfillArtworkCandidatesFromMeta(id, legacyMeta);
    const choices = orderedArtworkChoices(id, settings.artworkSourceOrder);
    recordDiagnostic('artwork-request-choices', {
      requestId,
      albumId: id,
      backfilled,
      artworkSourceOrder: settings.artworkSourceOrder,
      choices: choices.map((choice) => choice.kind === 'navidrome'
        ? { kind: 'navidrome' }
        : {
            kind: 'candidate',
            id: choice.artwork.id,
            source: choice.artwork.source,
            scope: choice.artwork.scope,
            role: choice.artwork.role,
            sourceKey: choice.artwork.sourceKey,
            userSelected: choice.artwork.userSelected,
            hasRemoteUrl: Boolean(choice.artwork.remoteUrl),
          }),
    });

    for (const [choiceIndex, choice] of choices.entries()) {
      if (choice.kind === 'candidate' && choice.artwork.remoteUrl) {
        recordDiagnostic('artwork-request-candidate-attempt', {
          requestId,
          albumId: id,
          choiceIndex,
          candidateId: choice.artwork.id,
          source: choice.artwork.source,
          scope: choice.artwork.scope,
          sourceKey: choice.artwork.sourceKey,
        });
        const response = await fetchCachedExternalArtwork(
          choice.artwork.remoteUrl,
          settings.musicbrainzUserAgent,
          settings.discogsToken,
          {
            requestId,
            albumId: id,
            route: 'collection',
            candidateSource: choice.artwork.source,
            candidateId: choice.artwork.id,
            candidateScope: choice.artwork.scope,
          },
        );
        if (response) {
          recordDiagnostic('artwork-request-served', {
            requestId,
            albumId: id,
            route: 'collection',
            logicalSource: choice.artwork.source,
            source: response.headers.get('x-needledrop-artwork-source') || choice.artwork.source,
            cache: response.headers.get('x-needledrop-artwork-cache') || 'unknown',
            candidateId: choice.artwork.id,
            choiceIndex,
            contentType: response.headers.get('content-type'),
            contentLength: response.headers.get('content-length'),
            durationMs: Date.now() - started,
          });
          return stampResponse(response, requestId, 'collection');
        }
      }

      if (choice.kind === 'navidrome' && album?.navidromeCoverArt) {
        const attemptStarted = Date.now();
        let networkError = '';
        const url = await mediaUrl('getCoverArt', album.navidromeCoverArt, { size });
        const response = await fetch(url, { cache: 'no-store' }).catch((error) => {
          networkError = error instanceof Error ? error.message : String(error);
          return null;
        });
        const contentType = response?.headers.get('content-type');
        recordDiagnostic('artwork-navidrome-fetch-result', {
          requestId,
          albumId: id,
          choiceIndex,
          status: response?.status || 0,
          ok: Boolean(response?.ok),
          contentType,
          contentLength: response?.headers.get('content-length'),
          networkError: networkError || undefined,
          durationMs: Date.now() - attemptStarted,
        }, response?.ok ? 'info' : 'warn');
        if (response?.ok && response.body && contentType?.toLocaleLowerCase().startsWith('image/')) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const fingerprint = classifyNavidromeArtwork({
            albumId: id,
            artist: album.artist,
            title: album.title,
            bytes,
            contentType,
          });
          recordDiagnostic('artwork-navidrome-fingerprint', {
            requestId,
            albumId: id,
            choiceIndex,
            hash: fingerprint.shortHash,
            bytes: fingerprint.bytes,
            generic: fingerprint.generic,
            distinctAlbumCount: fingerprint.distinctAlbumCount,
            distinctIdentityCount: fingerprint.distinctIdentityCount,
          }, fingerprint.generic ? 'warn' : 'debug');

          if (fingerprint.generic) {
            recordDiagnostic('artwork-navidrome-generic-rejected', {
              requestId,
              albumId: id,
              choiceIndex,
              hash: fingerprint.shortHash,
              bytes: fingerprint.bytes,
              distinctIdentityCount: fingerprint.distinctIdentityCount,
            }, 'warn');
            continue;
          }

          const served = imageBytesResponse(bytes, contentType, 3600, 'navidrome');
          recordDiagnostic('artwork-request-served', {
            requestId,
            albumId: id,
            route: 'collection',
            logicalSource: 'navidrome',
            source: 'navidrome',
            cache: 'passthrough',
            choiceIndex,
            contentType: served.headers.get('content-type'),
            contentLength: served.headers.get('content-length'),
            fingerprint: fingerprint.shortHash,
            durationMs: Date.now() - started,
          });
          return stampResponse(served, requestId, 'collection');
        }
      }
    }

    const legacyUrls = legacyArtworkUrls(legacyMeta);
    for (const [legacyIndex, value] of legacyUrls.entries()) {
      recordDiagnostic('artwork-request-legacy-attempt', {
        requestId,
        albumId: id,
        legacyIndex,
      });
      const response = await fetchCachedExternalArtwork(
        value,
        settings.musicbrainzUserAgent,
        settings.discogsToken,
        { requestId, albumId: id, route: 'collection', candidateSource: 'legacy-discogs', candidateId: legacyIndex },
      );
      if (response) {
        recordDiagnostic('artwork-request-served', {
          requestId,
          albumId: id,
          route: 'collection',
          logicalSource: 'legacy-discogs',
          source: response.headers.get('x-needledrop-artwork-source') || 'legacy-discogs',
          cache: response.headers.get('x-needledrop-artwork-cache') || 'unknown',
          legacyIndex,
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length'),
          durationMs: Date.now() - started,
        });
        return stampResponse(response, requestId, 'collection');
      }
    }

    recordDiagnostic('artwork-request-placeholder', {
      requestId,
      albumId: id,
      route: 'collection',
      choiceCount: choices.length,
      legacyUrlCount: legacyUrls.length,
      durationMs: Date.now() - started,
    }, 'warn');
    return stampResponse(placeholderResponse(album?.artist, album?.title), requestId, 'collection');
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      recordDiagnostic('artwork-request-auth-failed', { requestId, albumId: id, route: 'collection', durationMs: Date.now() - started }, 'warn');
      return new Response('UNAUTHENTICATED', { status: 401 });
    }
    const album = getAlbumRecord(id);
    recordDiagnostic('artwork-request-exception', {
      requestId,
      albumId: id,
      route: 'collection',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - started,
    }, 'error');
    return stampResponse(placeholderResponse(album?.artist, album?.title), requestId, 'collection');
  }
}

function legacyArtworkUrls(meta?: VinylMeta | null) {
  if (!meta?.images?.length) return [];
  const images = meta.images;
  const ordered = [...images.keys()];
  const selected = Number.isInteger(meta.discogsImageIndex) ? Number(meta.discogsImageIndex) : -1;
  const primary = images.findIndex((image) => image.type === 'primary');
  const preferred = [selected, primary, 0, ...ordered]
    .filter((index, position, list) => index >= 0 && index < images.length && list.indexOf(index) === position);
  const urls: string[] = [];
  for (const index of preferred) {
    const image = images[index];
    for (const value of [image?.uri, image?.uri150]) {
      if (value && !urls.includes(value)) urls.push(value);
    }
  }
  return urls;
}

function stampResponse(response: Response, requestId: string, route: string) {
  const headers = new Headers(response.headers);
  headers.set('x-needledrop-artwork-request-id', requestId);
  headers.set('x-needledrop-artwork-route', route);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function imageBytesResponse(bytes: Uint8Array, contentType: string, maxAge: number, source: string) {
  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('content-length', String(bytes.byteLength));
  headers.set('cache-control', `private, max-age=${maxAge}`);
  headers.set('x-needledrop-artwork-source', source);
  headers.set('x-needledrop-artwork-cache', 'passthrough');
  return new Response(bytes, { status: 200, headers });
}

function placeholderResponse(artist = 'Unknown artist', title = 'Artwork unavailable') {
  const titleLines = wrap(title, 22, 3);
  const artistLines = wrap(artist, 28, 2);
  const titleSvg = titleLines.map((line, index) => `<text x="72" y="${690 + index * 66}" class="title">${escapeXml(line)}</text>`).join('');
  const artistLinesSvg = artistLines.map((line, index) => `<text x="74" y="${885 + index * 38}" class="artist">${escapeXml(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <radialGradient id="record" cx="48%" cy="42%" r="58%"><stop offset="0" stop-color="#34312b"/><stop offset="0.3" stop-color="#11100e"/><stop offset="0.72" stop-color="#24211d"/><stop offset="1" stop-color="#090908"/></radialGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2a241e"/><stop offset="1" stop-color="#151310"/></linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#paper)"/>
  <rect x="32" y="32" width="936" height="936" rx="12" fill="none" stroke="#695b4b" stroke-width="2"/>
  <circle cx="500" cy="330" r="245" fill="url(#record)" stroke="#080807" stroke-width="8"/>
  <circle cx="500" cy="330" r="86" fill="#b46f56"/>
  <circle cx="500" cy="330" r="12" fill="#171411"/>
  <g fill="none" stroke="#4b4640" opacity="0.45"><circle cx="500" cy="330" r="216"/><circle cx="500" cy="330" r="198"/><circle cx="500" cy="330" r="180"/><circle cx="500" cy="330" r="162"/><circle cx="500" cy="330" r="144"/></g>
  <text x="72" y="610" class="mark">NEEDLEDROP · ARTWORK NOT FOUND</text>
  ${titleSvg}
  ${artistLinesSvg}
  <style>.mark{fill:#a99b88;font:600 24px ui-sans-serif,system-ui,sans-serif;letter-spacing:4px}.title{fill:#f0e5d2;font:700 52px Georgia,serif}.artist{fill:#c9b9a2;font:400 28px ui-sans-serif,system-ui,sans-serif;letter-spacing:1px}</style>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-needledrop-artwork-source': 'placeholder',
      'x-needledrop-artwork-cache': 'none',
    },
  });
}

function wrap(value: string, max: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max || !current) current = next;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(' ').length > lines.join(' ').length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, '')}…`;
  return lines;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] || character));
}
