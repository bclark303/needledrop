'use client';

import Image from 'next/image';
import { Archive, ArrowLeft, Grid2X2, Library, PanelTopOpen, Search, Sparkles, Store, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Album, CollectionGroupMode, CollectionSort, CollectionViewMode, RecordRoomConfig, RecordRoomShelf } from './types';
import CollectionShelfView, { filterShelf, groupAlbums, sortAlbums } from './CollectionShelfView';
import RecordRoomPanel from './RecordRoomPanel';
import RecordRoomScene, { type RoomCollection } from './RecordRoomScene';
import { cover } from './vinyl';

export type { CollectionSort } from './types';

type BrowserScreen = 'room' | 'collection';

const DEFAULT_ROOM: RecordRoomConfig = {
  theme: 'audiophile',
  sort: 'artist',
  viewMode: 'grid',
  groupMode: 'none',
  featuredAlbumIds: [],
  shelves: [
    { id: 'smart-favourites', name: 'Favourites', kind: 'smart', presentation: 'shelf', rule: { type: 'starred' } },
    { id: 'smart-five-star', name: 'Five-star records', kind: 'smart', presentation: 'shelf', rule: { type: 'rating', minimum: 5 } },
    { id: 'smart-new-arrivals', name: 'New arrivals', kind: 'smart', presentation: 'crate', rule: { type: 'recent', days: 60 } },
  ],
  roomSlots: ['__all__', 'smart-favourites', 'smart-five-star', 'smart-new-arrivals'],
};

export default function CollectionBrowser({
  albums,
  query,
  sort,
  version,
  playingAlbum,
  onSearch,
  onSort,
  onOpen,
  onQueue,
  onRandom,
  onOpenTurntable,
}: {
  albums: Album[];
  query: string;
  sort: CollectionSort;
  version: string;
  playingAlbum?: Album | null;
  onSearch: (value: string) => void;
  onSort: (sort: CollectionSort) => void;
  onOpen: (id: string) => void;
  onQueue: (album: Album) => void;
  onRandom: () => void;
  onOpenTurntable?: () => void;
}) {
  const [room, setRoom] = useState<RecordRoomConfig>(DEFAULT_ROOM);
  const [roomOpen, setRoomOpen] = useState(false);
  const [screen, setScreen] = useState<BrowserScreen>('room');
  const [roomMessage, setRoomMessage] = useState('');
  const [mediaAlbum, setMediaAlbum] = useState<Album | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/record-room', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok || cancelled) return;
      const payload = await response.json().catch(() => ({})) as { room?: RecordRoomConfig };
      if (!payload.room || cancelled) return;
      setRoom(payload.room);
      if (payload.room.sort !== sort) onSort(payload.room.sort);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.recordRoomTheme = room.theme;
  }, [room.theme]);

  useEffect(() => {
    if (playingAlbum !== undefined) return;
    const resolve = () => {
      const metadata = navigator.mediaSession?.metadata;
      if (!metadata?.album) {
        setMediaAlbum(null);
        return;
      }
      const albumName = normalize(metadata.album);
      const artist = normalize(metadata.artist || '');
      setMediaAlbum(albums.find((album) => normalize(album.name) === albumName && (!artist || normalize(album.artist) === artist)) || albums.find((album) => normalize(album.name) === albumName) || null);
    };
    resolve();
    const timer = window.setInterval(resolve, 1000);
    return () => window.clearInterval(timer);
  }, [albums, playingAlbum]);

  useEffect(() => {
    if (!roomMessage) return;
    const timer = window.setTimeout(() => setRoomMessage(''), 2600);
    return () => window.clearTimeout(timer);
  }, [roomMessage]);

  function saveRoom(next: RecordRoomConfig) {
    setRoom(next);
    void fetch('/api/record-room', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
  }

  function selectShelf(shelf?: RecordRoomShelf) {
    saveRoom({ ...room, activeShelfId: shelf?.id, viewMode: shelf ? (shelf.presentation === 'crate' ? 'flip' : 'shelf') : room.viewMode });
  }

  function openRoomCollection(collectionId: string) {
    if (collectionId === '__all__') selectShelf();
    else selectShelf(room.shelves.find((shelf) => shelf.id === collectionId));
    onSearch('');
    setScreen('collection');
  }

  function openRoomTurntable() {
    const current = playingAlbum === undefined ? mediaAlbum : playingAlbum;
    if (!current) {
      setRoomMessage('Choose a record from one of the collections first.');
      return;
    }
    if (onOpenTurntable) {
      onOpenTurntable();
      return;
    }
    const headerButton = document.querySelector<HTMLButtonElement>('button[title="Turntable"]');
    if (headerButton) headerButton.click();
    else setRoomMessage('The turntable is not loaded yet.');
  }

  function toggleFeatured(albumId: string) {
    const active = room.featuredAlbumIds.includes(albumId);
    const featuredAlbumIds = active ? room.featuredAlbumIds.filter((id) => id !== albumId) : [...room.featuredAlbumIds.filter((id) => id !== albumId), albumId].slice(-12);
    saveRoom({ ...room, featuredAlbumIds });
  }

  function addToShelf(albumId: string, shelfId: string) {
    if (!shelfId) return;
    saveRoom({ ...room, shelves: room.shelves.map((shelf) => shelf.id === shelfId && shelf.kind === 'manual' ? { ...shelf, albumIds: [...new Set([...(shelf.albumIds || []), albumId])] } : shelf) });
  }

  function removeFromShelf(albumId: string, shelfId: string) {
    saveRoom({ ...room, shelves: room.shelves.map((shelf) => shelf.id === shelfId && shelf.kind === 'manual' ? { ...shelf, albumIds: (shelf.albumIds || []).filter((id) => id !== albumId) } : shelf) });
  }

  const activeShelf = room.shelves.find((shelf) => shelf.id === room.activeShelfId);
  const scopedAlbums = useMemo(() => filterShelf(albums, activeShelf), [albums, activeShelf]);
  const ordered = useMemo(() => sortAlbums(scopedAlbums, sort), [scopedAlbums, sort]);
  const groups = useMemo(() => groupAlbums(ordered, room.groupMode), [ordered, room.groupMode]);
  const manualShelves = room.shelves.filter((shelf) => shelf.kind === 'manual');
  const featured = useMemo(() => {
    const byId = new Map(albums.map((album) => [album.id, album]));
    return room.featuredAlbumIds.map((id) => byId.get(id)).filter((album): album is Album => Boolean(album));
  }, [albums, room.featuredAlbumIds]);
  const roomCollections = useMemo<RoomCollection[]>(() => [
    { id: '__all__', name: 'All records', albums },
    ...room.shelves.map((shelf) => ({ id: shelf.id, name: shelf.name, albums: filterShelf(albums, shelf) })),
  ], [albums, room.shelves]);
  const currentPlayingAlbum = playingAlbum === undefined ? mediaAlbum : playingAlbum;

  if (screen === 'room') return <section className="record-room-home">
    <div className="room-home-heading"><div><p className="eyebrow">YOUR RECORD ROOM</p><h1>Pick something to play.</h1><p>The shelves, bins and turntable are the interface. Click what you would reach for in the room.</p></div><div><button className="hero-random" onClick={onRandom}><Sparkles /> Pick a record for me</button><button className="hero-random room-manage-button" onClick={() => setRoomOpen(true)}><PanelTopOpen /> Arrange room</button></div></div>
    <RecordRoomScene room={room} collections={roomCollections} playingAlbum={currentPlayingAlbum} onOpenCollection={openRoomCollection} onOpenAlbum={onOpen} onOpenTurntable={openRoomTurntable} onArrange={() => setRoomOpen(true)} />
    {roomMessage && <div className="room-scene-toast" role="status">{roomMessage}</div>}
    <footer className="app-version room-home-version">NeedleDrop v{version}</footer>
    <RecordRoomPanel open={roomOpen} room={room} albums={albums} onClose={() => setRoomOpen(false)} onChange={saveRoom} />
  </section>;

  return <section className="library-page record-room-page room-collection-screen">
    <div className="room-collection-nav"><button className="back-to-room" onClick={() => { onSearch(''); setScreen('room'); }}><ArrowLeft /> Back to room</button><button className="room-manage-link" onClick={() => setRoomOpen(true)}><PanelTopOpen /> Arrange room</button></div>
    <div className="hero record-room-hero"><div><p className="eyebrow">RECORD COLLECTION</p><h1>{activeShelf?.name || 'All records'}</h1><p>{activeShelf ? `${scopedAlbums.length} records in this ${activeShelf.presentation === 'crate' ? 'crate' : 'shelf'}.` : `${scopedAlbums.length} records in the room.`}</p></div><button className="hero-random" onClick={onRandom}><Sparkles /> Pick a record for me</button></div>

    {!room.activeShelfId && !query.trim() && featured.length > 0 && <section className="featured-wall"><div className="featured-wall-heading"><div><p className="eyebrow">ON DISPLAY</p><h2>Featured records</h2></div><span>{featured.length} pinned</span></div><div className="featured-records">{featured.map((album) => <button key={album.id} className="featured-record" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 600)} alt={`${album.name} cover`} fill sizes="220px" unoptimized /><span><strong>{album.name}</strong><small>{album.artist}</small></span></button>)}</div></section>}

    <nav className="room-shelf-tabs" aria-label="Record Room shelves">
      <button className={!room.activeShelfId ? 'active' : ''} onClick={() => selectShelf()}><Warehouse /> All records <span>{albums.length}</span></button>
      {room.shelves.map((shelf) => <button key={shelf.id} className={room.activeShelfId === shelf.id ? 'active' : ''} onClick={() => selectShelf(shelf)}>{shelf.kind === 'smart' ? <Sparkles /> : shelf.presentation === 'crate' ? <Archive /> : <Library />} {shelf.name} <span>{filterShelf(albums, shelf).length}</span></button>)}
    </nav>

    <div className="library-tools collection-tools record-room-tools">
      <div className="searchbox"><Search size={18} /><input value={query} onChange={(event) => onSearch(event.target.value)} placeholder="Search this collection" /></div>
      <select value={sort} onChange={(event) => { const next = event.target.value as CollectionSort; saveRoom({ ...room, sort: next }); onSort(next); }} aria-label="Sort collection">
        <option value="artist">Artist / band A–Z</option><option value="album">Album title A–Z</option><option value="yearAsc">Chronological · oldest first</option><option value="yearDesc">Chronological · newest first</option><option value="rating">My rating · highest first</option><option value="newest">Recently added</option><option value="recent">Recently played</option><option value="frequent">Most played</option><option value="starred">Favourites</option>
      </select>
      <select value={room.groupMode} onChange={(event) => saveRoom({ ...room, groupMode: event.target.value as CollectionGroupMode })} aria-label="Group collection"><option value="none">No grouping</option><option value="artist">Group by artist / band</option><option value="decade">Group by decade</option><option value="year">Group by year</option></select>
      <div className="collection-view-toggle" role="group" aria-label="Collection view"><button className={room.viewMode === 'grid' ? 'active' : ''} onClick={() => saveRoom({ ...room, viewMode: 'grid' })} title="Cover grid"><Grid2X2 size={17} /></button><button className={room.viewMode === 'shelf' ? 'active' : ''} onClick={() => saveRoom({ ...room, viewMode: 'shelf' })} title="Spine shelf"><Library size={18} /></button><button className={room.viewMode === 'flip' ? 'active' : ''} onClick={() => saveRoom({ ...room, viewMode: 'flip' })} title="Flip bins"><Store size={18} /></button></div>
    </div>

    {groups.map((group) => <section className="collection-group" key={group.key}>{room.groupMode !== 'none' && <div className="collection-group-heading"><h2>{group.label}</h2><span>{group.albums.length} record{group.albums.length === 1 ? '' : 's'}</span></div>}<CollectionShelfView albums={group.albums} viewMode={room.viewMode} manualShelves={manualShelves} activeShelf={activeShelf} featuredIds={room.featuredAlbumIds} onOpen={onOpen} onQueue={onQueue} onFeature={toggleFeatured} onAddToShelf={addToShelf} onRemoveFromShelf={removeFromShelf} /></section>)}

    {!scopedAlbums.length && <div className="empty"><Library /><h2>{activeShelf ? 'This shelf is empty' : 'No records found'}</h2><p>{activeShelf?.kind === 'manual' ? 'Add records from the collection to start filling it.' : 'Try another search, shelf or rule.'}</p></div>}
    <footer className="app-version">NeedleDrop v{version}</footer>
    <RecordRoomPanel open={roomOpen} room={room} albums={albums} onClose={() => setRoomOpen(false)} onChange={saveRoom} />
  </section>;
}

function normalize(value = '') { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
