'use client';

import Image from 'next/image';
import { Heart, Layers3, Play, Settings2, SlidersHorizontal } from 'lucide-react';
import type { AlbumDetail, ArtworkSource, Song, VinylMeta } from './types';
import type { DisplaySide, PlaybackSide } from './vinyl';
import { fmt, selectedReleaseImage } from './vinyl';

export default function AlbumView({
  album,
  meta,
  playbackSides,
  displaySides,
  strict,
  currentId,
  onBack,
  onPlaySide,
  onOpenTurntable,
  onOpenMetadata,
  onAddChanger,
  onStar,
  artworkOrder,
}: {
  album: AlbumDetail;
  meta: VinylMeta | null;
  playbackSides: PlaybackSide[];
  displaySides: DisplaySide[];
  strict: boolean;
  currentId?: string;
  onBack: () => void;
  onPlaySide: (sideIndex: number, trackIndex?: number) => void;
  onOpenTurntable: () => void;
  onOpenMetadata: () => void;
  onAddChanger: () => void;
  onStar: () => void;
  artworkOrder?: ArtworkSource[];
}) {
  const art = selectedReleaseImage(meta, album, artworkOrder);
  return <section className="album-page">
    <button className="back" onClick={onBack}>← Back to collection</button>
    <div className="album-stage">
      <div className="sleeve-stack"><div className="album-disc"><span /></div><Image src={art} alt={`${album.name} cover`} fill sizes="(max-width:800px) 90vw, 520px" unoptimized /></div>
      <div className="album-copy">
        <p className="eyebrow">{meta?.pressingLabel || 'FROM YOUR VINYL LIBRARY'}</p>
        <h1>{album.name}</h1>
        <h2>{album.artist}</h2>
        <p className="album-facts">{meta?.releaseYear || album.year || 'Unknown year'}{album.genre ? ` · ${album.genre}` : ''}{meta?.country ? ` · ${meta.country}` : ''}{meta?.catalogNumber ? ` · ${meta.catalogNumber}` : ''}</p>
        {meta?.formatDescription && <p className="format-line">{meta.formatDescription}</p>}
        <div className="album-actions">
          <button className="primary" onClick={() => onPlaySide(0)}><Play /> Play Side {playbackSides[0]?.label || 'A'}</button>
          <button onClick={onOpenTurntable}><SlidersHorizontal /> Turntable</button>
          <button onClick={onAddChanger}><Layers3 /> Add to changer</button>
          <button onClick={onStar}><Heart /> Favourite</button>
          <button onClick={onOpenMetadata}><Settings2 /> Pressing & artwork</button>
        </div>
        <p className="mode-note">{strict ? 'Vinyl Mode: playback stops at every physical side boundary.' : 'Normal Mode: playback moves through sides automatically.'}</p>
        {meta?.discogsReleaseId && <div className="discogs-chip">Discogs release #{meta.discogsReleaseId}</div>}
      </div>
    </div>

    <div className={`track-sides ${displaySides.length > 2 ? 'many-sides' : ''}`}>
      {displaySides.map((side, sideIndex) => <TrackSide key={side.label} label={side.label} rows={side.rows} strict={strict} currentId={currentId} onPlay={(rowIndex, song) => {
        if (!song) return;
        const actualTrackIndex = playbackSides[sideIndex]?.songs.findIndex((candidate) => candidate.id === song.id) ?? -1;
        if (actualTrackIndex >= 0) onPlaySide(sideIndex, actualTrackIndex);
      }} />)}
    </div>
  </section>;
}

function TrackSide({
  label,
  rows,
  strict,
  currentId,
  onPlay,
}: {
  label: string;
  rows: Array<{ position: string; title: string; duration?: string; song?: Song }>;
  strict: boolean;
  currentId?: string;
  onPlay: (rowIndex: number, song?: Song) => void;
}) {
  const duration = rows.reduce((sum, row) => sum + (row.song?.duration || 0), 0);
  return <div className="side">
    <div className="side-label"><span className="mini-record" /><span>SIDE {label}</span><em>{duration ? fmt(duration) : `${rows.length} tracks`}</em></div>
    <ol>{rows.map((row, index) => <li key={`${row.position}-${row.title}-${index}`} className={currentId && row.song?.id === currentId ? 'active' : ''}><button disabled={!row.song || (strict && index > 0)} onClick={() => onPlay(index, row.song)}><span>{row.position || String(index + 1).padStart(2, '0')}</span><strong>{row.title}</strong><em>{row.duration || (row.song?.duration ? fmt(row.song.duration) : '')}</em></button></li>)}</ol>
  </div>;
}
