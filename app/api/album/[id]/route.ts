import { NextResponse } from 'next/server';
import type { AlbumDetail } from '@/components/types';
import { resolveVirtualRelease } from '@/lib/collection-engine';
import { getAlbumRecord, getMetadataValues, indexAlbums, listArtwork } from '@/lib/db';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { resolveCanonicalAlbumId } from '@/lib/library';
import { subsonic } from '@/lib/subsonic';
import { getMeta, saveMeta } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const params = await ctx.params;
    const id = resolveCanonicalAlbumId(params.id);
    const [root, meta] = await Promise.all([subsonic('getAlbum', { id }), getMeta(id)]);
    const original = root.album as AlbumDetail;
    indexAlbums([original]);
    void maybeAutoEnrich([original]).catch(() => {});

    const virtual = await resolveVirtualRelease(original, meta);
    if (meta && virtual.meta && JSON.stringify(meta.sides) !== JSON.stringify(virtual.meta.sides)) await saveMeta(id, virtual.meta);
    const effectiveMeta = virtual.meta || meta;
    const album = {
      ...virtual.album,
      rating: effectiveMeta?.rating,
      navidromeCoverArt: original.coverArt,
      coverArt: `nd:${id}`,
      song: (virtual.album.song || []).map((song) => ({ ...song, coverArt: `nd:${id}` })),
    };
    return NextResponse.json({
      album,
      meta: effectiveMeta,
      availability: virtual.availability,
      library: getAlbumRecord(id),
      metadataValues: getMetadataValues(id),
      artwork: listArtwork(id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
