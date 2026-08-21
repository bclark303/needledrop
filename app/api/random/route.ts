import { NextResponse } from 'next/server';
import { subsonic } from '@/lib/subsonic';
export async function GET(){try{const r=await subsonic('getAlbumList2',{type:'random',size:1});return NextResponse.json({album:r.albumList2?.album?.[0]||null});}catch(e){const m=e instanceof Error?e.message:'Failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500});}}
