'use client';

import { Archive, Armchair, MapPinned, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  Album,
  RecordRoomConfig,
  RecordRoomShelf,
  RecordRoomShelfPresentation,
  RecordRoomSmartRule,
  RecordRoomTheme,
} from './types';

const THEMES: Array<{ id: RecordRoomTheme; name: string; description: string }> = [
  { id: 'audiophile', name: 'Audiophile Listening Room', description: 'A modern built-in listening wall with illuminated vinyl libraries, separates and a central turntable.' },
  { id: 'teen-bedroom', name: 'Bedroom Listening Nook', description: 'A warm, poster-covered bedroom with a compact hi-fi, stacked records and late-night lamp light.' },
  { id: 'record-store', name: 'Record Collector Room', description: 'Dense wooden shelves, digging bins and a turntable tucked into a lived-in record collector’s room.' },
];

const SLOT_NAMES: Record<RecordRoomTheme, string[]> = {
  audiophile: ['Left record library', 'Right record library', 'Hi-fi cabinet collection', 'Lower left cabinet'],
  'teen-bedroom': ['Main record cabinet', 'Records beside turntable', 'Lower record shelf', 'Desk-side stack'],
  'record-store': ['Left wall shelves', 'Front digging bins', 'Right wall shelves', 'Turntable cabinet records'],
};

type SmartRuleType = RecordRoomSmartRule['type'];

export default function RecordRoomPanel({
  open,
  room,
  albums,
  onChange,
  onClose,
}: {
  open: boolean;
  room: RecordRoomConfig;
  albums: Album[];
  onChange: (next: RecordRoomConfig) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'manual' | 'smart'>('manual');
  const [presentation, setPresentation] = useState<RecordRoomShelfPresentation>('shelf');
  const [ruleType, setRuleType] = useState<SmartRuleType>('starred');
  const [ruleValue, setRuleValue] = useState('');

  const genres = useMemo(() => [...new Set(albums.flatMap((album) => (album.genre || '').split(/[;,/]/).map((value) => value.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b)), [albums]);
  const decades = useMemo(() => [...new Set(albums.map((album) => album.year ? Math.floor(album.year / 10) * 10 : undefined).filter((value): value is number => Number.isFinite(value)))].sort((a, b) => a - b), [albums]);

  if (!open) return null;

  function changeTheme(theme: RecordRoomTheme) {
    onChange({ ...room, theme });
  }

  function mapSlot(index: number, collectionId: string) {
    const roomSlots = [...room.roomSlots];
    while (roomSlots.length < 4) roomSlots.push('');
    roomSlots[index] = collectionId;
    onChange({ ...room, roomSlots });
  }

  function createShelf() {
    const cleanName = name.trim();
    if (!cleanName) return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `room-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let shelf: RecordRoomShelf;
    if (kind === 'manual') {
      shelf = { id, name: cleanName, kind, presentation, albumIds: [] };
    } else {
      const rule = buildRule(ruleType, ruleValue);
      if (!rule) return;
      shelf = { id, name: cleanName, kind, presentation, rule };
    }
    onChange({ ...room, shelves: [...room.shelves, shelf] });
    setName('');
    setRuleValue('');
  }

  function removeShelf(id: string) {
    const shelves = room.shelves.filter((shelf) => shelf.id !== id);
    const roomSlots = room.roomSlots.map((slot) => slot === id ? '' : slot);
    onChange({ ...room, shelves, roomSlots, activeShelfId: room.activeShelfId === id ? undefined : room.activeShelfId });
  }

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="drawer record-room-panel" onClick={(event) => event.stopPropagation()}>
      <button className="drawer-x" onClick={onClose} aria-label="Close"><X /></button>
      <p className="eyebrow">V0.8 · RECORD ROOM</p>
      <h2>Build your room</h2>
      <p className="drawer-subtitle">The room is part of the interface. Its physical shelves and bins can point directly at your NeedleDrop collections.</p>

      <section className="room-panel-section">
        <div className="meta-block-title"><div><h3>Room theme</h3><span>Choose the actual room you walk into when opening NeedleDrop.</span></div></div>
        <div className="room-theme-grid">
          {THEMES.map((theme) => <button key={theme.id} className={`room-theme-card ${room.theme === theme.id ? 'selected' : ''}`} onClick={() => changeTheme(theme.id)}>
            <span className={`room-theme-swatch theme-${theme.id}`}><Armchair /></span>
            <strong>{theme.name}</strong>
            <small>{theme.description}</small>
          </button>)}
        </div>
      </section>

      <section className="room-panel-section">
        <div className="meta-block-title"><div><h3>Map collections into the room</h3><span>Each highlighted physical record area opens the collection assigned to it.</span></div></div>
        <div className="room-mapping-list">
          {SLOT_NAMES[room.theme].map((slotName, index) => <label className="room-mapping-row" key={`${room.theme}:${index}`}>
            <span className="room-mapping-icon"><MapPinned /></span>
            <span><strong>{slotName}</strong><small>Clickable area {index + 1}</small></span>
            <select value={room.roomSlots[index] || ''} onChange={(event) => mapSlot(index, event.target.value)}>
              <option value="">Not mapped</option>
              <option value="__all__">All records</option>
              {room.shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
            </select>
          </label>)}
        </div>
      </section>

      <section className="room-panel-section">
        <div className="meta-block-title"><div><h3>Shelves & crates</h3><span>Manual shelves hold records you choose. Smart shelves rebuild themselves from live library rules.</span></div></div>
        <div className="room-shelf-list">
          {room.shelves.map((shelf) => <div className="room-shelf-row" key={shelf.id}>
            <span className="room-shelf-icon">{shelf.kind === 'smart' ? <Sparkles /> : <Archive />}</span>
            <div><strong>{shelf.name}</strong><small>{describeShelf(shelf)}</small></div>
            <button onClick={() => removeShelf(shelf.id)} title={`Remove ${shelf.name}`}><Trash2 /></button>
          </div>)}
        </div>

        <div className="room-shelf-builder">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Late-night records" maxLength={80} /></label>
          <label>Type<select value={kind} onChange={(event) => setKind(event.target.value as 'manual' | 'smart')}><option value="manual">Manual shelf / crate</option><option value="smart">Smart shelf</option></select></label>
          <label>Furniture<select value={presentation} onChange={(event) => setPresentation(event.target.value as RecordRoomShelfPresentation)}><option value="shelf">Shelf</option><option value="crate">Flip crate</option></select></label>
          {kind === 'smart' && <>
            <label>Rule<select value={ruleType} onChange={(event) => { setRuleType(event.target.value as SmartRuleType); setRuleValue(''); }}><option value="starred">Favourites</option><option value="rating">Minimum rating</option><option value="decade">Decade</option><option value="genre">Genre</option><option value="recent">Recently added</option></select></label>
            {ruleType === 'rating' && <label>Stars<select value={ruleValue || '4'} onChange={(event) => setRuleValue(event.target.value)}><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="5">5 stars</option></select></label>}
            {ruleType === 'decade' && <label>Decade<select value={ruleValue || String(decades[0] || 1970)} onChange={(event) => setRuleValue(event.target.value)}>{(decades.length ? decades : [1950,1960,1970,1980,1990,2000,2010,2020]).map((decade) => <option key={decade} value={decade}>{decade}s</option>)}</select></label>}
            {ruleType === 'genre' && <label>Genre<input list="record-room-genres" value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} placeholder="Rock" /><datalist id="record-room-genres">{genres.map((genre) => <option key={genre} value={genre} />)}</datalist></label>}
            {ruleType === 'recent' && <label>Days<input type="number" min="1" max="3650" value={ruleValue || '60'} onChange={(event) => setRuleValue(event.target.value)} /></label>}
          </>}
          <button className="primary room-create-shelf" onClick={createShelf} disabled={!name.trim()}><Plus /> Create {kind === 'smart' ? 'smart shelf' : presentation}</button>
        </div>
      </section>

      <section className="room-panel-section room-feature-note">
        <Sparkles /><div><strong>Featured records</strong><span>Feature buttons still pin albums to your collection display, while the room scene itself shows the actual album currently on the turntable.</span></div>
      </section>
    </aside>
  </div>;
}

function buildRule(type: SmartRuleType, raw: string): RecordRoomSmartRule | null {
  if (type === 'starred') return { type };
  if (type === 'rating') return { type, minimum: clamp(Number(raw || 4), 1, 5) };
  if (type === 'decade') return { type, decade: Math.floor(clamp(Number(raw || 1970), 1900, 2100) / 10) * 10 };
  if (type === 'genre') return raw.trim() ? { type, value: raw.trim() } : null;
  if (type === 'recent') return { type, days: clamp(Number(raw || 60), 1, 3650) };
  return null;
}

function describeShelf(shelf: RecordRoomShelf) {
  const furniture = shelf.presentation === 'crate' ? 'flip crate' : 'shelf';
  if (shelf.kind === 'manual') return `${furniture} · ${shelf.albumIds?.length || 0} records`;
  const rule = shelf.rule;
  if (!rule) return `smart ${furniture}`;
  if (rule.type === 'starred') return `smart ${furniture} · favourites`;
  if (rule.type === 'rating') return `smart ${furniture} · ${rule.minimum}+ stars`;
  if (rule.type === 'decade') return `smart ${furniture} · ${rule.decade}s`;
  if (rule.type === 'genre') return `smart ${furniture} · ${rule.value}`;
  return `smart ${furniture} · added in the last ${rule.days} days`;
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
