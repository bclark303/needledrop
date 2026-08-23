'use client';

import Image from 'next/image';
import { Disc3, Grid2X2, Library, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Album, RecordRoomConfig } from './types';
import { cover } from './vinyl';

export type RoomCollection = {
  id: string;
  name: string;
  albums: Album[];
};

export default function RecordRoomScene({
  room,
  collections,
  playingAlbum,
  onOpenCollection,
  onOpenAlbum,
  onOpenTurntable,
  onArrange,
}: {
  room: RecordRoomConfig;
  collections: RoomCollection[];
  playingAlbum: Album | null;
  onOpenCollection: (id: string) => void;
  onOpenAlbum: (id: string) => void;
  onOpenTurntable: () => void;
  onArrange: () => void;
}) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const slots = room.roomSlots.map((id) => byId.get(id)).slice(0, 4);

  return <section className="component-record-room" aria-label="Interactive Audiophile Listening Room">
    <nav className="record-room-primary-nav" aria-label="NeedleDrop room navigation">
      <button className="active" aria-current="page"><Library /> Room</button>
      <button onClick={() => onOpenCollection('__all__')}><Grid2X2 /> Collection</button>
      <button onClick={onOpenTurntable}><Disc3 /> Turntable</button>
    </nav>
    <div className="component-prototype-note">Audiophile Listening Room prototype · the room is built from live UI components rather than a background photograph.</div>

    <div className="component-room-stage">
      <div className="component-room-wall" aria-hidden="true" />
      <div className="component-room-floor" aria-hidden="true" />
      <div className="component-room-ceiling-light component-room-ceiling-light-left" aria-hidden="true" />
      <div className="component-room-ceiling-light component-room-ceiling-light-center" aria-hidden="true" />
      <div className="component-room-ceiling-light component-room-ceiling-light-right" aria-hidden="true" />

      <div className="component-room-acoustic-wall" aria-hidden="true">
        {Array.from({ length: 29 }).map((_, index) => <span key={index} />)}
      </div>

      <div className="component-room-left-built-in">
        <RecordLibrary collection={slots[0]} side="left" onOpen={onOpenCollection} />
      </div>
      <div className="component-room-right-built-in">
        <RecordLibrary collection={slots[1]} side="right" onOpen={onOpenCollection} />
      </div>

      <div className="component-room-console">
        <div className="component-room-console-top">
          <div className="component-room-lamp" aria-hidden="true"><span className="component-room-lamp-shade" /><span className="component-room-lamp-stem" /><span className="component-room-lamp-glow" /></div>

          <button className={`component-turntable ${playingAlbum ? 'is-loaded' : ''}`} onClick={onOpenTurntable} aria-label={playingAlbum ? `Open turntable playing ${playingAlbum.name}` : 'Open turntable'}>
            <span className="component-turntable-deck">
              <span className="component-turntable-platter">
                <span className="component-turntable-record">
                  <span className="component-turntable-label">{playingAlbum ? <Image src={cover(playingAlbum.coverArt, 160)} alt="" fill sizes="60px" unoptimized /> : <Disc3 />}</span>
                </span>
              </span>
              <span className="component-tonearm-base" />
              <span className={`component-tonearm ${playingAlbum ? 'is-playing' : ''}`} />
              <span className="component-turntable-switch" />
            </span>
            <span className="component-object-label"><Disc3 /><span><strong>Turntable</strong><small>{playingAlbum ? 'Open player' : 'Choose a record first'}</small></span></span>
          </button>

          <NowPlayingJacket album={playingAlbum} onOpen={onOpenAlbum} />
          <div className="component-room-plant" aria-hidden="true"><span /><span /><span /><span /><i /></div>
        </div>

        <div className="component-hifi-rack" aria-label="Hi-fi equipment rack">
          <HiFiUnit kind="streamer" />
          <HiFiUnit kind="amplifier" />
          <HiFiUnit kind="meters" active={Boolean(playingAlbum)} />
          <HiFiUnit kind="silver" />
          <HiFiUnit kind="black" />
          <HiFiUnit kind="silver" />
        </div>
      </div>

      <div className="component-room-low-cabinet">
        <LowCabinetCollection collection={slots[2]} onOpen={onOpenCollection} />
      </div>

      <div className="component-room-flip-crate">
        <FlipCrateCollection collection={slots[3]} onOpen={onOpenCollection} />
      </div>

      <div className="component-room-chair" aria-hidden="true"><span className="component-chair-back" /><span className="component-chair-seat" /><span className="component-chair-base" /></div>
      <div className="component-room-rug" aria-hidden="true" />

      <button className="component-room-arrange" onClick={onArrange}><SlidersHorizontal /> Arrange room</button>
    </div>

    <div className="component-room-legend">
      <span><Library /> Click a record library, cabinet or crate to open the mapped collection.</span>
      <span><Disc3 /> The turntable opens the player.</span>
      <span><Sparkles /> The jacket on the console is the album currently loaded.</span>
    </div>
  </section>;
}

function RecordLibrary({ collection, side, onOpen }: { collection?: RoomCollection; side: 'left' | 'right'; onOpen: (id: string) => void }) {
  const albums = collection?.albums || [];
  const rows = [albums.slice(0, 18), albums.slice(18, 36), albums.slice(36, 54), albums.slice(54, 72)];
  return <button className={`component-record-library ${side}`} onClick={() => collection && onOpen(collection.id)} disabled={!collection} aria-label={collection ? `Open ${collection.name}, ${collection.albums.length} records` : 'Unmapped record library'}>
    <span className="component-library-light" aria-hidden="true" />
    <span className="component-library-rows">
      {rows.map((row, rowIndex) => <span className="component-library-row" key={rowIndex}>{renderSpines(row, rowIndex * 18)}</span>)}
    </span>
    <span className="component-library-cabinet" aria-hidden="true"><i /><i /></span>
    <CollectionPlaque collection={collection} fallback={side === 'left' ? 'Left record library' : 'Right record library'} />
  </button>;
}

function LowCabinetCollection({ collection, onOpen }: { collection?: RoomCollection; onOpen: (id: string) => void }) {
  const albums = collection?.albums.slice(0, 26) || [];
  return <button className="component-low-cabinet-button" onClick={() => collection && onOpen(collection.id)} disabled={!collection} aria-label={collection ? `Open ${collection.name}, ${collection.albums.length} records` : 'Unmapped lower cabinet'}>
    <span className="component-low-cabinet-spines">{renderSpines(albums, 90)}</span>
    <CollectionPlaque collection={collection} fallback="Low record cabinet" />
  </button>;
}

function FlipCrateCollection({ collection, onOpen }: { collection?: RoomCollection; onOpen: (id: string) => void }) {
  const albums = collection?.albums.slice(0, 7) || [];
  return <button className="component-flip-crate-button" onClick={() => collection && onOpen(collection.id)} disabled={!collection} aria-label={collection ? `Open ${collection.name}, ${collection.albums.length} records` : 'Unmapped flip crate'}>
    <span className="component-crate-records">
      {albums.map((album, index) => <span className="component-crate-jacket" key={album.id} style={{ '--crate-index': index } as CSSProperties}><Image src={cover(album.coverArt, 300)} alt="" fill sizes="120px" unoptimized /></span>)}
      {!albums.length && Array.from({ length: 5 }).map((_, index) => <span className="component-crate-jacket component-crate-placeholder" key={index} style={{ '--crate-index': index } as CSSProperties} />)}
    </span>
    <span className="component-crate-front" aria-hidden="true" />
    <CollectionPlaque collection={collection} fallback="Flip crate" />
  </button>;
}

function NowPlayingJacket({ album, onOpen }: { album: Album | null; onOpen: (id: string) => void }) {
  if (!album) return <div className="component-now-playing empty" aria-label="No record loaded"><div className="component-jacket-placeholder"><Disc3 /><span>Choose a record</span></div><small>JACKET STAND</small></div>;
  return <button className="component-now-playing" onClick={() => onOpen(album.id)} aria-label={`Open ${album.name} by ${album.artist}`}>
    <span className="component-now-playing-cover"><Image src={cover(album.coverArt, 600)} alt={`${album.name} cover`} fill sizes="180px" unoptimized /></span>
    <span className="component-now-playing-copy"><small>NOW SPINNING</small><strong>{album.name}</strong><span>{album.artist}</span></span>
  </button>;
}

function CollectionPlaque({ collection, fallback }: { collection?: RoomCollection; fallback: string }) {
  return <span className="component-collection-plaque"><strong>{collection?.name || fallback}</strong><small>{collection ? `${collection.albums.length} record${collection.albums.length === 1 ? '' : 's'}` : 'Not mapped'}</small></span>;
}

function renderSpines(albums: Album[], offset: number) {
  if (!albums.length) return Array.from({ length: 15 }).map((_, index) => <span className="component-record-spine placeholder" key={`empty-${offset + index}`} style={spineStyle(undefined, offset + index)} />);
  return albums.map((album, index) => <span className="component-record-spine" key={album.id} title={`${album.artist} — ${album.name}`} style={spineStyle(album, offset + index)}><i>{spineText(album)}</i></span>);
}

function spineStyle(album: Album | undefined, index: number): CSSProperties {
  const seed = hash(`${album?.id || 'empty'}:${index}`);
  const hue = 18 + (seed % 42);
  const saturation = 12 + (seed % 24);
  const lightness = album ? 25 + (seed % 34) : 16 + (seed % 9);
  const width = 5 + (seed % 8);
  return {
    '--spine-h': hue,
    '--spine-s': `${saturation}%`,
    '--spine-l': `${lightness}%`,
    '--spine-w': `${width}px`,
  } as CSSProperties;
}

function spineText(album: Album) {
  const text = album.artist || album.name;
  return text.length > 18 ? text.slice(0, 16) : text;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result >>> 0);
}

function HiFiUnit({ kind, active = false }: { kind: 'streamer' | 'amplifier' | 'meters' | 'silver' | 'black'; active?: boolean }) {
  return <div className={`component-hifi-unit ${kind} ${active ? 'active' : ''}`} aria-hidden="true">
    <span className="component-hifi-display" />
    <span className="component-hifi-knob left" />
    <span className="component-hifi-knob right" />
    {kind === 'meters' && <span className="component-vu-pair"><i /><i /></span>}
    {kind === 'amplifier' && <span className="component-hifi-buttons"><i /><i /><i /><i /><i /></span>}
  </div>;
}
