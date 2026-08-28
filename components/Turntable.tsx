'use client';

import Image from 'next/image';
import { Gauge, Layers3, Pause, Play, Power, RotateCcw, Volume2 } from 'lucide-react';
import type { AlbumDetail, ArtworkSource, Song, TurntableSpeed, VinylMeta } from './types';
import { buildDisplaySides, buildPlaybackSides, fmt, nominalSpeed, selectedReleaseImage } from './vinyl';

const SPEEDS: Array<{ value: TurntableSpeed; label: string }> = [
  { value: 33.333, label: '33⅓' },
  { value: 45, label: '45' },
  { value: 78, label: '78' },
];

export default function Turntable({
  album,
  meta,
  current,
  currentIndex,
  tracks,
  strict,
  playing,
  motorOn,
  cueDown,
  speed,
  pitch,
  sideLabel,
  sideProgress,
  queueCount,
  onBack,
  onToggle,
  onMotor,
  onCue,
  onSpeed,
  onPitch,
  onNeedle,
  onSelectTrack,
  onOpenChanger,
  artworkOrder,
}: {
  album: AlbumDetail;
  meta: VinylMeta | null;
  current: Song | null;
  currentIndex: number;
  tracks: Song[];
  strict: boolean;
  playing: boolean;
  motorOn: boolean;
  cueDown: boolean;
  speed: TurntableSpeed;
  pitch: number;
  sideLabel: string;
  sideProgress: number;
  queueCount: number;
  onBack: () => void;
  onToggle: () => void;
  onMotor: () => void;
  onCue: () => void;
  onSpeed: (speed: TurntableSpeed) => void;
  onPitch: (pitch: number) => void;
  onNeedle: (progress: number) => void;
  onSelectTrack: (index: number) => void;
  onOpenChanger: () => void;
  artworkOrder?: ArtworkSource[];
}) {
  const art = selectedReleaseImage(meta, album, artworkOrder);
  const spinSeconds = Math.max(0.55, 60 / speed);
  const armAngle = -18 + Math.max(0, Math.min(1, sideProgress)) * 26;
  const nativeSpeed = nominalSpeed(meta);
  const playbackSides = buildPlaybackSides(album, meta);
  const displaySides = buildDisplaySides(album, meta, playbackSides);
  const trackIndexById = new Map(tracks.map((song, index) => [song.id, index]));

  function placeNeedle(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const radius = Math.sqrt(x * x + y * y) / (rect.width / 2);
    const outerGroove = 0.86;
    const innerGroove = 0.31;
    if (radius > 0.96 || radius < 0.22) return;
    const progress = Math.max(0, Math.min(1, (outerGroove - radius) / (outerGroove - innerGroove)));
    onNeedle(progress);
  }

  return <section className="turntable-page">
    <div className="turntable-topline">
      <button className="back" onClick={onBack}>← Back to record</button>
      <div className="turntable-status"><span className={motorOn ? 'status-dot live' : 'status-dot'} /> {motorOn ? `${speed === 33.333 ? '33⅓' : speed} RPM` : 'Motor stopped'} · Side {sideLabel}</div>
      <button className="changer-pill" onClick={onOpenChanger}><Layers3 size={17} /> Changer <strong>{queueCount}</strong></button>
    </div>

    <div className="turntable-layout">
      <div className="turntable-deck">
        <div className="deck-badge"><span>NEEDLEDROP</span><small>automatic transcription turntable</small></div>
        <div className="platter-well">
          <div className={`platter ${motorOn ? 'motor-on' : ''}`} style={{ '--spin-seconds': `${spinSeconds}s` } as React.CSSProperties}>
            <button className="record-hitarea" onPointerDown={placeNeedle} aria-label="Place needle on record">
              <div className="record-grooves" />
              <div className="record-label"><Image src={art} alt={`${album.name} record label`} fill sizes="170px" unoptimized /></div>
              <span className="spindle-dot" />
            </button>
          </div>
        </div>

        <div className={`tonearm ${cueDown ? 'cue-down' : 'cue-up'}`} style={{ '--arm-angle': `${armAngle}deg` } as React.CSSProperties} aria-hidden="true">
          <div className="arm-pivot"><span /></div>
          <div className="arm-tube"><div className="headshell"><span className="stylus" /></div></div>
        </div>

        <div className="deck-controls">
          <button className={`power-switch ${motorOn ? 'active' : ''}`} onClick={onMotor}><Power size={17} /><span>{motorOn ? 'STOP' : 'START'}</span></button>
          <div className="speed-bank"><span>SPEED</span>{SPEEDS.map((option) => <button key={option.value} className={speed === option.value ? 'active' : ''} onClick={() => onSpeed(option.value)}>{option.label}</button>)}</div>
          <button className={`cue-switch ${cueDown ? 'active' : ''}`} onClick={onCue}><RotateCcw size={17} /><span>{cueDown ? 'LIFT' : 'LOWER'} CUE</span></button>
        </div>

        <div className="pitch-control"><div><Gauge size={18} /><span>PITCH</span><strong>{pitch > 0 ? '+' : ''}{pitch.toFixed(1)}%</strong></div><input type="range" min="-8" max="8" step="0.1" value={pitch} onChange={(event) => onPitch(Number(event.target.value))} /><button onClick={() => onPitch(0)}>0</button></div>
      </div>

      <aside className="turntable-readout">
        <p className="eyebrow">NOW ON THE PLATTER</p>
        <div className="readout-cover"><Image src={art} alt={`${album.name} cover`} fill sizes="240px" unoptimized /></div>
        <h1>{album.name}</h1>
        <h2>{album.artist}</h2>
        <div className="now-track"><span>Side {sideLabel}</span><strong>{current?.title || 'Needle is up'}</strong><small>{Math.round(sideProgress * 100)}% through this side</small></div>

        <div className={`turntable-tracklist ${strict ? 'display-only' : 'selectable'}`}>
          <div className="turntable-tracklist-heading"><strong>TRACK LIST</strong><span>{strict ? 'Vinyl Mode · display only' : 'Normal Mode · select a track'}</span></div>
          <div className="turntable-tracklist-scroll">
            {displaySides.map((side) => <section className="turntable-side-list" key={side.label} aria-label={`Side ${side.label}`}>
              <div className="turntable-side-heading"><strong>Side {side.label}</strong><span>{side.rows.length} track{side.rows.length === 1 ? '' : 's'}</span></div>
              <ol>
                {side.rows.map((row, rowIndex) => {
                  const targetIndex = row.song ? trackIndexById.get(row.song.id) : undefined;
                  const active = Boolean(row.song && current?.id === row.song.id && currentIndex === targetIndex);
                  const selectable = !strict && targetIndex !== undefined;
                  const duration = row.duration || (row.song?.duration ? fmt(row.song.duration) : '—');
                  const content = <>
                    <span className="turntable-track-position">{row.position || `${side.label}${rowIndex + 1}`}</span>
                    <span className="turntable-track-copy"><strong>{row.title}</strong>{active ? <small className="is-playing"><Play size={10} fill="currentColor" /> Now playing</small> : !row.song ? <small>Unavailable in library</small> : null}</span>
                    <span className="turntable-track-duration">{duration}</span>
                  </>;
                  return <li key={`${side.label}-${row.position || rowIndex}-${row.title}`} className={active ? 'active' : !row.song ? 'unavailable' : ''}>
                    {selectable
                      ? <button onClick={() => onSelectTrack(targetIndex!)} aria-current={active ? 'true' : undefined} aria-label={`Play ${row.title}`}>{content}</button>
                      : <div className="turntable-track-row" aria-current={active ? 'true' : undefined}>{content}</div>}
                  </li>;
                })}
              </ol>
            </section>)}
          </div>
        </div>

        <button className="transport-primary" onClick={onToggle} disabled={!current}><span>{playing ? <Pause /> : <Play />}</span>{playing ? 'Pause' : 'Play'}</button>
        <div className="turntable-hint"><Volume2 size={18} /><p><strong>Drop the needle:</strong> tap/click anywhere in the record grooves. Outer grooves seek toward the start of the side; inner grooves seek toward the end.</p></div>
        <div className="turntable-tech"><span>Selected speed</span><strong>{speed === 33.333 ? '33⅓' : speed} RPM</strong><span>Pressing speed</span><strong>{nativeSpeed === 33.333 ? '33⅓' : nativeSpeed} RPM</strong><span>Fine pitch</span><strong>{pitch > 0 ? '+' : ''}{pitch.toFixed(1)}%</strong></div>
      </aside>
    </div>
  </section>;
}
