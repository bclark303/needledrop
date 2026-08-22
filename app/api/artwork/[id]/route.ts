import { getCanonicalArtwork } from '@/lib/db';
import { getStoredSettings } from '@/lib/settings';
import { mediaUrl } from '@/lib/subsonic';
import { APP_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const settings = await getStoredSettings();
    const choice = getCanonicalArtwork(id, settings.artworkSourceOrder);

    if (choice.artwork?.remoteUrl) {
      const response = await fetchExternalArtwork(choice.artwork.remoteUrl, settings.musicbrainzUserAgent);
      if (response) return response;
    }

    if ((choice.useNavidrome || !choice.artwork) && choice.album?.navidromeCoverArt) {
      const size = new URL(request.url).searchParams.get('size') || '1000';
      const url = await mediaUrl('getCoverArt', choice.album.navidromeCoverArt, { size });
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok && response.body) return imageResponse(response, 3600);
    }

    return Response.redirect(new URL('/needledrop-icon.svg', request.url), 302);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') return new Response('UNAUTHENTICATED', { status: 401 });
    return Response.redirect(new URL('/needledrop-icon.svg', request.url), 302);
  }
}

async function fetchExternalArtwork(value: string, configuredUserAgent?: string) {
  const url = new URL(value);
  const allowed = [
    'discogs.com',
    'coverartarchive.org',
    'archive.org',
  ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !allowed) return null;

  const response = await fetch(url, {
    headers: { 'User-Agent': configuredUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)` },
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok || !response.body) return null;
  return imageResponse(response, 86400);
}

function imageResponse(response: Response, maxAge: number) {
  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  if (contentType) headers.set('content-type', contentType);
  if (contentLength) headers.set('content-length', contentLength);
  headers.set('cache-control', `private, max-age=${maxAge}`);
  return new Response(response.body, { status: 200, headers });
}
