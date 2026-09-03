'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Disc3,
  Layers3,
  LibraryBig,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { Album, AlbumDetail, AppSettings, Song, TurntableSpeed, VinylMeta } from './types';
import { buildDisplaySides, buildPlaybackSides, cover, nominalSpeed, transitionText } from './vinyl';
import AlbumView from './AlbumView';
import CollectionBrowser, { type CollectionSort } from './CollectionBrowser';
import LibraryManager from './LibraryManager';
import MetadataDrawer from './MetadataDrawer';
import SettingsPanel from './SettingsPanel';
import Turntable from './Turntable';
import ChangerPanel, { type ChangerItem } from './ChangerPanel';

type View = 'library' | 'album' | 'turntable';
const CHANGER_STORAGE = 'needledrop.changerQueue.v1';

export default function NeedleDropApp() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selected, setSelected] = useState<AlbumDetail | null>(null);
  const [meta, setMeta] = useState<VinylMeta | null>(null);
  const [playingAlbum, setPlayingAlbum] = useState<AlbumDetail | null>(null);
  const [playingMeta, setPlayingMeta] = useState<VinylMeta | null>(null);
  const [view, setView] = useState<View>('library');
  const [sort, setSort] = useState<CollectionSort>('artist');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState('0.6.0');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryManagerOpen, setLibraryManagerOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [changerOpen, setChangerOpen] = useState(false);
  const [strict, setStrict] = useState(true);
  const settingsApplied = useRef(false);

  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queueSideLengths, setQueueSideLengths] = useState<number[]>([]);
  const [queueSideLabels, setQueueSideLabels] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [needsFlip, setNeedsFlip] = useState<number | null>(null);
  const [motorOn, setMotorOn] = useState(true);
  const [cueDown, setCueDown] = useState(true);
  const [speed, setSpeed] = useState<TurntableSpeed>(33.333);
  const [pitch, setPitch] = useState(0);
  const [trackTime, setTrackTime] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const pendingSeek = useRef<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const [changerQueue, setChangerQueue] = useState<ChangerItem[]>([]);
  const current = queueIndex >= 0 ? queue[queueIndex] : null;
  const selectedPlaybackSides = useMemo(() => selected ? buildPlaybackSides(selected, meta) : [], [selected, meta]);
  const selectedDisplaySides = useMemo(() => selected ? buildDisplaySides(selected, meta, selectedPlaybackSides) : [], [selected, meta, selectedPlaybackSides]);

  useEffect(() => {
    void bootstrap();
    try {
      const stored = localStorage.getItem(CHANGER_STORAGE);
      if (stored) setChangerQueue(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CHANGER_STORAGE, JSON.stringify(changerQueue)); } catch {}
  }, [changerQueue]);

  useEffect(() => {
    if (!audio.current || !current) return;
    const element = audio.current;
    element.src = `/api/stream/${encodeURIComponent(current.id)}`;
    element.load();
    if (navigator.mediaSession) setMedia(current);
  }, [current?.id]);

  useEffect(() => {
    const element = audio.current;
    if (!element || !current) return;
    if (motorOn && cueDown) element.play().then(() => setPlaying(true)).catch(() => {});
    else {
      element.pause();
      setPlaying(false);
    }
  }, [motorOn, cueDown, current?.id]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const simulate = settings?.simulateSpeed !== false;
    const native = nominalSpeed(playingMeta);
    const rate = simulate ? (speed / native) * (1 + pitch / 100) : 1;
    element.playbackRate = Math.max(0.25, Math.min(4, rate));
    element.preservesPitch = !simulate;
  }, [speed, pitch, playingMeta, settings?.simulateSpeed]);

  async function bootstrap() {
    const [albumResponse, settingsResponse] = await Promise.all([
      fetch('/api/albums?type=alphabeticalByArtist&size=500'),
      fetch('/api/settings'),
    ]);
    if (albumResponse.status === 401) {
      setLoggedIn(false);
      return;
    }
    if (albumResponse.ok) {
      const payload = await albumResponse.json();
      setAlbums(payload.albums || []);
      setLoggedIn(true);
    } else setLoggedIn(false);

    if (settingsResponse.ok) {
      const payload = await settingsResponse.json();
      applySettings(payload.settings, payload.version);
    }
  }

  function applySettings(next: AppSettings, nextVersion?: string) {
    setSettings(next);
    if (nextVersion) setVersion(nextVersion);
    if (!settingsApplied.current) {
      setStrict(next.defaultPlaybackMode !== 'normal');
      setSpeed(next.defaultTurntableSpeed || 33.333);
      settingsApplied.current = true;
    }
  }

  async function refreshSettings() {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const payload = await response.json();
    applySettings(payload.settings, payload.version);
  }

  function handleSettingsSaved(next: AppSettings) {
    const libraryChanged = settings?.navidromeMusicFolderId !== next.navidromeMusicFolderId;
    applySettings(next);
    setSettingsOpen(false);
    if (!libraryChanged) return;
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current.load();
    }
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
    setPlaying(false);
    setAlbums([]);
    setQuery('');
    setSelected(null);
    setMeta(null);
    setMetadataOpen(false);
    setPlayingAlbum(null);
    setPlayingMeta(null);
    setQueue([]);
    setQueueIndex(-1);
    setQueueSideLengths([]);
    setQueueSideLabels([]);
    setNeedsFlip(null);
    setTrackTime(0);
    setTrackDuration(0);
    pendingSeek.current = null;
    setChangerQueue([]);
    setView('library');
    void loadAlbums(sort);
  }

  async function loadAlbums(type: CollectionSort, probe = false) {
    const serverType = type === 'newest'
      ? 'newest'
      : type === 'recent'
        ? 'recent'
        : type === 'frequent'
          ? 'frequent'
          : type === 'album'
            ? 'alphabeticalByName'
            : 'alphabeticalByArtist';
    const response = await fetch(`/api/albums?type=${serverType}&size=500`);
    if (response.status === 401) {
      setLoggedIn(false);
      return;
    }
    if (!response.ok) {
      if (probe) setLoggedIn(false);
      return;
    }
    const payload = await response.json();
    let list: Album[] = payload.albums || [];
    if (type === 'starred') list = list.filter((album) => album.starred);
    setAlbums(list);
    setLoggedIn(true);
  }

  async function changeSort(next: CollectionSort) {
    setSort(next);
    setQuery('');
    await loadAlbums(next);
  }

  async function fetchAlbumDetails(id: string): Promise<{ album: AlbumDetail; meta: VinylMeta | null } | null> {
    const response = await fetch(`/api/album/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const payload = await response.json();
    return { album: payload.album, meta: payload.meta };
  }

  async function openAlbum(id: string) {
    const details = await fetchAlbumDetails(id);
    if (!details) return;
    setSelected(details.album);
    setMeta(details.meta);
    setView('album');
    setMetadataOpen(false);
  }

  async function doSearch(value: string) {
    setQuery(value);
    if (!value.trim()) {
      void loadAlbums(sort);
      return;
    }
    const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
    if (response.ok) {
      const payload = await response.json();
      setAlbums(payload.album || []);
    }
  }

  async function random() {
    const response = await fetch('/api/random');
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.album) void openAlbum(payload.album.id);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    audio.current?.pause();
    setLoggedIn(false);
    setSelected(null);
    setPlayingAlbum(null);
    setAlbums([]);
  }

  function startPlayback(album: AlbumDetail, albumMeta: VinylMeta | null, sideIndex = 0, trackIndex = 0, openDeck = false) {
    const sides = buildPlaybackSides(album, albumMeta);
    if (!sides.length) return;
    const flat = sides.flatMap((side) => side.songs);
    const offset = sides.slice(0, sideIndex).reduce((sum, side) => sum + side.songs.length, 0);
    setPlayingAlbum(album);
    setPlayingMeta(albumMeta);
    setQueue(flat);
    setQueueSideLengths(sides.map((side) => side.songs.length));
    setQueueSideLabels(sides.map((side) => side.label));
    setQueueIndex(offset + trackIndex);
    setNeedsFlip(null);
    setTrackTime(0);
    setMotorOn(true);
    setCueDown(true);
    if (openDeck) setView('turntable');
  }

  function playSelectedSide(sideIndex: number, trackIndex = 0) {
    if (!selected) return;
    startPlayback(selected, meta, sideIndex, trackIndex, false);
  }

  function openTurntable() {
    if (selected && playingAlbum?.id !== selected.id) startPlayback(selected, meta, 0, 0, true);
    else if (playingAlbum) setView('turntable');
    else if (selected) startPlayback(selected, meta, 0, 0, true);
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

  function sideProgress() {
    const info = queueSideInfo(queueIndex);
    if (!info) return 0;
    let elapsed = 0;
    let total = 0;
    for (let index = info.start; index <= info.end; index += 1) {
      total += queue[index]?.duration || 0;
      if (index < queueIndex) elapsed += queue[index]?.duration || 0;
    }
    elapsed += trackTime;
    return total ? Math.max(0, Math.min(1, elapsed / total)) : 0;
  }

  function seekCurrentSide(progress: number) {
    const info = queueSideInfo(queueIndex);
    if (!info) return;
    const total = queue.slice(info.start, info.end + 1).reduce((sum, song) => sum + (song.duration || 0), 0);
    let target = Math.max(0, Math.min(1, progress)) * total;
    for (let index = info.start; index <= info.end; index += 1) {
      const duration = queue[index]?.duration || 0;
      if (target <= duration || index === info.end) {
        setMotorOn(true);
        setCueDown(true);
        if (index === queueIndex && audio.current) {
          audio.current.currentTime = Math.min(target, Math.max(0, audio.current.duration - 0.1));
        } else {
          pendingSeek.current = target;
          setQueueIndex(index);
        }
        return;
      }
      target -= duration;
    }
  }

  function toggle() {
    if (!audio.current || !current) return;
    if (audio.current.paused) {
      setMotorOn(true);
      setCueDown(true);
      audio.current.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      audio.current.pause();
      setPlaying(false);
    }
  }

  function toggleMotor() {
    setMotorOn((value) => !value);
  }

  function toggleCue() {
    setCueDown((value) => !value);
  }

  async function ended() {
    if (queueIndex < 0) return;
    void fetch('/api/scrobble', {
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
    if (queueIndex < queue.length - 1) {
      setQueueIndex((index) => index + 1);
      return;
    }
    setPlaying(false);
    if (settings?.changerEnabled !== false && changerQueue.length) await advanceChanger();
  }

  function next() {
    if (queueIndex >= queue.length - 1) return;
    const info = queueSideInfo(queueIndex);
    if (strict && info && queueIndex === info.end && info.sideIndex < queueSideLengths.length - 1) {
      setNeedsFlip(info.sideIndex + 1);
      setPlaying(false);
      audio.current?.pause();
    } else setQueueIndex((index) => index + 1);
  }

  function prev() {
    if (queueIndex > 0) setQueueIndex((index) => index - 1);
  }

  function selectTrack(index: number) {
    if (strict || index < 0 || index >= queue.length) return;
    setNeedsFlip(null);
    setMotorOn(true);
    setCueDown(true);
    setTrackTime(0);
    if (index === queueIndex) {
      pendingSeek.current = null;
      if (audio.current) {
        audio.current.currentTime = 0;
        audio.current.play().then(() => setPlaying(true)).catch(() => {});
      }
      return;
    }
    pendingSeek.current = 0;
    setQueueIndex(index);
  }

  function flip() {
    if (needsFlip === null) return;
    const start = queueSideLengths.slice(0, needsFlip).reduce((sum, length) => sum + length, 0);
    setQueueIndex(start);
    setNeedsFlip(null);
    setMotorOn(true);
    setCueDown(true);
  }

  function addToChanger(album: Album) {
    setChangerQueue((items) => [...items, { key: `${album.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`, album }]);
  }

  function moveChanger(index: number, direction: -1 | 1) {
    setChangerQueue((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const copy = [...items];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  async function advanceChanger(index = 0) {
    const item = changerQueue[index];
    if (!item) return;
    setChangerQueue((items) => items.filter((candidate) => candidate.key !== item.key));
    const details = await fetchAlbumDetails(item.album.id);
    if (!details) return;
    setSelected(details.album);
    setMeta(details.meta);
    startPlayback(details.album, details.meta, 0, 0, true);
  }

  function starSelected() {
    if (!selected) return;
    void fetch('/api/star', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: selected.id, starred: !selected.starred }),
    });
  }

  function setMedia(song: Song) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: [{ src: location.origin + cover(song.coverArt, 512), sizes: '512x512', type: 'image/jpeg' }],
    });
    navigator.mediaSession.setActionHandler('play', toggle);
    navigator.mediaSession.setActionHandler('pause', toggle);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }

  function handleLoadedMetadata() {
    const element = audio.current;
    if (!element) return;
    setTrackDuration(Number.isFinite(element.duration) ? element.duration : 0);
    if (pendingSeek.current !== null) {
      element.currentTime = Math.min(pendingSeek.current, Math.max(0, element.duration - 0.1));
      pendingSeek.current = null;
    }
    if (motorOn && cueDown) element.play().then(() => setPlaying(true)).catch(() => {});
  }

  if (loggedIn === false) return <Login onSuccess={() => { void loadAlbums('artist'); void refreshSettings(); }} />;
  if (loggedIn === null) return <div className="splash"><Image src="/needledrop-icon.svg" alt="" width={86} height={86} priority /><h1>NeedleDrop</h1><p>Opening the record room…</p></div>;

  const sideInfo = queueSideInfo(queueIndex);
  const activeSideLabel = sideInfo ? queueSideLabels[sideInfo.sideIndex] || 'A' : 'A';
  const fromLabel = needsFlip !== null ? queueSideLabels[needsFlip - 1] : undefined;
  const toLabel = needsFlip !== null ? queueSideLabels[needsFlip] : undefined;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView('library')}><Image src="/needledrop-icon.svg" alt="" width={34} height={34} /><span>NeedleDrop</span><small>v{version}</small></button>
      <div className="header-actions">
        <label className="mode-toggle" title="Vinyl Mode stops at the end of each physical side"><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} /><span>{strict ? 'Vinyl Mode' : 'Normal Mode'}</span></label>
        {playingAlbum && <button className="icon-btn" onClick={() => setView('turntable')} title="Turntable"><Disc3 /></button>}
        <button className="icon-btn with-count" onClick={() => setChangerOpen(true)} title="Record changer"><Layers3 /><span>{changerQueue.length}</span></button>
        <button className="icon-btn" onClick={() => setLibraryManagerOpen(true)} title="Library management"><LibraryBig /></button>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings"><Settings2 /></button>
        <button className="icon-btn" onClick={random} title="Pick a record for me"><Shuffle /></button>
        <button className="icon-btn" onClick={logout} title="Sign out"><LogOut /></button>
      </div>
    </header>

    {view === 'library' && <CollectionBrowser albums={albums} query={query} sort={sort} version={version} onSearch={(value) => void doSearch(value)} onSort={(next) => void changeSort(next)} onOpen={(id) => void openAlbum(id)} onQueue={addToChanger} onRandom={() => void random()} />}

    {view === 'album' && selected && <AlbumView album={selected} meta={meta} playbackSides={selectedPlaybackSides} displaySides={selectedDisplaySides} strict={strict} currentId={current?.id} onBack={() => setView('library')} onPlaySide={playSelectedSide} onOpenTurntable={openTurntable} onOpenMetadata={() => setMetadataOpen(true)} onAddChanger={() => addToChanger(selected)} onStar={starSelected} artworkOrder={settings?.artworkSourceOrder} />}

    {view === 'turntable' && playingAlbum && <Turntable album={playingAlbum} meta={playingMeta} current={current} currentIndex={queueIndex} tracks={queue} strict={strict} playing={playing} motorOn={motorOn} cueDown={cueDown} speed={speed} pitch={pitch} sideLabel={activeSideLabel} sideProgress={sideProgress()} queueCount={changerQueue.length} onBack={() => setView(selected ? 'album' : 'library')} onToggle={toggle} onMotor={toggleMotor} onCue={toggleCue} onSpeed={setSpeed} onPitch={setPitch} onNeedle={seekCurrentSide} onSelectTrack={selectTrack} onOpenChanger={() => setChangerOpen(true)} artworkOrder={settings?.artworkSourceOrder} />}

    <audio ref={audio} onEnded={() => void ended()} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={handleLoadedMetadata} onTimeUpdate={(event) => setTrackTime(event.currentTarget.currentTime)} preload="metadata" />

    {current && <div className="now-playing"><Image src={cover(current.coverArt, 160)} alt="" width={56} height={56} unoptimized /><div className="np-copy"><strong>{current.title}</strong><span>{current.artist} · Side {activeSideLabel}</span></div><div className="np-controls"><button onClick={prev}><SkipBack /></button><button className="play-button" onClick={toggle}>{playing ? <Pause /> : <Play />}</button><button onClick={next}><SkipForward /></button></div></div>}

    {needsFlip !== null && playingAlbum && <div className="flip-overlay"><div className="flip-card"><div className="big-record"><Disc3 size={170} /></div><p>{transitionText(fromLabel, toLabel).toUpperCase()}</p><h2>{fromLabel && toLabel && /^[A-Z]$/.test(fromLabel) && (fromLabel.charCodeAt(0) - 65) % 2 === 1 ? 'Change the record' : 'Flip the record'}</h2><span>{playingAlbum.artist} — {playingAlbum.name}</span><button onClick={flip}><RotateCcw /> {transitionText(fromLabel, toLabel)}</button></div></div>}

    {selected && <MetadataDrawer album={selected} meta={meta} open={metadataOpen} onClose={() => setMetadataOpen(false)} onMeta={(next) => { setMeta(next); setAlbums((items) => items.map((album) => album.id === selected.id ? { ...album, rating: next.rating } : album)); if (playingAlbum?.id === selected.id) setPlayingMeta(next); }} />}
    <SettingsPanel open={settingsOpen} settings={settings} version={version} onClose={() => setSettingsOpen(false)} onSaved={handleSettingsSaved} />
    <LibraryManager open={libraryManagerOpen} onClose={() => setLibraryManagerOpen(false)} onChanged={() => void loadAlbums(sort)} />
    <ChangerPanel open={changerOpen} items={changerQueue} enabled={settings?.changerEnabled !== false} onClose={() => setChangerOpen(false)} onMove={moveChanger} onRemove={(key) => setChangerQueue((items) => items.filter((item) => item.key !== key))} onPlayNow={(index) => { setChangerOpen(false); void advanceChanger(index); }} onClear={() => setChangerQueue([])} />
  </main>;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(payload.error || 'Login failed');
      return;
    }
    onSuccess();
  }

  return <div className="login-page"><div className="login-panel"><Image src="/needledrop-icon.svg" alt="NeedleDrop" width={72} height={72} /><p className="eyebrow">VIRTUAL VINYL</p><h1>NeedleDrop</h1><p>Sign in with your Navidrome account.</p><form onSubmit={submit}><label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="error">{error}</div>}<button disabled={busy}>{busy ? 'Opening…' : 'Enter the record room'}</button></form></div></div>;
}
