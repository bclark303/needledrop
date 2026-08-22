import { getArtworkById } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getStoredSettings } from '@/lib/settings';
import { APP_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ candidateId: string }> }) {
  const session = await getSession();
  if (!session) return new Response('UNAUTHENTICATED', { status: 401 });

  try {
    const { candidateId } = await ctx.params;
    const candidate = getArtworkById(Number(candidateId));
    if (!candidate?.remoteUrl) return new Response('Artwork not found', { status: 404 });

    const url = new URL(candidate.remoteUrl);
    const allowed = ['discogs.com', 'coverartarchive.org', 'archive.org']
      .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (url.protocol !== 'https:' || !allowed) return new Response('Unsupported artwork host', { status: 400 });

    const settings = await getStoredSettings();
    const response = await fetch(url, {
      headers: { 'User-Agent': settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)` },
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!response.ok || !response.body) return new Response('Artwork unavailable', { status: response.status || 502 });

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    headers.set('cache-control', 'private, max-age=86400');
    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response('Artwork unavailable', { status: 500 });
  }
}
