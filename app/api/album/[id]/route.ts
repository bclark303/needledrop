import { NextResponse } from 'next/server';
import type { AlbumDetail } from '@/components/types';
import { getAlbumRecord, getMetadataValues, indexAlbums, listArtwork } from '@/lib/db';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { subsonic } from '@/lib/subsonic';
import { getMeta } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [root, meta] = await Promise.all([subsonic('getAlbum', { id }), getMeta(id)]);
    const original = root.album as AlbumDetail;
    indexAlbums([original]);
    void maybeAutoEnrich([original]).catch(() => {});
    const album = {
      ...original,
      coverArt: `nd:${id}`,
      song: (original.song || []).map((song) => ({ ...song, coverArt: song.coverArt || `nd:${id}` })),
    };
    return NextResponse.json({
      album,
      meta,
      library: getAlbumRecord(id),
      metadataValues: getMetadataValues(id),
      artwork: listArtwork(id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
