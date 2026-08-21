import { NextRequest, NextResponse } from 'next/server';
import { mediaUrl } from '@/lib/subsonic';
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const size = req.nextUrl.searchParams.get('size') || '600';
    const upstream = await fetch(await mediaUrl('getCoverArt', id, { size }), { cache: 'force-cache' });
    if (!upstream.ok) return new NextResponse(null, { status: upstream.status });
    return new NextResponse(upstream.body, { headers: { 'Content-Type': upstream.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  } catch { return new NextResponse(null, { status: 401 }); }
}
