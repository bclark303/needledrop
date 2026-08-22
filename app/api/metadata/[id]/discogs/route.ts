import { NextResponse } from 'next/server';
import { getDiscogsRelease, normalizeDiscogsRelease } from '@/lib/discogs';
import { saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

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
    const meta = await saveMeta(id, normalized);
    return NextResponse.json({ meta });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    const status = message === 'UNAUTHENTICATED' ? 401 : message === 'DISCOGS_NOT_CONFIGURED' ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
