import { NextResponse } from 'next/server';
import type { AlbumDetail } from '@/components/types';
import { resolveVirtualRelease } from '@/lib/collection-engine';
import { getAlbumRecord, getMetadataValues, indexAlbums, listArtwork } from '@/lib/db';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { combineMergedAlbumDetails, getMergedAlbumIds, resolveCanonicalAlbumId } from '@/lib/library';
import { subsonic } from '@/lib/subsonic';
import { backfillArtworkCandidatesFromMeta, getMeta, saveMeta } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const params = await ctx.params;
    const id = resolveCanonicalAlbumId(params.id);
    const familyIds = getMergedAlbumIds(id);
    const [roots, meta] = await Promise.all([
      Promise.all(familyIds.map((albumId) => subsonic('getAlbum', { id: albumId }))),
      getMeta(id),
    ]);
    const originals = roots.map((root) => root.album as AlbumDetail).filter(Boolean);
    indexAlbums(originals);
    const original = combineMergedAlbumDetails(originals, id);
    indexAlbums([original]);
    void maybeAutoEnrich([original]).catch(() => {});

    const virtual = await resolveVirtualRelease(original, meta);
    if (meta && virtual.meta && JSON.stringify(meta.sides) !== JSON.stringify(virtual.meta.sides)) await saveMeta(id, virtual.meta);
    const effectiveMeta = virtual.meta || meta;
    backfillArtworkCandidatesFromMeta(id, effectiveMeta);
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
      mergedAlbumIds: familyIds,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
