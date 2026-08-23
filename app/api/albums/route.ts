import { NextRequest, NextResponse } from 'next/server';
import type { Album, VinylMeta } from '@/components/types';
import { getAlbumMetaJson, getAlbumRecord, indexAlbums, listArtwork } from '@/lib/db';
import { diagnosticsActive, recordDiagnostic } from '@/lib/diagnostics';
import { maybeAutoEnrich } from '@/lib/enrichment';
import { prepareVisibleAlbums } from '@/lib/library';
import { backfillArtworkCandidatesFromMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const started = Date.now();
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
    const visible = prepareVisibleAlbums(albums);
    void maybeAutoEnrich(visible).catch((error) => {
      recordDiagnostic('collection-auto-enrich-error', { error: error instanceof Error ? error.message : String(error) }, 'warn');
    });

    const output = visible.map((album) => {
      const local = getAlbumMetaJson<VinylMeta>(album.id);
      backfillArtworkCandidatesFromMeta(album.id, local);
      return {
        ...album,
        rating: local?.rating,
        navidromeCoverArt: album.coverArt,
        coverArt: `nd:${album.id}`,
      };
    });

    if (diagnosticsActive()) {
      recordDiagnostic('collection-load', {
        request: { type, size, offset, genre, fromYear, toYear },
        returned: albums.length,
        visible: visible.length,
        durationMs: Date.now() - started,
        albums: visible.map((album) => {
          const local = getAlbumMetaJson<VinylMeta>(album.id);
          const record = getAlbumRecord(album.id);
          const artwork = listArtwork(album.id);
          return {
            albumId: album.id,
            artist: album.artist,
            title: album.name,
            navidromeCover: Boolean(album.coverArt || record?.navidromeCoverArt),
            artworkMode: record?.artworkMode,
            canonicalArtworkId: record?.canonicalArtworkId,
            enrichmentStatus: record?.enrichmentStatus,
            enrichedAt: record?.enrichedAt,
            candidateCount: artwork.length,
            frontCandidateCount: artwork.filter((item) => item.role === 'front' && item.remoteUrl).length,
            selectedCandidateIds: artwork.filter((item) => item.userSelected).map((item) => item.id),
            legacyImageCount: local?.images?.length || 0,
            metaArtworkSource: local?.artworkSource,
            discogsImageIndex: local?.discogsImageIndex,
          };
        }),
      });
    }

    return NextResponse.json({ albums: output });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    recordDiagnostic('collection-load-failed', { error: msg, durationMs: Date.now() - started }, 'error');
    return NextResponse.json({ error: msg }, { status: msg === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
