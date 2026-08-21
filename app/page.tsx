'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Album, AlbumDetail, Song, VinylMeta } from '@/components/types';
import { Disc3, Search, Shuffle, LogOut, Heart, Settings2, X, Play, Pause, SkipBack, SkipForward, RotateCcw, LibraryBig, ListMusic, Sparkles } from 'lucide-react';

type View='library'|'album';
type SortMode='alphabeticalByArtist'|'newest'|'recent'|'frequent'|'starred';

function cover(id?:string,size=500){return id?`/api/cover/${encodeURIComponent(id)}?size=${size}`:'/icon.svg'}
function fmt(sec=0){const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,'0')}`}

export default function Home(){
  const [loggedIn,setLoggedIn]=useState<boolean|null>(null);
  const [albums,setAlbums]=useState<Album[]>([]);
  const [selected,setSelected]=useState<AlbumDetail|null>(null);
  const [meta,setMeta]=useState<VinylMeta|null>(null);
  const [view,setView]=useState<View>('library');
  const [sort,setSort]=useState<SortMode>('alphabeticalByArtist');
  const [query,setQuery]=useState('');
  const [strict,setStrict]=useState(true);
  const [queue,setQueue]=useState<Song[]>([]);
  const [queueIndex,setQueueIndex]=useState(-1);
  const [playing,setPlaying]=useState(false);
  const [needsFlip,setNeedsFlip]=useState(false);
  const audio=useRef<HTMLAudioElement>(null);

  const current=queueIndex>=0?queue[queueIndex]:null;

  useEffect(()=>{loadAlbums('alphabeticalByArtist',true)},[]);
  useEffect(()=>{if(!audio.current||!current)return;audio.current.src=`/api/stream/${encodeURIComponent(current.id)}`;audio.current.play().then(()=>setPlaying(true)).catch(()=>{});navigator.mediaSession&&setMedia(current)},[current?.id]);

  async function loadAlbums(type:SortMode, probe=false){
    const endpoint=type==='starred'?'/api/albums?type=alphabeticalByArtist&size=500':`/api/albums?type=${type}&size=500`;
    const r=await fetch(endpoint);
    if(r.status===401){setLoggedIn(false);return}
    if(!r.ok){if(probe)setLoggedIn(false);return}
    const d=await r.json();
    let list:Album[]=d.albums||[];
    if(type==='starred') list=list.filter(a=>a.starred);
    setAlbums(list);setLoggedIn(true);
  }
  async function openAlbum(id:string){const r=await fetch(`/api/album/${encodeURIComponent(id)}`);if(!r.ok)return;const d=await r.json();setSelected(d.album);setMeta(d.meta);setView('album');setNeedsFlip(false)}
  async function doSearch(q:string){setQuery(q);if(!q.trim()){loadAlbums(sort);return}const r=await fetch(`/api/search?q=${encodeURIComponent(q)}`);if(r.ok){const d=await r.json();setAlbums(d.album||[])}}
  async function random(){const r=await fetch('/api/random');if(r.ok){const d=await r.json();if(d.album)openAlbum(d.album.id)}}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});setLoggedIn(false);setSelected(null);setAlbums([])}
  function sideBreak(album:AlbumDetail){if(meta?.sideBreakAfterTrack)return meta.sideBreakAfterTrack;const songs=album.song||[];const half=songs.reduce((a,s)=>a+(s.duration||0),0)/2;let sum=0,best=1,bestDiff=Infinity;songs.forEach((s,i)=>{sum+=s.duration||0;const diff=Math.abs(sum-half);if(diff<bestDiff&&i<songs.length-1){best=i+1;bestDiff=diff}});return best}
  function playAlbum(side:'A'|'B'='A',trackIndex?:number){if(!selected)return;const split=sideBreak(selected);const start=trackIndex??(side==='A'?0:split);setQueue(selected.song);setQueueIndex(start);setNeedsFlip(false)}
  function toggle(){if(!audio.current)return;if(audio.current.paused){audio.current.play();setPlaying(true)}else{audio.current.pause();setPlaying(false)}}
  function ended(){if(!selected||queueIndex<0)return;fetch('/api/scrobble',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:queue[queueIndex].id,submission:true})}).catch(()=>{});const split=sideBreak(selected);if(strict&&queueIndex+1===split){setPlaying(false);setNeedsFlip(true);return}if(queueIndex<queue.length-1)setQueueIndex(i=>i+1);else setPlaying(false)}
  function next(){if(queueIndex<queue.length-1){const split=selected?sideBreak(selected):Infinity;if(strict&&queueIndex+1===split){setNeedsFlip(true);setPlaying(false);audio.current?.pause()}else setQueueIndex(i=>i+1)}}
  function prev(){if(queueIndex>0)setQueueIndex(i=>i-1)}
  function flip(){if(!selected)return;const split=sideBreak(selected);setQueue(selected.song);setQueueIndex(split);setNeedsFlip(false)}
  function setMedia(song:Song){if(!('mediaSession' in navigator))return;navigator.mediaSession.metadata=new MediaMetadata({title:song.title,artist:song.artist,album:song.album,artwork:[{src:location.origin+cover(song.coverArt,512),sizes:'512x512',type:'image/jpeg'}]});navigator.mediaSession.setActionHandler('play',()=>{audio.current?.play();setPlaying(true)});navigator.mediaSession.setActionHandler('pause',()=>{audio.current?.pause();setPlaying(false)});navigator.mediaSession.setActionHandler('previoustrack',prev);navigator.mediaSession.setActionHandler('nexttrack',next)}

  if(loggedIn===false)return <Login onSuccess={()=>loadAlbums('alphabeticalByArtist')}/>;
  if(loggedIn===null)return <div className="splash"><Disc3 className="spin" size={72}/><h1>NeedleDrop</h1><p>Opening the record room…</p></div>;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={()=>setView('library')}><Disc3/><span>NeedleDrop</span></button>
      <div className="header-actions">
        <label className="mode-toggle" title="Vinyl Mode stops at the end of Side A"><input type="checkbox" checked={strict} onChange={e=>setStrict(e.target.checked)}/><span>{strict?'Vinyl Mode':'Normal Mode'}</span></label>
        <button className="icon-btn" onClick={random} title="Pick a record for me"><Shuffle/></button>
        <button className="icon-btn" onClick={logout} title="Sign out"><LogOut/></button>
      </div>
    </header>

    {view==='library'&&<section className="library-page">
      <div className="hero"><div><p className="eyebrow">YOUR RECORD ROOM</p><h1>What are we spinning?</h1><p>Browse the shelf. Pick a jacket. Put the record on.</p></div><button className="hero-random" onClick={random}><Sparkles/> Pick a record for me</button></div>
      <div className="library-tools">
        <div className="searchbox"><Search size={18}/><input value={query} onChange={e=>doSearch(e.target.value)} placeholder="Search the collection"/></div>
        <select value={sort} onChange={e=>{const s=e.target.value as SortMode;setSort(s);setQuery('');loadAlbums(s)}}>
          <option value="alphabeticalByArtist">Artist A–Z</option><option value="newest">Recently added</option><option value="recent">Recently played</option><option value="frequent">Most played</option><option value="starred">Favourites</option>
        </select>
      </div>
      <div className="record-grid">{albums.map(a=><button className="record-card" key={a.id} onClick={()=>openAlbum(a.id)}><div className="jacket"><img src={cover(a.coverArt)} alt="" loading="lazy"/><div className="vinyl-peek"><span/></div></div><div className="record-caption"><strong>{a.name}</strong><span>{a.artist}{a.year?` · ${a.year}`:''}</span></div></button>)}</div>
      {!albums.length&&<div className="empty"><LibraryBig/><h2>No records found</h2><p>Try another search or view.</p></div>}
    </section>}

    {view==='album'&&selected&&<AlbumView album={selected} meta={meta} strict={strict} onBack={()=>setView('library')} onPlay={playAlbum} onMeta={m=>setMeta(m)} split={sideBreak(selected)} currentId={current?.id}/>} 

    <audio ref={audio} onEnded={ended} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} preload="metadata"/>
    {current&&<div className="now-playing"><img src={cover(current.coverArt,160)} alt=""/><div className="np-copy"><strong>{current.title}</strong><span>{current.artist}</span></div><div className="np-controls"><button onClick={prev}><SkipBack/></button><button className="play-button" onClick={toggle}>{playing?<Pause/>:<Play/>}</button><button onClick={next}><SkipForward/></button></div></div>}
    {needsFlip&&selected&&<div className="flip-overlay"><div className="flip-card"><div className="big-record"><Disc3 size={170}/></div><p>SIDE A COMPLETE</p><h2>Flip the record</h2><span>{selected.artist} — {selected.name}</span><button onClick={flip}><RotateCcw/> Flip to Side B</button></div></div>}
  </main>
}

function Login({onSuccess}:{onSuccess:()=>void}){
  const [username,setUsername]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});const d=await r.json().catch(()=>({}));setBusy(false);if(!r.ok){setError(d.error||'Login failed');return}onSuccess()}
  return <div className="login-page"><div className="login-panel"><Disc3 size={62}/><p className="eyebrow">VIRTUAL VINYL</p><h1>NeedleDrop</h1><p>Sign in with your Navidrome account.</p><form onSubmit={submit}><label>Username<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?'Opening…':'Enter the record room'}</button></form></div></div>
}

function AlbumView({album,meta,strict,onBack,onPlay,onMeta,split,currentId}:{album:AlbumDetail;meta:VinylMeta|null;strict:boolean;onBack:()=>void;onPlay:(s:'A'|'B',i?:number)=>void;onMeta:(m:VinylMeta)=>void;split:number;currentId?:string}){
  const [details,setDetails]=useState(false);const [enrich,setEnrich]=useState<any>(null);const [loading,setLoading]=useState(false);
  const sideA=album.song.slice(0,split),sideB=album.song.slice(split);
  async function metadata(){setDetails(true);setLoading(true);const r=await fetch(`/api/metadata/${album.id}`);if(r.ok)setEnrich(await r.json());setLoading(false)}
  async function save(patch:Partial<VinylMeta>){const r=await fetch(`/api/metadata/${album.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});if(r.ok){const d=await r.json();onMeta(d.meta)}}
  async function star(){await fetch('/api/star',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:album.id,starred:!album.starred})})}
  return <section className="album-page">
    <button className="back" onClick={onBack}>← Back to collection</button>
    <div className="album-stage"><div className="sleeve-stack"><div className="album-disc"><span/></div><img src={cover(album.coverArt,900)} alt={`${album.name} cover`}/></div><div className="album-copy"><p className="eyebrow">{meta?.pressingLabel||'FROM YOUR VINYL LIBRARY'}</p><h1>{album.name}</h1><h2>{album.artist}</h2><p className="album-facts">{meta?.releaseYear||album.year||'Unknown year'}{album.genre?` · ${album.genre}`:''}{meta?.country?` · ${meta.country}`:''}</p><div className="album-actions"><button className="primary" onClick={()=>onPlay('A')}><Play/> Play Side A</button><button onClick={star}><Heart/> Favourite</button><button onClick={metadata}><Settings2/> Pressing & details</button></div><p className="mode-note">{strict?'Vinyl Mode is on: playback stops when Side A ends.':'Normal Mode is on: tracks can be selected directly.'}</p></div></div>
    <div className="track-sides"><TrackSide label="SIDE A" songs={sideA} offset={0} strict={strict} currentId={currentId} onPlay={i=>onPlay('A',i)}/><TrackSide label="SIDE B" songs={sideB} offset={split} strict={strict} currentId={currentId} onPlay={i=>onPlay('B',i)}/></div>
    {details&&<div className="drawer-backdrop" onClick={()=>setDetails(false)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="drawer-x" onClick={()=>setDetails(false)}><X/></button><p className="eyebrow">RECORD DETAILS</p><h2>{album.name}</h2><MetaEditor meta={meta} save={save}/><h3>Pressing matches</h3>{loading?<p>Checking MusicBrainz and Discogs…</p>:<Pressings data={enrich} save={save}/>}</aside></div>}
  </section>
}

function TrackSide({label,songs,offset,strict,currentId,onPlay}:{label:string;songs:Song[];offset:number;strict:boolean;currentId?:string;onPlay:(i:number)=>void}){return <div className="side"><div className="side-label"><Disc3/><span>{label}</span><em>{fmt(songs.reduce((a,s)=>a+(s.duration||0),0))}</em></div><ol>{songs.map((s,i)=><li key={s.id} className={currentId===s.id?'active':''}><button disabled={strict&&i>0} onClick={()=>onPlay(i+offset)}><span>{String(i+offset+1).padStart(2,'0')}</span><strong>{s.title}</strong><em>{fmt(s.duration)}</em></button></li>)}</ol></div>}

function MetaEditor({meta,save}:{meta:VinylMeta|null;save:(p:Partial<VinylMeta>)=>void}){const [form,setForm]=useState<VinylMeta>(meta||{});useEffect(()=>setForm(meta||{}),[meta]);function f(k:keyof VinylMeta,v:any){setForm(x=>({...x,[k]:v}))}return <div className="meta-form"><label>Vinyl colour<input value={form.vinylColor||''} onChange={e=>f('vinylColor',e.target.value)} placeholder="Black"/></label><label>Condition<input value={form.condition||''} onChange={e=>f('condition',e.target.value)} placeholder="Virtual copy / NM"/></label><label>Crate / shelf<input value={form.crate||''} onChange={e=>f('crate',e.target.value)} placeholder="Main shelf"/></label><label>Acquired<input type="date" value={form.acquiredAt||''} onChange={e=>f('acquiredAt',e.target.value)}/></label><label className="wide">Notes<textarea value={form.notes||''} onChange={e=>f('notes',e.target.value)} placeholder="Anything you want to remember about this copy…"/></label><button className="primary wide" onClick={()=>save(form)}>Save details</button></div>}

function Pressings({data,save}:{data:any;save:(p:Partial<VinylMeta>)=>void}){if(!data)return <p>No metadata loaded.</p>;const mb=data.musicbrainz||[],dc=data.discogs||[];return <div className="pressings">{dc.slice(0,8).map((p:any)=><button key={'d'+p.id} onClick={()=>save({pressingId:`discogs:${p.id}`,pressingLabel:p.label?.[0]||'Discogs vinyl',catalogNumber:p.catno,country:p.country,releaseYear:p.year})}><strong>{p.title}</strong><span>{[p.country,p.year,p.label?.[0],p.catno].filter(Boolean).join(' · ')}</span><em>Discogs</em></button>)}{mb.slice(0,8).map((p:any)=><button key={'m'+p.id} onClick={()=>save({pressingId:`musicbrainz:${p.id}`,pressingLabel:p['label-info']?.[0]?.label?.name||'MusicBrainz vinyl',catalogNumber:p['label-info']?.[0]?.['catalog-number'],country:p.country,releaseYear:Number((p.date||'').slice(0,4))||undefined})}><strong>{p.title}</strong><span>{[p.country,p.date,p['label-info']?.[0]?.label?.name,p['label-info']?.[0]?.['catalog-number']].filter(Boolean).join(' · ')}</span><em>MusicBrainz</em></button>)}{!mb.length&&!dc.length&&<p>No confident vinyl pressing matches were returned. You can still keep manual record details above.</p>}</div>}
