'use client';

import Image from 'next/image';
import { Archive, Layers3, Sparkles } from 'lucide-react';
import type { Album, CollectionGroupMode, CollectionSort, CollectionViewMode, RecordRoomShelf } from './types';
import { cover } from './vinyl';

export default function CollectionShelfView({ albums, viewMode, manualShelves, activeShelf, featuredIds, onOpen, onQueue, onFeature, onAddToShelf, onRemoveFromShelf }: {
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
  return <article className="shelf-record"><button className="shelf-spine" onClick={() => onOpen(album.id)} title={`${album.artist} — ${album.name}`}><span>{album.name}</span><small>{album.artist}</small></button><div className="shelf-pullout"><button className="shelf-cover" onClick={() => onOpen(album.id)}><Image src={cover(album.coverArt, 500)} alt={`${album.name} cover`} fill sizes="220px" loading="lazy" unoptimized /><span className="shelf-cover-caption"><strong>{album.name}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small></span></button><div className="shelf-pullout-actions">{actions}</div></div></article>;
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

export function filterShelf(albums: Album[], shelf?: RecordRoomShelf) {
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

export function sortAlbums(albums: Album[], sort: CollectionSort) {
  const list = [...albums];
  if (sort === 'artist') return list.sort((a, b) => compare(a.artist, b.artist) || compare(a.name, b.name) || number(a.year) - number(b.year));
  if (sort === 'album') return list.sort((a, b) => compare(a.name, b.name) || compare(a.artist, b.artist));
  if (sort === 'yearAsc') return list.sort((a, b) => yearValue(a.year, 9999) - yearValue(b.year, 9999) || compare(a.artist, b.artist) || compare(a.name, b.name));
  if (sort === 'yearDesc') return list.sort((a, b) => yearValue(b.year, 0) - yearValue(a.year, 0) || compare(a.artist, b.artist) || compare(a.name, b.name));
  if (sort === 'rating') return list.sort((a, b) => number(b.rating) - number(a.rating) || compare(a.artist, b.artist) || compare(a.name, b.name));
  return list;
}

export function groupAlbums(albums: Album[], mode: CollectionGroupMode) {
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
