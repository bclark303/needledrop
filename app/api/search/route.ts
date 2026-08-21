import { NextRequest, NextResponse } from 'next/server';
import { subsonic } from '@/lib/subsonic';
export async function GET(req: NextRequest) {
  try { const query=req.nextUrl.searchParams.get('q')||''; const root=await subsonic('search3',{query,artistCount:20,albumCount:60,songCount:20}); return NextResponse.json(root.searchResult3||{}); }
  catch(e){const m=e instanceof Error?e.message:'Failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500});}
}
