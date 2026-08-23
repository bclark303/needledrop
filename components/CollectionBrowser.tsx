'use client';

import Image from 'next/image';
import { Archive, Grid2X2, Layers3, Library, PanelTopOpen, Search, Sparkles, Store, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  Album,
  CollectionGroupMode,
  CollectionSort,
  CollectionViewMode,
  RecordRoomConfig,
  RecordRoomShelf,
} from './types';
import RecordRoomPanel from './RecordRoomPanel';
import { cover } from './vinyl';

export type { CollectionSort } from './types';

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
};

export default function CollectionBrowser({
  albums,
  query,
  sort,
  version,
  onSearch,
  onSort,
  onOpen,
  onQueue,
  onRandom,
}: {
  albums: Album[];
  query: string;
  sort: CollectionSort;
  version: string;
  onSearch: (value: string) => void;
  onSort: (sort: CollectionSort) => void;
  onOpen: (id: string) => void;
  onQueue: (album: Album) => void;
  onRandom: () => void;
}) {
  const [room, setRoom] = useState<RecordRoomConfig>(DEFAULT_ROOM);
  const [roomOpen, setRoomOpen] = useState(false);

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

  function saveRoom(next: RecordRoomConfig) {
    setRoom(next);
    void fetch('/api/record-room', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }

  function changeSort(next: CollectionSort) {
    saveRoom({ ...room, sort: next });
    onSort(next);
  }

  function changeView(viewMode: CollectionViewMode) {
    saveRoom({ ...room, viewMode });
  }

  function changeGroup(groupMode: CollectionGroupMode) {
    saveRoom({ ...room, groupMode });
  }

  function selectShelf(shelf?: RecordRoomShelf) {
    saveRoom({
      ...room,
      activeShelfId: shelf?.id,
      viewMode: shelf ? (shelf.presentation === 'crate' ? 'flip' : 'shelf') : room.viewMode,
    });
  }

  function toggleFeatured(albumId: string) {
    const active = room.featuredAlbumIds.includes(albumId);
    const featuredAlbumIds = active
      ? room.featuredAlbumIds.filter((id) => id !== albumId)
      : [...room.featuredAlbumIds.filter((id) => id !== albumId), albumId].slice(-12);
    saveRoom({ ...room, featuredAlbumIds });
  }

  function addToShelf(albumId: string, shelfId: string) {
    if (!shelfId) return;
    const shelves = room.shelves.map((shelf) => shelf.id === shelfId && shelf.kind === 'manual'
      ? { ...shelf, albumIds: [...new Set([...(shelf.albumIds || []), albumId])] }
      : shelf);
    saveRoom({ ...room, shelves });
  }

  function removeFromShelf(albumId: string, shelfId: string) {
    const shelves = room.shelves.map((shelf) => shelf.id === shelfId && shelf.kind === 'manual'
      ? { ...shelf, albumIds: (shelf.albumIds || []).filter((id) => id !== albumId) }
      : shelf);
    saveRoom({ ...room, shelves });
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

  return <section className="library-page record-room-page">
    <div className="hero record-room-hero"><div><p className="eyebrow">YOUR RECORD ROOM</p><h1>{activeShelf?.name || 'What are we spinning?'}</h1><p>{activeShelf ? `${scopedAlbums.length} records in this ${activeShelf.presentation === 'crate' ? 'crate' : 'shelf'}.` : 'Browse the wall, work the shelf spine-by-spine, or flip through a crate.'}</p></div><div className="record-room-hero-actions"><button className="hero-random" onClick={onRandom}><Sparkles /> Pick a record for me</button><button className="hero-random room-manage-button" onClick={() => setRoomOpen(true)}><PanelTopOpen /> Arrange room</button></div></div>

    {!room.activeShelfId && !query.trim() && featured.length > 0 && <section className="featured-wall">
      <div className="featured-wall-heading"><div><p className="eyebrow">ON DISPLAY</p><h2>Featured records</h2></div><span>{featured.length} pinned</span></div>
      <div className="featured-records">{featured.map((album) => <button key={album.id} className="featured-record" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 600)} alt={`${album.name} cover`} fill sizes="220px" unoptimized /><span><strong>{album.name}</strong><small>{album.artist}</small></span></button>)}</div>
    </section>}

    <nav className="room-shelf-tabs" aria-label="Record Room shelves">
      <button className={!room.activeShelfId ? 'active' : ''} onClick={() => selectShelf()}><Warehouse /> All records <span>{albums.length}</span></button>
      {room.shelves.map((shelf) => <button key={shelf.id} className={room.activeShelfId === shelf.id ? 'active' : ''} onClick={() => selectShelf(shelf)}>{shelf.kind === 'smart' ? <Sparkles /> : shelf.presentation === 'crate' ? <Archive /> : <Library />} {shelf.name} <span>{filterShelf(albums, shelf).length}</span></button>)}
    </nav>

    <div className="library-tools collection-tools record-room-tools">
      <div className="searchbox"><Search size={18} /><input value={query} onChange={(event) => onSearch(event.target.value)} placeholder="Search the collection" /></div>
      <select value={sort} onChange={(event) => changeSort(event.target.value as CollectionSort)} aria-label="Sort collection">
        <option value="artist">Artist / band A–Z</option>
        <option value="album">Album title A–Z</option>
        <option value="yearAsc">Chronological · oldest first</option>
        <option value="yearDesc">Chronological · newest first</option>
        <option value="rating">My rating · highest first</option>
        <option value="newest">Recently added</option>
        <option value="recent">Recently played</option>
        <option value="frequent">Most played</option>
        <option value="starred">Favourites</option>
      </select>
      <select value={room.groupMode} onChange={(event) => changeGroup(event.target.value as CollectionGroupMode)} aria-label="Group collection">
        <option value="none">No grouping</option>
        <option value="artist">Group by artist / band</option>
        <option value="decade">Group by decade</option>
        <option value="year">Group by year</option>
      </select>
      <div className="collection-view-toggle" role="group" aria-label="Collection view">
        <button className={room.viewMode === 'grid' ? 'active' : ''} onClick={() => changeView('grid')} title="Cover grid"><Grid2X2 size={17} /></button>
        <button className={room.viewMode === 'shelf' ? 'active' : ''} onClick={() => changeView('shelf')} title="Spine shelf"><Library size={18} /></button>
        <button className={room.viewMode === 'flip' ? 'active' : ''} onClick={() => changeView('flip')} title="Flip bins"><Store size={18} /></button>
      </div>
    </div>

    {groups.map((group) => <section className="collection-group" key={group.key}>
      {room.groupMode !== 'none' && <div className="collection-group-heading"><h2>{group.label}</h2><span>{group.albums.length} record{group.albums.length === 1 ? '' : 's'}</span></div>}
      <CollectionView albums={group.albums} viewMode={room.viewMode} manualShelves={manualShelves} activeShelf={activeShelf} featuredIds={room.featuredAlbumIds} onOpen={onOpen} onQueue={onQueue} onFeature={toggleFeatured} onAddToShelf={addToShelf} onRemoveFromShelf={removeFromShelf} />
    </section>)}

    {!scopedAlbums.length && <div className="empty"><Library /><h2>{activeShelf ? 'This shelf is empty' : 'No records found'}</h2><p>{activeShelf?.kind === 'manual' ? 'Add records from the collection to start filling it.' : 'Try another search, shelf or rule.'}</p></div>}
    <footer className="app-version">NeedleDrop v{version}</footer>
    <RecordRoomPanel open={roomOpen} room={room} albums={albums} onClose={() => setRoomOpen(false)} onChange={saveRoom} />
  </section>;
}

function CollectionView({ albums, viewMode, manualShelves, activeShelf, featuredIds, onOpen, onQueue, onFeature, onAddToShelf, onRemoveFromShelf }: {
  albums: Album[];
  viewMode: CollectionViewMode;
  manualShelves: RecordRoomShelf[];
  activeShelf?: RecordRoomShelf;
  featuredIds: string[];
  onOpen: (id: string) => void;
  onQueue: (album: Album) => void;
  onFeature: (id: string) => void;
  onAddToShelf: (albumId: string, shelfId: string) => void;
  onRemoveFromShelf: (albumId: string, shelfId: string) => void;
}) {
  const actions = (album: Album) => <RecordActions album={album} manualShelves={manualShelves} activeShelf={activeShelf} featured={featuredIds.includes(album.id)} onQueue={onQueue} onFeature={onFeature} onAddToShelf={onAddToShelf} onRemoveFromShelf={onRemoveFromShelf} />;
  if (viewMode === 'shelf') return <div className="vinyl-shelf room-vinyl-shelf"><div className="vinyl-shelf-row">{albums.map((album) => <ShelfRecord key={album.id} album={album} onOpen={onOpen} actions={actions(album)} />)}</div><div className="shelf-board" /></div>;
  if (viewMode === 'flip') return <div className="flip-bin"><div className="flip-bin-back" /><div className="flip-bin-row">{albums.map((album) => <FlipRecord key={album.id} album={album} onOpen={onOpen} actions={actions(album)} />)}</div><div className="flip-bin-front"><span>NEEDLEDROP · RECORD BIN</span></div></div>;
  return <div className="record-grid">{albums.map((album) => <GridRecord key={album.id} album={album} onOpen={onOpen} actions={actions(album)} />)}</div>;
}

function GridRecord({ album, onOpen, actions }: { album: Album; onOpen: (id: string) => void; actions: React.ReactNode }) {
  return <article className="record-card room-record-card"><button className="record-open" onClick={() => onOpen(album.id)}><div className="jacket"><Image src={cover(album.coverArt)} alt={`${album.name} cover`} fill sizes="(max-width:700px) 45vw, 220px" loading="lazy" unoptimized /><div className="vinyl-peek"><span /></div></div><div className="record-caption"><strong>{album.name}</strong><span>{album.artist}{album.year ? ` · ${album.year}` : ''}{album.rating ? ` · ${'★'.repeat(album.rating)}` : ''}</span></div></button>{actions}</article>;
}

function ShelfRecord({ album, onOpen, actions }: { album: Album; onOpen: (id: string) => void; actions: React.ReactNode }) {
  return <article className="shelf-record">
    <button className="shelf-spine" onClick={() => onOpen(album.id)} title={`${album.artist} — ${album.name}`}><span>{album.name}</span><small>{album.artist}</small></button>
    <div className="shelf-pullout"><button className="shelf-cover" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 500)} alt={`${album.name} cover`} fill sizes="220px" loading="lazy" unoptimized /><span className="shelf-cover-caption"><strong>{album.name}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small></span></button><div className="shelf-pullout-actions">{actions}</div></div>
  </article>;
}

function FlipRecord({ album, onOpen, actions }: { album: Album; onOpen: (id: string) => void; actions: React.ReactNode }) {
  return <article className="flip-record"><button className="flip-record-cover" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 600)} alt={`${album.name} cover`} fill sizes="240px" loading="lazy" unoptimized /><span><strong>{album.name}</strong><small>{album.artist}</small></span></button><div className="flip-record-actions">{actions}</div></article>;
}

function RecordActions({ album, manualShelves, activeShelf, featured, onQueue, onFeature, onAddToShelf, onRemoveFromShelf }: {
  album: Album;
  manualShelves: RecordRoomShelf[];
  activeShelf?: RecordRoomShelf;
  featured: boolean;
  onQueue: (album: Album) => void;
  onFeature: (id: string) => void;
  onAddToShelf: (albumId: string, shelfId: string) => void;
  onRemoveFromShelf: (albumId: string, shelfId: string) => void;
}) {
  const removable = activeShelf?.kind === 'manual' && activeShelf.albumIds?.includes(album.id);
  return <div className="room-record-actions">
    <button onClick={() => onQueue(album)} title="Add to record changer"><Layers3 /> <span>Queue</span></button>
    <button className={featured ? 'active' : ''} onClick={() => onFeature(album.id)} title={featured ? 'Remove from featured records' : 'Feature this record'}><Sparkles /> <span>{featured ? 'Featured' : 'Feature'}</span></button>
    {manualShelves.length > 0 && <select value="" aria-label={`Add ${album.name} to shelf`} onChange={(event) => onAddToShelf(album.id, event.target.value)}><option value="">+ Shelf</option>{manualShelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select>}
    {removable && <button className="remove-from-shelf" onClick={() => onRemoveFromShelf(album.id, activeShelf.id)} title={`Remove from ${activeShelf.name}`}><Archive /> <span>Remove</span></button>}
  </div>;
}

function filterShelf(albums: Album[], shelf?: RecordRoomShelf) {
  if (!shelf) return albums;
  if (shelf.kind === 'manual') {
    const ids = new Set(shelf.albumIds || []);
    return albums.filter((album) => ids.has(album.id));
  }
  const rule = shelf.rule;
  if (!rule) return albums;
  if (rule.type === 'starred') return albums.filter((album) => Boolean(album.starred));
  if (rule.type === 'rating') return albums.filter((album) => number(album.rating) >= rule.minimum);
  if (rule.type === 'decade') return albums.filter((album) => album.year != null && Math.floor(album.year / 10) * 10 === rule.decade);
  if (rule.type === 'genre') {
    const wanted = rule.value.toLocaleLowerCase();
    return albums.filter((album) => (album.genre || '').toLocaleLowerCase().split(/[;,/]/).some((genre) => genre.trim() === wanted));
  }
  const cutoff = Date.now() - rule.days * 24 * 60 * 60 * 1000;
  return albums.filter((album) => album.created ? new Date(album.created).getTime() >= cutoff : false);
}

function sortAlbums(albums: Album[], sort: CollectionSort) {
  const list = [...albums];
  if (sort === 'artist') return list.sort((a, b) => compare(a.artist, b.artist) || compare(a.name, b.name) || number(a.year) - number(b.year));
  if (sort === 'album') return list.sort((a, b) => compare(a.name, b.name) || compare(a.artist, b.artist));
  if (sort === 'yearAsc') return list.sort((a, b) => yearValue(a.year, 9999) - yearValue(b.year, 9999) || compare(a.artist, b.artist) || compare(a.name, b.name));
  if (sort === 'yearDesc') return list.sort((a, b) => yearValue(b.year, 0) - yearValue(a.year, 0) || compare(a.artist, b.artist) || compare(a.name, b.name));
  if (sort === 'rating') return list.sort((a, b) => number(b.rating) - number(a.rating) || compare(a.artist, b.artist) || compare(a.name, b.name));
  return list;
}

function groupAlbums(albums: Album[], mode: CollectionGroupMode) {
  if (mode === 'none') return [{ key: 'all', label: 'All records', albums }];
  const groups = new Map<string, Album[]>();
  for (const album of albums) {
    let key = '';
    if (mode === 'artist') key = album.artist || 'Unknown artist';
    else if (mode === 'year') key = album.year ? String(album.year) : 'Unknown year';
    else key = album.year ? `${Math.floor(album.year / 10) * 10}s` : 'Unknown decade';
    const current = groups.get(key) || [];
    current.push(album);
    groups.set(key, current);
  }
  const entries = [...groups.entries()];
  if (mode === 'artist') entries.sort((a, b) => compare(a[0], b[0]));
  else entries.sort((a, b) => numericLabel(a[0]) - numericLabel(b[0]));
  return entries.map(([label, grouped]) => ({ key: `${mode}:${label}`, label, albums: grouped }));
}

function compare(a = '', b = '') { return a.localeCompare(b, undefined, { sensitivity: 'base' }); }
function number(value?: number) { return Number.isFinite(value) ? Number(value) : 0; }
function yearValue(value: number | undefined, fallback: number) { return Number.isFinite(value) ? Number(value) : fallback; }
function numericLabel(value: string) { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : 99999; }
