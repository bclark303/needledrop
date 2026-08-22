import { NextRequest, NextResponse } from 'next/server';
import type { Album, VinylMeta } from '@/components/types';
import { getAlbumMetaJson, indexAlbums } from '@/lib/db';
import { filterMergedAlbums } from '@/lib/library';
import { subsonic } from '@/lib/subsonic';

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q') || '';
    const root = await subsonic('search3', { query, artistCount: 20, albumCount: 60, songCount: 20 });
    const result = root.searchResult3 || {};
    const albums = (result.album || []) as Album[];
    indexAlbums(albums);
    const visible = filterMergedAlbums(albums).map((album) => ({
      ...album,
      rating: getAlbumMetaJson<VinylMeta>(album.id)?.rating,
      navidromeCoverArt: album.coverArt,
      coverArt: `nd:${album.id}`,
    }));
    return NextResponse.json({ ...result, album: visible });
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: m }, { status: m === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
