import { NextResponse } from 'next/server';
import type { ArtworkSource } from '@/components/types';
import { getArtworkById, setArtworkMode } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getMeta, saveMeta } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const body = await request.json() as { mode?: 'auto' | 'navidrome' | 'candidate'; candidateId?: number };

    if (body.mode === 'auto') {
      setArtworkMode(id, 'auto');
      const meta = await saveMeta(id, { artworkSource: undefined, discogsImageIndex: undefined });
      return NextResponse.json({ ok: true, meta });
    }

    if (body.mode === 'navidrome') {
      setArtworkMode(id, 'navidrome');
      const meta = await saveMeta(id, { artworkSource: 'navidrome', discogsImageIndex: undefined });
      return NextResponse.json({ ok: true, meta });
    }

    if (body.mode === 'candidate') {
      const candidate = getArtworkById(Number(body.candidateId));
      if (!candidate || candidate.albumId !== id) return NextResponse.json({ error: 'Artwork candidate not found' }, { status: 404 });
      setArtworkMode(id, 'candidate', candidate.id);

      const patch: { artworkSource?: ArtworkSource; discogsImageIndex?: number } = {};
      if (candidate.source === 'discogs') {
        patch.artworkSource = 'discogs';
        const match = candidate.sourceKey.match(/:(\d+)$/);
        if (match) patch.discogsImageIndex = Number(match[1]);
      } else if (candidate.source === 'coverartarchive') {
        patch.artworkSource = 'coverartarchive';
        patch.discogsImageIndex = undefined;
      } else if (candidate.source === 'navidrome') {
        patch.artworkSource = 'navidrome';
        patch.discogsImageIndex = undefined;
      }
      const meta = await saveMeta(id, patch);
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
