'use client';

import Image from 'next/image';
import { Disc3, Grid2X2, Library, RotateCcw, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Album, HiFiSettings, RecordRoomConfig, RecordRoomTheme } from './types';
import { cover } from './vinyl';
import { applyHiFiSettings, DEFAULT_HIFI_SETTINGS, readHiFiSettings } from '@/lib/client-hifi';

export type RoomCollection = {
  id: string;
  name: string;
  albums: Album[];
};

const ROOM_DETAILS: Record<RecordRoomTheme, { name: string; description: string }> = {
  audiophile: {
    name: 'Audiophile Listening Room',
    description: 'Acoustic treatment, fitted libraries and reference hi-fi.',
  },
  'teen-bedroom': {
    name: 'Bedroom Listening Nook',
    description: 'Posters, string lights, compact furniture and records within reach.',
  },
  'record-store': {
    name: 'Record Collector Room',
    description: 'Display jackets, timber browsing bins and a dedicated listening counter.',
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
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const slots = room.roomSlots.map((id) => byId.get(id)).slice(0, 4);
  const roomDetails = ROOM_DETAILS[room.theme];
  const displayAlbums = [...new Map(slots.flatMap((slot) => slot?.albums || []).map((album) => [album.id, album])).values()].slice(0, 4);
  const [hifi, setHiFi] = useState<HiFiSettings>(DEFAULT_HIFI_SETTINGS);
  const [hifiOpen, setHiFiOpen] = useState(false);

  useEffect(() => {
    const saved = readHiFiSettings();
    setHiFi(saved);
    applyHiFiSettings(saved, false);
  }, []);

  function changeHiFi<K extends keyof HiFiSettings>(key: K, value: HiFiSettings[K]) {
    const next = { ...hifi, [key]: value };
    setHiFi(next);
    applyHiFiSettings(next, key !== 'volume');
  }

  function resetHiFi() {
    const next = { ...DEFAULT_HIFI_SETTINGS };
    setHiFi(next);
    applyHiFiSettings(next, true);
  }

  return <section className={`component-record-room component-record-room-${room.theme}`} aria-label={`Interactive ${roomDetails.name}`}>
    <nav className="record-room-primary-nav" aria-label="NeedleDrop room navigation">
      <button className="active" aria-current="page"><Library /> Room</button>
      <button onClick={() => onOpenCollection('__all__')}><Grid2X2 /> Collection</button>
      <button onClick={onOpenTurntable}><Disc3 /> Turntable</button>
    </nav>
    <div className="component-room-note"><strong>{roomDetails.name}</strong><span>{roomDetails.description}</span></div>

    <div className="component-room-stage">
      <div className="component-room-wall" aria-hidden="true" />
      <div className="component-room-floor" aria-hidden="true" />
      <ThemeDecor theme={room.theme} albums={displayAlbums} />
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
          <HiFiControlUnit settings={hifi} open={hifiOpen} onToggle={() => setHiFiOpen((value) => !value)} onChange={changeHiFi} onReset={resetHiFi} />
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
      <span><Library /> Click record furniture to open its mapped collection.</span>
      <span><Disc3 /> Click the turntable for the player.</span>
      <span><Volume2 /> Click the amplifier for volume, balance and EQ.</span>
    </div>
  </section>;
}

function ThemeDecor({ theme, albums }: { theme: RecordRoomTheme; albums: Album[] }) {
  if (theme === 'teen-bedroom') {
    return <div className="bedroom-room-decor" aria-hidden="true">
      <span className="bedroom-window"><i /><i /><i /><i /></span>
      <span className="bedroom-string-lights">{Array.from({ length: 14 }).map((_, index) => <i key={index} />)}</span>
      <span className="bedroom-posters"><i>LIVE</i><i>STEREO</i><i>PLAY LOUD</i></span>
      <span className="bedroom-bed"><i /><b /></span>
      <span className="bedroom-floor-speaker left" /><span className="bedroom-floor-speaker right" />
    </div>;
  }

  if (theme === 'record-store') {
    return <div className="record-store-decor" aria-hidden="true">
      <span className="record-store-sign"><strong>NEEDLEDROP</strong><small>RECORDS · HI-FI · LISTENING ROOM</small></span>
      <span className="record-store-pendants"><i /><i /><i /></span>
      <span className="record-store-display-wall">
        {albums.map((album) => <i key={album.id}><Image src={cover(album.coverArt, 300)} alt="" fill sizes="90px" unoptimized /></i>)}
        {Array.from({ length: Math.max(0, 4 - albums.length) }).map((_, index) => <i className="empty" key={`empty-${index}`}><Disc3 /></i>)}
      </span>
      <span className="record-store-counter-mark">LISTENING BAR</span>
      <span className="record-store-bin-row"><i /><i /><i /></span>
    </div>;
  }

  return null;
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

function HiFiControlUnit({ settings, open, onToggle, onChange, onReset }: {
  settings: HiFiSettings;
  open: boolean;
  onToggle: () => void;
  onChange: <K extends keyof HiFiSettings>(key: K, value: HiFiSettings[K]) => void;
  onReset: () => void;
}) {
  return <div className="component-hifi-control-unit">
    <button className={`component-hifi-unit amplifier interactive ${open ? 'control-open' : ''}`} onClick={onToggle} aria-expanded={open} aria-label="Integrated amplifier controls">
      <span className="component-hifi-display"><b>{Math.round(settings.volume * 100)}</b></span>
      <span className="component-hifi-knob left" style={{ '--knob-turn': `${-132 + settings.volume * 264}deg` } as CSSProperties} />
      <span className="component-hifi-knob right" style={{ '--knob-turn': `${settings.balance * 110}deg` } as CSSProperties} />
      <span className="component-hifi-buttons"><i /><i /><i /><i /><i /></span>
    </button>
    {open && <div className="component-hifi-control-panel" onClick={(event) => event.stopPropagation()}>
      <div className="component-hifi-control-heading"><div><strong>Integrated amplifier</strong><small>Live playback controls</small></div><button onClick={onReset} title="Reset hi-fi controls"><RotateCcw /></button></div>
      <HiFiSlider label="Volume" value={Math.round(settings.volume * 100)} min={0} max={100} suffix="%" onChange={(value) => onChange('volume', value / 100)} />
      <HiFiSlider label="Balance" value={Math.round(settings.balance * 100)} min={-100} max={100} suffix={settings.balance === 0 ? ' C' : settings.balance < 0 ? ' L' : ' R'} onChange={(value) => onChange('balance', value / 100)} />
      <HiFiSlider label="Bass" value={settings.bass} min={-12} max={12} suffix=" dB" onChange={(value) => onChange('bass', value)} />
      <HiFiSlider label="Mid" value={settings.mid} min={-12} max={12} suffix=" dB" onChange={(value) => onChange('mid', value)} />
      <HiFiSlider label="Treble" value={settings.treble} min={-12} max={12} suffix=" dB" onChange={(value) => onChange('treble', value)} />
    </div>}
  </div>;
}

function HiFiSlider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="component-hifi-slider"><span><b>{label}</b><em>{value > 0 && min < 0 ? '+' : ''}{value}{suffix}</em></span><input type="range" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function HiFiUnit({ kind, active = false }: { kind: 'streamer' | 'meters' | 'silver' | 'black'; active?: boolean }) {
  return <div className={`component-hifi-unit ${kind} ${active ? 'active' : ''}`} aria-hidden="true">
    <span className="component-hifi-display" />
    <span className="component-hifi-knob left" />
    <span className="component-hifi-knob right" />
    {kind === 'meters' && <span className="component-vu-pair"><i /><i /></span>}
  </div>;
}
