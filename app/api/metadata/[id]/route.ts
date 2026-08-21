import { NextResponse } from 'next/server';
import { getMeta, saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

export async function GET(_:Request, ctx:{params:Promise<{id:string}>}) {
  try {
    const {id}=await ctx.params;
    const root=await subsonic('getAlbum',{id});
    const album=root.album;
    const q=encodeURIComponent(`release:"${album.name}" AND artist:"${album.artist}" AND format:vinyl`);
    const ua=process.env.MUSICBRAINZ_USER_AGENT || 'NeedleDrop/0.1.0';
    const mb=await fetch(`https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=15`,{headers:{'User-Agent':ua},next:{revalidate:86400}}).then(r=>r.ok?r.json():{releases:[]}).catch(()=>({releases:[]}));
    let discogs:any[]=[];
    const token=process.env.DISCOGS_TOKEN;
    if(token){
      const dq=new URLSearchParams({type:'release',format:'vinyl',artist:album.artist,title:album.name,per_page:'20',token});
      const d=await fetch(`https://api.discogs.com/database/search?${dq}`,{headers:{'User-Agent':ua},next:{revalidate:86400}}).then(r=>r.ok?r.json():{results:[]}).catch(()=>({results:[]}));
      discogs=d.results||[];
    }
    return NextResponse.json({saved:await getMeta(id),musicbrainz:mb.releases||[],discogs});
  } catch(e){const m=e instanceof Error?e.message:'Failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:500});}
}
export async function PUT(req:Request, ctx:{params:Promise<{id:string}>}) {
  try{const {id}=await ctx.params; const patch=await req.json(); return NextResponse.json({meta:await saveMeta(id,patch)});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:500});}
}
