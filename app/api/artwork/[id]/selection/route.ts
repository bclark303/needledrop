import { NextResponse } from 'next/server';
import type { ArtworkSource } from '@/components/types';
import { getArtworkById, setArtworkMode } from '@/lib/db';
import { recordDiagnostic } from '@/lib/diagnostics';
import { getSession } from '@/lib/session';
import { getMeta, saveMeta } from '@/lib/store';

export const runtime = 'nodejs';

type ArtworkSelectionBody = {
  mode?: 'auto' | 'navidrome' | 'candidate' | 'pressing';
  candidateId?: number;
  imageIndex?: number;
};

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const body = await request.json() as ArtworkSelectionBody;

    if (body.mode === 'auto') {
      setArtworkMode(id, 'auto');
      const meta = await saveMeta(id, { artworkSource: undefined, discogsImageIndex: undefined });
      recordDiagnostic('artwork-selection-changed', { albumId: id, mode: 'auto' });
      return NextResponse.json({ ok: true, meta });
    }

    if (body.mode === 'navidrome') {
      setArtworkMode(id, 'navidrome');
      const meta = await saveMeta(id, { artworkSource: 'navidrome', discogsImageIndex: undefined });
      recordDiagnostic('artwork-selection-changed', { albumId: id, mode: 'navidrome' });
      return NextResponse.json({ ok: true, meta });
    }

    if (body.mode === 'pressing') {
      const imageIndex = Number(body.imageIndex);
      const current = await getMeta(id);
      const image = Number.isInteger(imageIndex) && imageIndex >= 0 ? current?.images?.[imageIndex] : undefined;
      if (!image || (!image.uri && !image.uri150)) {
        return NextResponse.json({ error: 'Pressing artwork image not found' }, { status: 404 });
      }

      // saveMeta synchronizes Discogs pressing images into the canonical artwork
      // table. Marking this exact image as selected promotes it to a front-cover
      // candidate and pins it so Collection, Album and Turntable use one source.
      const meta = await saveMeta(id, { artworkSource: 'discogs', discogsImageIndex: imageIndex });
      recordDiagnostic('artwork-selection-changed', {
        albumId: id,
        mode: 'pressing',
        source: 'discogs',
        imageIndex,
        discogsReleaseId: meta.discogsReleaseId,
      });
      return NextResponse.json({ ok: true, meta, imageIndex });
    }

    if (body.mode === 'candidate') {
      const candidate = getArtworkById(Number(body.candidateId));
      if (!candidate || candidate.albumId !== id) return NextResponse.json({ error: 'Artwork candidate not found' }, { status: 404 });
      setArtworkMode(id, 'candidate', candidate.id);

      const patch: { artworkSource?: ArtworkSource; discogsImageIndex?: number } = {};
      if (candidate.source === 'discogs') {
        patch.artworkSource = 'discogs';
        // Exact-release candidates use discogs:<releaseId>:<imageIndex>.
        // A discogs-search:<releaseId> candidate is only an album-art fallback,
        // so it must not be mistaken for an index in the selected release's image array.
        const match = candidate.sourceKey.match(/^discogs:[^:]+:(\d+)$/);
        patch.discogsImageIndex = match ? Number(match[1]) : undefined;
      } else if (candidate.source === 'coverartarchive') {
        patch.artworkSource = 'coverartarchive';
        patch.discogsImageIndex = undefined;
      } else if (candidate.source === 'navidrome') {
        patch.artworkSource = 'navidrome';
        patch.discogsImageIndex = undefined;
      }
      const meta = await saveMeta(id, patch);
      recordDiagnostic('artwork-selection-changed', {
        albumId: id,
        mode: 'candidate',
        candidateId: candidate.id,
        source: candidate.source,
        scope: candidate.scope,
        sourceKey: candidate.sourceKey,
      });
      return NextResponse.json({ ok: true, meta, candidate });
    }

    return NextResponse.json({ error: 'Invalid artwork selection mode' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not select artwork' }, { status: 500 });
  }
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await ctx.params;
  return NextResponse.json({ meta: await getMeta(id) });
}
