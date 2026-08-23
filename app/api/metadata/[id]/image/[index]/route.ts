import crypto from 'crypto';
import { recordDiagnostic, sanitizeUrlForDiagnostics } from '@/lib/diagnostics';
import { getMeta } from '@/lib/store';
import { getStoredSettings } from '@/lib/settings';
import { APP_VERSION } from '@/lib/version';

export async function GET(_: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let albumId = '';
  let imageIndex = -1;
  try {
    const { id, index } = await ctx.params;
    albumId = id;
    imageIndex = Number(index);
    const meta = await getMeta(id);
    const image = meta?.images?.[imageIndex];
    recordDiagnostic('metadata-image-request-start', {
      requestId,
      albumId: id,
      route: 'metadata',
      imageIndex,
      imageCount: meta?.images?.length || 0,
      artworkSource: meta?.artworkSource,
      selectedIndex: meta?.discogsImageIndex,
      discogsReleaseId: meta?.discogsReleaseId,
      hasUri: Boolean(image?.uri),
    });

    if (!image?.uri) {
      recordDiagnostic('metadata-image-request-failed', { requestId, albumId: id, imageIndex, reason: 'missing-uri', durationMs: Date.now() - started }, 'warn');
      return stamped(new Response('Image not found', { status: 404 }), requestId);
    }

    const url = new URL(image.uri);
    if (url.protocol !== 'https:' || !(url.hostname === 'discogs.com' || url.hostname.endsWith('.discogs.com'))) {
      recordDiagnostic('metadata-image-request-failed', {
        requestId,
        albumId: id,
        imageIndex,
        reason: 'unsupported-host',
        url: sanitizeUrlForDiagnostics(image.uri),
        durationMs: Date.now() - started,
      }, 'warn');
      return stamped(new Response('Unsupported image host', { status: 400 }), requestId);
    }

    const settings = await getStoredSettings();
    let networkError = '';
    const fetchStarted = Date.now();
    const response = await fetch(url, {
      headers: { 'User-Agent': settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)` },
      cache: 'no-store',
    }).catch((error) => {
      networkError = error instanceof Error ? error.message : String(error);
      return null;
    });

    recordDiagnostic('metadata-image-fetch-result', {
      requestId,
      albumId: id,
      imageIndex,
      url: sanitizeUrlForDiagnostics(image.uri),
      status: response?.status || 0,
      ok: Boolean(response?.ok),
      redirected: Boolean(response?.redirected),
      finalUrl: response?.url ? sanitizeUrlForDiagnostics(response.url) : undefined,
      contentType: response?.headers.get('content-type'),
      contentLength: response?.headers.get('content-length'),
      networkError: networkError || undefined,
      durationMs: Date.now() - fetchStarted,
    }, response?.ok ? 'info' : 'warn');

    if (!response?.ok || !response.body) {
      recordDiagnostic('metadata-image-request-failed', {
        requestId,
        albumId: id,
        imageIndex,
        reason: 'upstream-failure',
        status: response?.status || 0,
        durationMs: Date.now() - started,
      }, 'warn');
      return stamped(new Response('Image unavailable', { status: response?.status || 502 }), requestId);
    }

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    if (contentType) headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    headers.set('cache-control', 'private, max-age=3600');
    headers.set('x-needledrop-artwork-source', 'discogs-metadata');
    headers.set('x-needledrop-artwork-cache', 'passthrough');

    recordDiagnostic('metadata-image-request-served', {
      requestId,
      albumId: id,
      imageIndex,
      source: 'discogs-metadata',
      cache: 'passthrough',
      contentType,
      contentLength,
      durationMs: Date.now() - started,
    });
    return stamped(new Response(response.body, { status: 200, headers }), requestId);
  } catch (error) {
    recordDiagnostic('metadata-image-request-exception', {
      requestId,
      albumId,
      imageIndex,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - started,
    }, 'error');
    return stamped(new Response('Image unavailable', { status: 500 }), requestId);
  }
}

function stamped(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set('x-needledrop-artwork-request-id', requestId);
  headers.set('x-needledrop-artwork-route', 'metadata');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
