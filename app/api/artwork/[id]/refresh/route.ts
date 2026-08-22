import { NextResponse } from 'next/server';
import type { Album } from '@/components/types';
import { indexAlbums } from '@/lib/db';
import { enrichAlbum } from '@/lib/enrichment';
import { getSession } from '@/lib/session';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const root = await subsonic('getAlbum', { id });
    const album = root.album as Album;
    indexAlbums([album]);
    const result = await enrichAlbum(album);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not refresh artwork';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}
