import { getMeta } from '@/lib/store';
import { getStoredSettings } from '@/lib/settings';
import { APP_VERSION } from '@/lib/version';

export async function GET(_: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  try {
    const { id, index } = await ctx.params;
    const meta = await getMeta(id);
    const image = meta?.images?.[Number(index)];
    if (!image?.uri) return new Response('Image not found', { status: 404 });

    const url = new URL(image.uri);
    if (url.protocol !== 'https:' || !(url.hostname === 'discogs.com' || url.hostname.endsWith('.discogs.com'))) {
      return new Response('Unsupported image host', { status: 400 });
    }

    const settings = await getStoredSettings();
    const response = await fetch(url, {
      headers: { 'User-Agent': settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)` },
      cache: 'no-store',
    });
    if (!response.ok || !response.body) return new Response('Image unavailable', { status: response.status || 502 });

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    if (contentType) headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    headers.set('cache-control', 'private, max-age=3600');
    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response('Image unavailable', { status: 500 });
  }
}
