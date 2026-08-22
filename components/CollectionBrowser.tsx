'use client';

import Image from 'next/image';
import { Grid2X2, Layers3, Library, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Album } from './types';
import { cover } from './vinyl';

export type CollectionSort = 'artist' | 'album' | 'yearAsc' | 'yearDesc' | 'rating' | 'newest' | 'recent' | 'frequent' | 'starred';
type CollectionViewMode = 'grid' | 'shelf';
type GroupMode = 'none' | 'artist' | 'decade' | 'year';

const VIEW_KEY = 'needledrop.collectionView.v1';
const GROUP_KEY = 'needledrop.collectionGroup.v1';

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
  const [viewMode, setViewMode] = useState<CollectionViewMode>('grid');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');

  useEffect(() => {
    try {
      const view = localStorage.getItem(VIEW_KEY);
      const group = localStorage.getItem(GROUP_KEY);
      if (view === 'grid' || view === 'shelf') setViewMode(view);
      if (group === 'none' || group === 'artist' || group === 'decade' || group === 'year') setGroupMode(group);
    } catch {}
  }, []);

  function changeView(value: CollectionViewMode) {
    setViewMode(value);
    try { localStorage.setItem(VIEW_KEY, value); } catch {}
  }

  function changeGroup(value: GroupMode) {
    setGroupMode(value);
    try { localStorage.setItem(GROUP_KEY, value); } catch {}
  }

  const ordered = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const groups = useMemo(() => groupAlbums(ordered, groupMode), [ordered, groupMode]);

  return <section className="library-page">
    <div className="hero"><div><p className="eyebrow">YOUR RECORD ROOM</p><h1>What are we spinning?</h1><p>Browse covers or work the shelf spine-by-spine.</p></div><button className="hero-random" onClick={onRandom}><Sparkles /> Pick a record for me</button></div>

    <div className="library-tools collection-tools">
      <div className="searchbox"><Search size={18} /><input value={query} onChange={(event) => onSearch(event.target.value)} placeholder="Search the collection" /></div>
      <select value={sort} onChange={(event) => onSort(event.target.value as CollectionSort)} aria-label="Sort collection">
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
      <select value={groupMode} onChange={(event) => changeGroup(event.target.value as GroupMode)} aria-label="Group collection">
        <option value="none">No grouping</option>
        <option value="artist">Group by artist / band</option>
        <option value="decade">Group by decade</option>
        <option value="year">Group by year</option>
      </select>
      <div className="collection-view-toggle" role="group" aria-label="Collection view">
        <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => changeView('grid')} title="Cover grid"><Grid2X2 size={17} /></button>
        <button className={viewMode === 'shelf' ? 'active' : ''} onClick={() => changeView('shelf')} title="Record shelf"><Library size={18} /></button>
      </div>
    </div>

    {groups.map((group) => <section className="collection-group" key={group.key}>
      {groupMode !== 'none' && <div className="collection-group-heading"><h2>{group.label}</h2><span>{group.albums.length} record{group.albums.length === 1 ? '' : 's'}</span></div>}
      {viewMode === 'grid'
        ? <div className="record-grid">{group.albums.map((album) => <GridRecord key={album.id} album={album} onOpen={onOpen} onQueue={onQueue} />)}</div>
        : <div className="vinyl-shelf"><div className="vinyl-shelf-row">{group.albums.map((album) => <ShelfRecord key={album.id} album={album} onOpen={onOpen} onQueue={onQueue} />)}</div><div className="shelf-board" /></div>}
    </section>)}

    {!albums.length && <div className="empty"><Library /><h2>No records found</h2><p>Try another search or view.</p></div>}
    <footer className="app-version">NeedleDrop v{version}</footer>
  </section>;
}

function GridRecord({ album, onOpen, onQueue }: { album: Album; onOpen: (id: string) => void; onQueue: (album: Album) => void }) {
  return <article className="record-card"><button className="record-open" onClick={() => onOpen(album.id)}><div className="jacket"><Image src={cover(album.coverArt)} alt={`${album.name} cover`} fill sizes="(max-width:700px) 45vw, 220px" loading="lazy" unoptimized /><div className="vinyl-peek"><span /></div></div><div className="record-caption"><strong>{album.name}</strong><span>{album.artist}{album.year ? ` · ${album.year}` : ''}{album.rating ? ` · ${'★'.repeat(album.rating)}` : ''}</span></div></button><button className="record-queue" onClick={() => onQueue(album)} title="Add to record changer"><Layers3 size={15} /> Queue</button></article>;
}

function ShelfRecord({ album, onOpen, onQueue }: { album: Album; onOpen: (id: string) => void; onQueue: (album: Album) => void }) {
  return <article className="shelf-record">
    <button className="shelf-spine" onClick={() => onOpen(album.id)} title={`${album.artist} — ${album.name}`}>
      <span>{album.name}</span><small>{album.artist}</small>
    </button>
    <div className="shelf-pullout">
      <button className="shelf-cover" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 500)} alt={`${album.name} cover`} fill sizes="220px" loading="lazy" unoptimized /><span className="shelf-cover-caption"><strong>{album.name}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small></span></button>
      <button className="shelf-queue" onClick={() => onQueue(album)}><Layers3 size={14} /> Queue</button>
    </div>
  </article>;
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

function groupAlbums(albums: Album[], mode: GroupMode) {
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
