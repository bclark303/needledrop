import { NextResponse } from 'next/server';
import type { Album } from '@/components/types';
import { getAlbumRecord, getMetadataValues, indexAlbums, listArtwork } from '@/lib/db';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { getMeta, saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';
import { discogsConfigured, searchDiscogs } from '@/lib/discogs';
import { getStoredSettings } from '@/lib/settings';
import { APP_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const root = await subsonic('getAlbum', { id });
    const album = root.album as Album;
    indexAlbums([album]);
    void maybeAutoEnrich([album]).catch(() => {});
    const saved = await getMeta(id);
    const settings = await getStoredSettings();
    const q = encodeURIComponent(`release:\"${album.name}\" AND artist:\"${album.artist}\" AND format:vinyl`);
    const ua = settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`;

    const musicbrainzPromise = settings.musicbrainzEnabled === false
      ? Promise.resolve([])
      : fetch(`https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=15`, {
          headers: { 'User-Agent': ua },
          next: { revalidate: 86400 },
        })
          .then((response) => (response.ok ? response.json() : { releases: [] }))
          .then((data) => data.releases || [])
          .catch(() => []);

    const discogsPromise = settings.discogsEnabled === false ? Promise.resolve([]) : searchDiscogs(album.artist, album.name).catch(() => []);
    const [musicbrainz, discogs, configured] = await Promise.all([musicbrainzPromise, discogsPromise, discogsConfigured()]);

    return NextResponse.json({
      saved,
      musicbrainz,
      discogs,
      discogsConfigured: configured,
      musicbrainzEnabled: settings.musicbrainzEnabled !== false,
      coverArtArchiveEnabled: settings.coverArtArchiveEnabled !== false,
      lastfmEnabled: settings.lastfmEnabled !== false,
      lastfmConfigured: Boolean(settings.lastfmApiKey?.trim()),
      metadataSourceOrder: settings.metadataSourceOrder || ['discogs', 'musicbrainz', 'lastfm'],
      artworkSourceOrder: settings.artworkSourceOrder || ['discogs', 'coverartarchive', 'navidrome'],
      library: getAlbumRecord(id),
      artwork: listArtwork(id),
      metadataValues: getMetadataValues(id),
      navidromeCoverArt: album.coverArt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const patch = await request.json();
    return NextResponse.json({ meta: await saveMeta(id, patch) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
