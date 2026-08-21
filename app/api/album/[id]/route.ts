import { NextResponse } from 'next/server';
import { subsonic } from '@/lib/subsonic';
import { getMeta } from '@/lib/store';
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [root, meta] = await Promise.all([subsonic('getAlbum', { id }), getMeta(id)]);
    return NextResponse.json({ album: root.album, meta });
  } catch (e) { const m=e instanceof Error?e.message:'Failed'; return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500}); }
}
