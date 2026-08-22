import { NextResponse } from 'next/server';
import { getMeta, saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';
import { discogsConfigured, searchDiscogs } from '@/lib/discogs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const root = await subsonic('getAlbum', { id });
    const album = root.album;
    const saved = await getMeta(id);

    const q = encodeURIComponent(`release:"${album.name}" AND artist:"${album.artist}" AND format:vinyl`);
    const ua = process.env.MUSICBRAINZ_USER_AGENT || 'NeedleDrop/0.2.0 (https://github.com/bclark303/needledrop)';
    const [musicbrainz, discogs] = await Promise.all([
      fetch(`https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=15`, {
        headers: { 'User-Agent': ua },
        next: { revalidate: 86400 },
      })
        .then((r) => (r.ok ? r.json() : { releases: [] }))
        .then((d) => d.releases || [])
        .catch(() => []),
      searchDiscogs(album.artist, album.name).catch(() => []),
    ]);

    return NextResponse.json({
      saved,
      musicbrainz,
      discogs,
      discogsConfigured: discogsConfigured(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const patch = await req.json();
    return NextResponse.json({ meta: await saveMeta(id, patch) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
