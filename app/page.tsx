'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Album, AlbumDetail, Song, VinylMeta } from '@/components/types';
import {
  AlertTriangle,
  Disc3,
  ExternalLink,
  Heart,
  LibraryBig,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';

type View = 'library' | 'album';
type SortMode = 'alphabeticalByArtist' | 'newest' | 'recent' | 'frequent' | 'starred';
type PlaybackSide = { label: string; songs: Song[] };
type SideRow = { position: string; title: string; duration?: string; song?: Song };
type DisplaySide = { label: string; rows: SideRow[] };

type DiscogsSearchResult = {
  id: number;
  title?: string;
  country?: string;
  year?: number;
  label?: string[];
  catno?: string;
  format?: string[];
  thumb?: string;
  cover_image?: string;
};

type MetadataResponse = {
  saved?: VinylMeta | null;
  musicbrainz?: Array<Record<string, any>>;
  discogs?: DiscogsSearchResult[];
  discogsConfigured?: boolean;
};

function cover(id?: string, size = 500) {
  return id ? `/api/cover/${encodeURIComponent(id)}?size=${size}` : '/icon.svg';
}

function fmt(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fallbackSplit(album: AlbumDetail, meta: VinylMeta | null) {
  if (meta?.sideBreakAfterTrack) return meta.sideBreakAfterTrack;
  const songs = album.song || [];
  const half = songs.reduce((a, s) => a + (s.duration || 0), 0) / 2;
  let sum = 0;
  let best = 1;
  let bestDiff = Infinity;
  songs.forEach((song, i) => {
    sum += song.duration || 0;
    const diff = Math.abs(sum - half);
    if (diff < bestDiff && i < songs.length - 1) {
      best = i + 1;
      bestDiff = diff;
    }
  });
  return best;
}

function buildPlaybackSides(album: AlbumDetail, meta: VinylMeta | null): PlaybackSide[] {
  const exact = meta?.sides || [];
  if (exact.length) {
    const byId = new Map(album.song.map((song) => [song.id, song]));
    const mapped = exact.map((side) => ({
      label: side.label,
      songs: side.tracks.map((track) => (track.navidromeSongId ? byId.get(track.navidromeSongId) : undefined)).filter(Boolean) as Song[],
    }));
    const mappedIds = mapped.flatMap((side) => side.songs.map((song) => song.id));
    const unique = new Set(mappedIds);
    if (mappedIds.length === album.song.length && unique.size === album.song.length && exact.length >= 2) return mapped;
  }

  const split = fallbackSplit(album, meta);
  return [
    { label: 'A', songs: album.song.slice(0, split) },
    { label: 'B', songs: album.song.slice(split) },
  ].filter((side) => side.songs.length);
}

function buildDisplaySides(album: AlbumDetail, meta: VinylMeta | null, playback: PlaybackSide[]): DisplaySide[] {
  if (meta?.sides?.length) {
    const byId = new Map(album.song.map((song) => [song.id, song]));
    return meta.sides.map((side) => ({
      label: side.label,
      rows: side.tracks.map((track) => ({
        position: track.position,
        title: track.title,
        duration: track.duration,
        song: track.navidromeSongId ? byId.get(track.navidromeSongId) : undefined,
      })),
    }));
  }
  return playback.map((side) => ({
    label: side.label,
    rows: side.songs.map((song, i) => ({
      position: `${side.label}${i + 1}`,
      title: song.title,
      duration: song.duration ? fmt(song.duration) : undefined,
      song,
    })),
  }));
}

function discogsReleaseUrl(meta: VinylMeta) {
  if (!meta.discogsUri) return undefined;
  if (/^https?:\/\//i.test(meta.discogsUri)) return meta.discogsUri;
  return `https://www.discogs.com${meta.discogsUri.startsWith('/') ? meta.discogsUri : `/${meta.discogsUri}`}`;
}

function selectedReleaseImage(meta: VinylMeta | null, album: AlbumDetail) {
  if (meta?.images?.length) {
    const primaryIndex = meta.images.findIndex((image) => image.type === 'primary' && image.uri);
    const firstIndex = meta.images.findIndex((image) => image.uri);
    const index = primaryIndex >= 0 ? primaryIndex : firstIndex;
    if (index >= 0) return `/api/metadata/${encodeURIComponent(album.id)}/image/${index}`;
  }
  return cover(album.coverArt, 900);
}

function transitionText(from?: string, to?: string) {
  if (!from || !to) return `Continue to Side ${to || ''}`;
  const fromIndex = /^[A-Z]$/.test(from) ? from.charCodeAt(0) - 65 : -1;
  const toIndex = /^[A-Z]$/.test(to) ? to.charCodeAt(0) - 65 : -1;
  if (fromIndex >= 0 && toIndex === fromIndex + 1) {
    return fromIndex % 2 === 0 ? `Flip to Side ${to}` : `Change record · Side ${to}`;
  }
  return `Continue to Side ${to}`;
}

export default function Home() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selected, setSelected] = useState<AlbumDetail | null>(null);
  const [meta, setMeta] = useState<VinylMeta | null>(null);
  const [view, setView] = useState<View>('library');
  const [sort, setSort] = useState<SortMode>('alphabeticalByArtist');
  const [query, setQuery] = useState('');
  const [strict, setStrict] = useState(true);
  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queueSideLengths, setQueueSideLengths] = useState<number[]>([]);
  const [queueSideLabels, setQueueSideLabels] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [needsFlip, setNeedsFlip] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const current = queueIndex >= 0 ? queue[queueIndex] : null;
  const playbackSides = useMemo(() => (selected ? buildPlaybackSides(selected, meta) : []), [selected, meta]);

  useEffect(() => {
    loadAlbums('alphabeticalByArtist', true);
  }, []);

  useEffect(() => {
    if (!audio.current || !current) return;
    audio.current.src = `/api/stream/${encodeURIComponent(current.id)}`;
    audio.current.play().then(() => setPlaying(true)).catch(() => {});
    if (navigator.mediaSession) setMedia(current);
  }, [current?.id]);

  async function loadAlbums(type: SortMode, probe = false) {
    const endpoint = type === 'starred' ? '/api/albums?type=alphabeticalByArtist&size=500' : `/api/albums?type=${type}&size=500`;
    const r = await fetch(endpoint);
    if (r.status === 401) {
      setLoggedIn(false);
      return;
    }
    if (!r.ok) {
      if (probe) setLoggedIn(false);
      return;
    }
    const d = await r.json();
    let list: Album[] = d.albums || [];
    if (type === 'starred') list = list.filter((album) => album.starred);
    setAlbums(list);
    setLoggedIn(true);
  }

  async function openAlbum(id: string) {
    const r = await fetch(`/api/album/${encodeURIComponent(id)}`);
    if (!r.ok) return;
    const d = await r.json();
    setSelected(d.album);
    setMeta(d.meta);
    setView('album');
    setNeedsFlip(null);
  }

  async function doSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      loadAlbums(sort);
      return;
    }
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (r.ok) {
      const d = await r.json();
      setAlbums(d.album || []);
    }
  }

  async function random() {
    const r = await fetch('/api/random');
    if (r.ok) {
      const d = await r.json();
      if (d.album) openAlbum(d.album.id);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setLoggedIn(false);
    setSelected(null);
    setAlbums([]);
  }

  function playSide(sideIndex = 0, trackIndex = 0) {
    if (!selected || !playbackSides.length) return;
    const flat = playbackSides.flatMap((side) => side.songs);
    const offset = playbackSides.slice(0, sideIndex).reduce((sum, side) => sum + side.songs.length, 0);
    setQueue(flat);
    setQueueSideLengths(playbackSides.map((side) => side.songs.length));
    setQueueSideLabels(playbackSides.map((side) => side.label));
    setQueueIndex(offset + trackIndex);
    setNeedsFlip(null);
  }

  function queueSideInfo(index: number) {
    let start = 0;
    for (let sideIndex = 0; sideIndex < queueSideLengths.length; sideIndex += 1) {
      const end = start + queueSideLengths[sideIndex] - 1;
      if (index >= start && index <= end) return { sideIndex, start, end };
      start = end + 1;
    }
    return null;
  }

  function toggle() {
    if (!audio.current) return;
    if (audio.current.paused) {
      audio.current.play();
      setPlaying(true);
    } else {
      audio.current.pause();
      setPlaying(false);
    }
  }

  function ended() {
    if (!selected || queueIndex < 0) return;
    fetch('/api/scrobble', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: queue[queueIndex].id, submission: true }),
    }).catch(() => {});

    const info = queueSideInfo(queueIndex);
    if (strict && info && queueIndex === info.end && info.sideIndex < queueSideLengths.length - 1) {
      setPlaying(false);
      setNeedsFlip(info.sideIndex + 1);
      return;
    }
    if (queueIndex < queue.length - 1) setQueueIndex((i) => i + 1);
    else setPlaying(false);
  }

  function next() {
    if (queueIndex >= queue.length - 1) return;
    const info = queueSideInfo(queueIndex);
    if (strict && info && queueIndex === info.end && info.sideIndex < queueSideLengths.length - 1) {
      setNeedsFlip(info.sideIndex + 1);
      setPlaying(false);
      audio.current?.pause();
    } else {
      setQueueIndex((i) => i + 1);
    }
  }

  function prev() {
    if (queueIndex > 0) setQueueIndex((i) => i - 1);
  }

  function flip() {
    if (needsFlip === null) return;
    const start = queueSideLengths.slice(0, needsFlip).reduce((sum, length) => sum + length, 0);
    setQueueIndex(start);
    setNeedsFlip(null);
  }

  function setMedia(song: Song) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: [{ src: location.origin + cover(song.coverArt, 512), sizes: '512x512', type: 'image/jpeg' }],
    });
    navigator.mediaSession.setActionHandler('play', () => {
      audio.current?.play();
      setPlaying(true);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.current?.pause();
      setPlaying(false);
    });
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }

  if (loggedIn === false) return <Login onSuccess={() => loadAlbums('alphabeticalByArtist')} />;
  if (loggedIn === null) {
    return <div className="splash"><Disc3 className="spin" size={72} /><h1>NeedleDrop</h1><p>Opening the record room…</p></div>;
  }

  const fromLabel = needsFlip !== null ? queueSideLabels[needsFlip - 1] : undefined;
  const toLabel = needsFlip !== null ? queueSideLabels[needsFlip] : undefined;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView('library')}><Disc3 /><span>NeedleDrop</span></button>
      <div className="header-actions">
        <label className="mode-toggle" title="Vinyl Mode stops at the end of each physical side"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /><span>{strict ? 'Vinyl Mode' : 'Normal Mode'}</span></label>
        <button className="icon-btn" onClick={random} title="Pick a record for me"><Shuffle /></button>
        <button className="icon-btn" onClick={logout} title="Sign out"><LogOut /></button>
      </div>
    </header>

    {view === 'library' && <section className="library-page">
      <div className="hero"><div><p className="eyebrow">YOUR RECORD ROOM</p><h1>What are we spinning?</h1><p>Browse the shelf. Pick a jacket. Put the record on.</p></div><button className="hero-random" onClick={random}><Sparkles /> Pick a record for me</button></div>
      <div className="library-tools">
        <div className="searchbox"><Search size={18} /><input value={query} onChange={(e) => doSearch(e.target.value)} placeholder="Search the collection" /></div>
        <select value={sort} onChange={(e) => { const s = e.target.value as SortMode; setSort(s); setQuery(''); loadAlbums(s); }}>
          <option value="alphabeticalByArtist">Artist A–Z</option><option value="newest">Recently added</option><option value="recent">Recently played</option><option value="frequent">Most played</option><option value="starred">Favourites</option>
        </select>
      </div>
      <div className="record-grid">{albums.map((album) => <button className="record-card" key={album.id} onClick={() => openAlbum(album.id)}><div className="jacket"><img src={cover(album.coverArt)} alt="" loading="lazy" /><div className="vinyl-peek"><span /></div></div><div className="record-caption"><strong>{album.name}</strong><span>{album.artist}{album.year ? ` · ${album.year}` : ''}</span></div></button>)}</div>
      {!albums.length && <div className="empty"><LibraryBig /><h2>No records found</h2><p>Try another search or view.</p></div>}
    </section>}

    {view === 'album' && selected && <AlbumView album={selected} meta={meta} strict={strict} onBack={() => setView('library')} onPlay={playSide} onMeta={(m) => setMeta(m)} playbackSides={playbackSides} currentId={current?.id} />}

    <audio ref={audio} onEnded={ended} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} preload="metadata" />
    {current && <div className="now-playing"><img src={cover(current.coverArt, 160)} alt="" /><div className="np-copy"><strong>{current.title}</strong><span>{current.artist}</span></div><div className="np-controls"><button onClick={prev}><SkipBack /></button><button className="play-button" onClick={toggle}>{playing ? <Pause /> : <Play />}</button><button onClick={next}><SkipForward /></button></div></div>}
    {needsFlip !== null && selected && <div className="flip-overlay"><div className="flip-card"><div className="big-record"><Disc3 size={170} /></div><p>SIDE {fromLabel} COMPLETE</p><h2>{fromLabel && /^[A-Z]$/.test(fromLabel) && (fromLabel.charCodeAt(0) - 65) % 2 === 1 ? 'Change the record' : 'Flip the record'}</h2><span>{selected.artist} — {selected.name}</span><button onClick={flip}><RotateCcw /> {transitionText(fromLabel, toLabel)}</button></div></div>}
  </main>;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(d.error || 'Login failed');
      return;
    }
    onSuccess();
  }

  return <div className="login-page"><div className="login-panel"><Disc3 size={62} /><p className="eyebrow">VIRTUAL VINYL</p><h1>NeedleDrop</h1><p>Sign in with your Navidrome account.</p><form onSubmit={submit}><label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <div className="error">{error}</div>}<button disabled={busy}>{busy ? 'Opening…' : 'Enter the record room'}</button></form></div></div>;
}

function AlbumView({ album, meta, strict, onBack, onPlay, onMeta, playbackSides, currentId }: {
  album: AlbumDetail;
  meta: VinylMeta | null;
  strict: boolean;
  onBack: () => void;
  onPlay: (sideIndex?: number, trackIndex?: number) => void;
  onMeta: (meta: VinylMeta) => void;
  playbackSides: PlaybackSide[];
  currentId?: string;
}) {
  const [details, setDetails] = useState(false);
  const [enrich, setEnrich] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectingRelease, setSelectingRelease] = useState<number | null>(null);
  const displaySides = useMemo(() => buildDisplaySides(album, meta, playbackSides), [album, meta, playbackSides]);
  const exactPlayback = Boolean(meta?.sides?.length && playbackSides.length === meta.sides.length && playbackSides.every((side, i) => side.label === meta.sides?.[i]?.label));
  const displayRowsArePlayable = exactPlayback || !meta?.sides?.length;

  async function metadata() {
    setDetails(true);
    setLoading(true);
    const r = await fetch(`/api/metadata/${album.id}`);
    if (r.ok) setEnrich(await r.json());
    setLoading(false);
  }

  async function save(patch: Partial<VinylMeta>) {
    const r = await fetch(`/api/metadata/${album.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.ok) {
      const d = await r.json();
      onMeta(d.meta);
      setEnrich((current) => current ? { ...current, saved: d.meta } : current);
    }
  }

  async function selectDiscogs(releaseId: number) {
    setSelectingRelease(releaseId);
    const r = await fetch(`/api/metadata/${album.id}/discogs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ releaseId }) });
    const d = await r.json().catch(() => ({}));
    setSelectingRelease(null);
    if (!r.ok) {
      alert(d.error || 'Could not load that Discogs release.');
      return;
    }
    onMeta(d.meta);
    setEnrich((current) => current ? { ...current, saved: d.meta } : current);
  }

  async function star() {
    await fetch('/api/star', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: album.id, starred: !album.starred }) });
  }

  return <section className="album-page">
    <button className="back" onClick={onBack}>← Back to collection</button>
    <div className="album-stage">
      <div className="sleeve-stack"><div className="album-disc"><span /></div><img src={selectedReleaseImage(meta, album)} alt={`${album.name} cover`} /></div>
      <div className="album-copy">
        <p className="eyebrow">{meta?.source === 'discogs' ? 'SELECTED DISCOGS PRESSING' : meta?.pressingLabel || 'FROM YOUR VINYL LIBRARY'}</p>
        <h1>{album.name}</h1><h2>{album.artist}</h2>
        <p className="album-facts">{meta?.releaseYear || album.year || 'Unknown year'}{album.genre ? ` · ${album.genre}` : ''}{meta?.country ? ` · ${meta.country}` : ''}</p>
        {meta?.source === 'discogs' && <p className="release-summary">{[meta.pressingLabel, meta.catalogNumber, meta.formatDescription].filter(Boolean).join(' · ')}</p>}
        <div className="album-actions"><button className="primary" onClick={() => onPlay(0)}><Play /> Play Side {playbackSides[0]?.label || 'A'}</button><button onClick={star}><Heart /> Favourite</button><button onClick={metadata}><Settings2 /> Pressing & details</button></div>
        <p className="mode-note">{strict ? 'Vinyl Mode is on: playback stops at the end of each physical side.' : 'Normal Mode is on: tracks can be selected directly.'}</p>
        {meta?.sides?.length && !exactPlayback && <div className="mapping-warning"><AlertTriangle size={17} /><span>The selected pressing has a different track layout from your Navidrome files. Its exact Discogs sides are shown below, but playback is using the safe A/B fallback.</span></div>}
      </div>
    </div>

    <div className={`track-sides ${displaySides.length > 2 ? 'many-sides' : ''}`}>{displaySides.map((side) => {
      const playableSideIndex = playbackSides.findIndex((candidate) => candidate.label === side.label);
      return <TrackSide key={side.label} label={`SIDE ${side.label}`} rows={side.rows} strict={strict} currentId={currentId} playable={displayRowsArePlayable && playableSideIndex >= 0} onPlay={(trackIndex) => onPlay(playableSideIndex, trackIndex)} />;
    })}</div>

    {details && <div className="drawer-backdrop" onClick={() => setDetails(false)}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="drawer-x" onClick={() => setDetails(false)}><X /></button><p className="eyebrow">RECORD DETAILS</p><h2>{album.name}</h2><MetaEditor meta={meta} save={save} />{meta?.source === 'discogs' && <SelectedReleaseDetails meta={meta} albumId={album.id} />}<h3>Choose pressing</h3>{loading ? <p>Checking MusicBrainz and Discogs…</p> : <Pressings data={enrich} meta={meta} selectingRelease={selectingRelease} selectDiscogs={selectDiscogs} save={save} />}</aside></div>}
  </section>;
}

function TrackSide({ label, rows, strict, currentId, playable, onPlay }: { label: string; rows: SideRow[]; strict: boolean; currentId?: string; playable: boolean; onPlay: (trackIndex: number) => void }) {
  return <div className="side"><div className="side-label"><Disc3 /><span>{label}</span><em>{rows.length} track{rows.length === 1 ? '' : 's'}</em></div><ol>{rows.map((row, i) => <li key={`${row.position}-${i}`} className={`${row.song?.id === currentId ? 'active ' : ''}${!row.song ? 'unmapped' : ''}`}><button disabled={!playable || !row.song || (strict && i > 0)} onClick={() => onPlay(i)}><span>{row.position || String(i + 1).padStart(2, '0')}</span><strong>{row.title}</strong><em>{row.duration || (row.song?.duration ? fmt(row.song.duration) : '')}</em></button></li>)}</ol></div>;
}

function MetaEditor({ meta, save }: { meta: VinylMeta | null; save: (patch: Partial<VinylMeta>) => void }) {
  const [form, setForm] = useState<VinylMeta>(meta || {});
  useEffect(() => setForm(meta || {}), [meta]);
  function field(key: keyof VinylMeta, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  return <div className="meta-form"><label>Vinyl colour<input value={form.vinylColor || ''} onChange={(e) => field('vinylColor', e.target.value)} placeholder="Black" /></label><label>Condition<input value={form.condition || ''} onChange={(e) => field('condition', e.target.value)} placeholder="Virtual copy / NM" /></label><label>Crate / shelf<input value={form.crate || ''} onChange={(e) => field('crate', e.target.value)} placeholder="Main shelf" /></label><label>Acquired<input type="date" value={form.acquiredAt || ''} onChange={(e) => field('acquiredAt', e.target.value)} /></label><label className="wide">Your notes<textarea value={form.notes || ''} onChange={(e) => field('notes', e.target.value)} placeholder="Anything you want to remember about this copy…" /></label><button className="primary wide" onClick={() => save(form)}>Save personal details</button></div>;
}

function SelectedReleaseDetails({ meta, albumId }: { meta: VinylMeta; albumId: string }) {
  return <div className="discogs-details">
    <div className="details-heading"><div><p className="eyebrow">PHYSICAL RELEASE</p><h3>{meta.pressingTitle || 'Selected Discogs release'}</h3></div>{discogsReleaseUrl(meta) && <a href={discogsReleaseUrl(meta)} target="_blank" rel="noreferrer">Discogs <ExternalLink size={14} /></a>}</div>
    <div className="release-facts"><span><b>Release</b>{meta.discogsReleaseId}</span><span><b>Country</b>{meta.country || '—'}</span><span><b>Released</b>{meta.released || meta.releaseYear || '—'}</span><span><b>Label</b>{meta.pressingLabel || '—'}</span><span><b>Catalogue</b>{meta.catalogNumber || '—'}</span><span><b>Format</b>{meta.formatDescription || 'Vinyl'}</span></div>

    {meta.images?.length ? <div className="metadata-section"><h4>Release images</h4><div className="release-images">{meta.images.slice(0, 12).map((image, i) => image.uri ? <a key={`${image.uri}-${i}`} href={image.uri} target="_blank" rel="noreferrer"><img src={`/api/metadata/${encodeURIComponent(albumId)}/image/${i}`} alt={`Discogs release image ${i + 1}`} loading="lazy" /></a> : null)}</div></div> : null}

    {meta.sides?.length ? <div className="metadata-section"><h4>Discogs track & side layout</h4>{meta.sides.map((side) => <div className="discogs-side" key={side.label}><strong>Side {side.label}</strong>{side.tracks.map((track, i) => <div className="discogs-track" key={`${track.position}-${i}`}><span>{track.position}</span><b>{track.title}</b><em>{track.duration || ''}</em>{!track.navidromeSongId && <small>unmapped</small>}</div>)}</div>)}</div> : null}

    {meta.trackMappingWarnings?.length ? <div className="metadata-section"><h4>Track mapping</h4>{meta.trackMappingWarnings.map((warning, i) => <div className="mapping-warning" key={i}><AlertTriangle size={16} /><span>{warning}</span></div>)}</div> : null}

    {meta.releaseNotes ? <div className="metadata-section"><h4>Release notes</h4><p className="release-notes">{meta.releaseNotes}</p></div> : null}

    {meta.credits?.length ? <div className="metadata-section"><h4>Credits</h4><div className="compact-list">{meta.credits.slice(0, 80).map((credit, i) => <div key={`${credit.name}-${credit.role}-${i}`}><strong>{credit.name}</strong><span>{[credit.role, credit.tracks].filter(Boolean).join(' · ')}</span></div>)}</div></div> : null}

    {meta.identifiers?.length ? <div className="metadata-section"><h4>Identifiers</h4><div className="compact-list">{meta.identifiers.map((identifier, i) => <div key={`${identifier.type}-${identifier.value}-${i}`}><strong>{identifier.type || 'Identifier'}</strong><span>{[identifier.value, identifier.description].filter(Boolean).join(' · ')}</span></div>)}</div></div> : null}
  </div>;
}

function Pressings({ data, meta, selectingRelease, selectDiscogs, save }: {
  data: MetadataResponse | null;
  meta: VinylMeta | null;
  selectingRelease: number | null;
  selectDiscogs: (releaseId: number) => void;
  save: (patch: Partial<VinylMeta>) => void;
}) {
  if (!data) return <p>No metadata loaded.</p>;
  const mb = data.musicbrainz || [];
  const dc = data.discogs || [];
  return <div className="pressings">
    {!data.discogsConfigured && <div className="mapping-warning"><AlertTriangle size={17} /><span>Add a <code>DISCOGS_TOKEN</code> to the container to enable exact pressing selection, release images, sides, credits and identifiers.</span></div>}
    {dc.slice(0, 16).map((pressing) => {
      const selected = meta?.discogsReleaseId === pressing.id;
      return <button className={selected ? 'selected' : ''} disabled={selectingRelease !== null} key={`d${pressing.id}`} onClick={() => selectDiscogs(pressing.id)}>{pressing.thumb && <img src={pressing.thumb} alt="" loading="lazy" />}<div><strong>{pressing.title}</strong><span>{[pressing.country, pressing.year, pressing.label?.[0], pressing.catno, ...(pressing.format || [])].filter(Boolean).join(' · ')}</span><em>{selectingRelease === pressing.id ? 'Loading full release…' : selected ? 'Selected Discogs release' : `Discogs release #${pressing.id}`}</em></div></button>;
    })}
    {mb.slice(0, 8).map((pressing) => <button className="no-thumb" key={`m${pressing.id}`} onClick={() => save({ source: 'musicbrainz', pressingId: `musicbrainz:${pressing.id}`, pressingLabel: pressing['label-info']?.[0]?.label?.name || 'MusicBrainz vinyl', catalogNumber: pressing['label-info']?.[0]?.['catalog-number'], country: pressing.country, releaseYear: Number((pressing.date || '').slice(0, 4)) || undefined })}><div><strong>{pressing.title}</strong><span>{[pressing.country, pressing.date, pressing['label-info']?.[0]?.label?.name, pressing['label-info']?.[0]?.['catalog-number']].filter(Boolean).join(' · ')}</span><em>MusicBrainz fallback</em></div></button>)}
    {!mb.length && !dc.length && <p>No confident vinyl pressing matches were returned. You can still keep manual record details above.</p>}
  </div>;
}
