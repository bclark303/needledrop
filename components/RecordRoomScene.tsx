'use client';

import Image from 'next/image';
import { Disc3, Library, Play, Sparkles } from 'lucide-react';
import type { Album, RecordRoomConfig, RecordRoomTheme } from './types';
import { cover } from './vinyl';

export type RoomCollection = {
  id: string;
  name: string;
  albums: Album[];
};

type Box = { left: number; top: number; width: number; height: number };
type SceneLayout = {
  image: string;
  turntable: Box;
  jacket: Box;
  collections: Box[];
};

const LAYOUTS: Record<RecordRoomTheme, SceneLayout> = {
  audiophile: {
    image: '/record-room/audiophile-room.webp',
    turntable: { left: 43, top: 39, width: 17, height: 17 },
    jacket: { left: 37.5, top: 40, width: 8.5, height: 15 },
    collections: [
      { left: 8, top: 13, width: 24, height: 45 },
      { left: 70, top: 13, width: 24, height: 45 },
      { left: 32, top: 56, width: 37, height: 25 },
      { left: 4, top: 58, width: 27, height: 18 },
    ],
  },
  'record-store': {
    image: '/record-room/record-store-room.webp',
    turntable: { left: 47, top: 43, width: 18, height: 16 },
    jacket: { left: 63, top: 41, width: 8, height: 15 },
    collections: [
      { left: 0, top: 5, width: 35, height: 48 },
      { left: 2, top: 54, width: 43, height: 35 },
      { left: 73, top: 4, width: 27, height: 53 },
      { left: 45, top: 55, width: 26, height: 22 },
    ],
  },
  'teen-bedroom': {
    image: '/record-room/teen-bedroom-room.webp',
    turntable: { left: 42, top: 43, width: 20, height: 17 },
    jacket: { left: 62, top: 43, width: 9, height: 16 },
    collections: [
      { left: 36, top: 57, width: 36, height: 25 },
      { left: 55, top: 49, width: 19, height: 13 },
      { left: 35, top: 79, width: 38, height: 15 },
      { left: 73, top: 61, width: 20, height: 20 },
    ],
  },
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
  const layout = LAYOUTS[room.theme];
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const slots = room.roomSlots.map((id) => byId.get(id)).slice(0, 4);

  return <section className={`interactive-record-room theme-${room.theme}`} aria-label="Interactive Record Room">
    <div className="record-room-scene-frame">
      <Image className="record-room-scene-photo" src={layout.image} alt="" fill priority sizes="(max-width:900px) 100vw, 1400px" />
      <div className="record-room-scene-vignette" />

      {slots.map((collection, index) => {
        if (!collection) return null;
        const box = layout.collections[index];
        const sample = collection.albums.slice(0, 4);
        return <button
          key={`${index}:${collection.id}`}
          className={`room-scene-hotspot room-collection-hotspot room-slot-${index + 1}`}
          style={boxStyle(box)}
          onClick={() => onOpenCollection(collection.id)}
          aria-label={`Open ${collection.name}, ${collection.albums.length} records`}
        >
          <span className="room-hotspot-covers" aria-hidden="true">
            {sample.map((album, coverIndex) => <span className="room-hotspot-cover" key={album.id} style={{ zIndex: sample.length - coverIndex, transform: `translateX(${coverIndex * 16}px) rotate(${coverIndex * 1.5 - 2}deg)` }}><Image src={cover(album.coverArt, 160)} alt="" fill sizes="72px" unoptimized /></span>)}
          </span>
          <span className="room-hotspot-label"><Library /><span><strong>{collection.name}</strong><small>{collection.albums.length} record{collection.albums.length === 1 ? '' : 's'} · open collection</small></span></span>
        </button>;
      })}

      <button className={`room-scene-hotspot room-turntable-hotspot ${playingAlbum ? 'loaded' : ''}`} style={boxStyle(layout.turntable)} onClick={onOpenTurntable} aria-label={playingAlbum ? `Open turntable playing ${playingAlbum.name}` : 'Open turntable'}>
        <span className="turntable-hotspot-ring"><Disc3 /></span>
        <span className="room-hotspot-label turntable-label"><Play /><span><strong>Turntable</strong><small>{playingAlbum ? 'open player' : 'choose a record first'}</small></span></span>
      </button>

      {playingAlbum && <button className="room-current-jacket" style={boxStyle(layout.jacket)} onClick={() => onOpenAlbum(playingAlbum.id)} aria-label={`Open currently playing album ${playingAlbum.name} by ${playingAlbum.artist}`}>
        <Image src={cover(playingAlbum.coverArt, 500)} alt={`${playingAlbum.name} cover`} fill sizes="150px" unoptimized />
        <span className="room-current-jacket-badge"><span>NOW SPINNING</span><strong>{playingAlbum.name}</strong><small>{playingAlbum.artist}</small></span>
      </button>}

      <button className="room-scene-arrange" onClick={onArrange}><Sparkles /> Arrange room</button>
    </div>
    <div className="room-scene-instructions"><span>Click the turntable to open the player.</span><span>Click any highlighted record shelf or bin to open that collection.</span>{playingAlbum && <span>The jacket beside the turntable is the record currently playing.</span>}</div>
  </section>;
}

function boxStyle(box: Box) {
  return { left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` };
}
