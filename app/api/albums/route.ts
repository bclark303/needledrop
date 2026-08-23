import { NextRequest, NextResponse } from 'next/server';
import type { Album, VinylMeta } from '@/components/types';
import { getAlbumMetaJson, indexAlbums } from '@/lib/db';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { filterMergedAlbums } from '@/lib/library';
import { backfillArtworkCandidatesFromMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type') || 'alphabeticalByArtist';
    const size = Math.min(Number(req.nextUrl.searchParams.get('size') || 100), 500);
    const offset = Number(req.nextUrl.searchParams.get('offset') || 0);
    const genre = req.nextUrl.searchParams.get('genre') || undefined;
    const fromYear = req.nextUrl.searchParams.get('fromYear') || undefined;
    const toYear = req.nextUrl.searchParams.get('toYear') || undefined;
    const root = await subsonic('getAlbumList2', { type, size, offset, genre, fromYear, toYear });
    const albums = (root.albumList2?.album ?? []) as Album[];
    indexAlbums(albums);
    const visible = filterMergedAlbums(albums);
    void maybeAutoEnrich(visible).catch(() => {});
    return NextResponse.json({
      albums: visible.map((album) => {
        const local = getAlbumMetaJson<VinylMeta>(album.id);
        backfillArtworkCandidatesFromMeta(album.id, local);
        return {
          ...album,
          rating: local?.rating,
          navidromeCoverArt: album.coverArt,
          coverArt: `nd:${album.id}`,
        };
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: msg }, { status: msg === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
