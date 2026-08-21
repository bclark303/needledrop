import { NextResponse } from 'next/server';
import { subsonic } from '@/lib/subsonic';
export async function POST(req: Request) {
  try { const { id, submission = true } = await req.json(); await subsonic('scrobble',{id,submission}); return NextResponse.json({ok:true}); }
  catch(e){const m=e instanceof Error?e.message:'Failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500});}
}
