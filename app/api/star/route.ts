import { NextResponse } from 'next/server';
import { subsonic } from '@/lib/subsonic';
export async function POST(req: Request) {
  try { const { id, starred } = await req.json(); await subsonic(starred?'star':'unstar',{albumId:id}); return NextResponse.json({ok:true}); }
  catch(e){const m=e instanceof Error?e.message:'Failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500});}
}
