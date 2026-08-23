import { NextResponse } from 'next/server';
import type { Album, VinylMeta } from '@/components/types';
import { getAlbumMetaJson, indexAlbums } from '@/lib/db';
import { prepareVisibleAlbums } from '@/lib/library';
import { subsonic } from '@/lib/subsonic';

export async function GET() {
  try {
    const root = await subsonic('getAlbumList2', { type: 'random', size: 12 });
    const albums = (root.albumList2?.album || []) as Album[];
    indexAlbums(albums);
    const album = prepareVisibleAlbums(albums)[0];
    if (!album) return NextResponse.json({ album: null });
    return NextResponse.json({
      album: {
        ...album,
        rating: getAlbumMetaJson<VinylMeta>(album.id)?.rating,
        navidromeCoverArt: album.coverArt,
        coverArt: `nd:${album.id}`,
      },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: m }, { status: m === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
