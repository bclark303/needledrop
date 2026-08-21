import { NextRequest, NextResponse } from 'next/server';
import { mediaUrl } from '@/lib/subsonic';
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const headers: HeadersInit = {};
    const range = req.headers.get('range');
    if (range) headers.Range = range;
    const upstream = await fetch(await mediaUrl('stream', id), { headers, cache: 'no-store' });
    const out = new Headers();
    for (const h of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
      const v = upstream.headers.get(h); if (v) out.set(h, v);
    }
    out.set('Cache-Control','private, no-store');
    return new NextResponse(upstream.body, { status: upstream.status, headers: out });
  } catch { return new NextResponse(null, { status: 401 }); }
}
