import { NextResponse } from 'next/server';
import { getDiscogsRelease, normalizeDiscogsRelease } from '@/lib/discogs';
import { enrichAlbum } from '@/lib/enrichment';
import { getMeta, saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const releaseId = Number(body.releaseId);
    if (!Number.isInteger(releaseId) || releaseId <= 0) {
      return NextResponse.json({ error: 'A valid Discogs releaseId is required.' }, { status: 400 });
    }

    const [release, root] = await Promise.all([
      getDiscogsRelease(releaseId),
      subsonic('getAlbum', { id }),
    ]);

    const normalized = normalizeDiscogsRelease(release, root.album.song || []);
    await saveMeta(id, normalized);

    // Promote the selected physical release into the canonical library immediately.
    // Enrichment failures must not prevent a valid Discogs pressing from being saved.
    await enrichAlbum(root.album).catch(() => {});
    const meta = await getMeta(id);
    return NextResponse.json({ meta });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    const status = message === 'UNAUTHENTICATED' ? 401 : message === 'DISCOGS_NOT_CONFIGURED' ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
