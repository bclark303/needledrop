'use client';

import Image from 'next/image';
import { ArrowDown, ArrowUp, Layers3, Play, Trash2, X } from 'lucide-react';
import type { Album } from './types';
import { cover } from './vinyl';

export type ChangerItem = { key: string; album: Album };

export default function ChangerPanel({
  open,
  items,
  enabled,
  onClose,
  onMove,
  onRemove,
  onPlayNow,
  onClear,
}: {
  open: boolean;
  items: ChangerItem[];
  enabled: boolean;
  onClose: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (key: string) => void;
  onPlayNow: (index: number) => void;
  onClear: () => void;
}) {
  if (!open) return null;
  return <div className="changer-backdrop" onClick={onClose}>
    <section className="changer-panel" onClick={(event) => event.stopPropagation()}>
      <header className="changer-header"><div><p className="eyebrow">AUTOMATIC RECORD CHANGER</p><h2><Layers3 /> Spindle queue</h2><p>{enabled ? 'Queued records drop after the current record finishes.' : 'Changer mode is disabled in Settings.'}</p></div><button className="drawer-x" onClick={onClose}><X /></button></header>

      <div className="changer-machine" aria-hidden="true">
        <div className="changer-spindle" />
        <div className="changer-platter" />
        <div className="changer-stack">
          {items.slice(0, 6).reverse().map((item, reversedIndex) => <div className="changer-disc" key={item.key} style={{ '--stack-index': reversedIndex } as React.CSSProperties}><Image src={cover(item.album.coverArt, 300)} alt="" fill sizes="220px" unoptimized /></div>)}
        </div>
      </div>

      <div className="changer-copy"><strong>{items.length ? `${items.length} record${items.length === 1 ? '' : 's'} waiting` : 'The spindle is empty'}</strong><span>Add records from the shelf or album screen. The top item below plays next.</span></div>

      <ol className="changer-list">
        {items.map((item, index) => <li key={item.key}>
          <div className="changer-thumb"><Image src={cover(item.album.coverArt, 180)} alt="" fill sizes="64px" unoptimized /></div>
          <div><span>#{index + 1}</span><strong>{item.album.name}</strong><small>{item.album.artist}</small></div>
          <div className="changer-row-actions">
            <button onClick={() => onPlayNow(index)} title="Play this record now"><Play size={16} /></button>
            <button onClick={() => onMove(index, -1)} disabled={index === 0} title="Move up"><ArrowUp size={16} /></button>
            <button onClick={() => onMove(index, 1)} disabled={index === items.length - 1} title="Move down"><ArrowDown size={16} /></button>
            <button onClick={() => onRemove(item.key)} title="Remove"><Trash2 size={16} /></button>
          </div>
        </li>)}
      </ol>

      {!items.length && <div className="changer-empty"><Layers3 size={42} /><p>Think of this as the tall changer spindle on an old automatic turntable. Add a few albums and they will wait here until the current record is finished.</p></div>}

      <footer className="changer-footer"><span>Vinyl Mode still requires manual side flips. The changer only drops the next queued record when the current record has finished its last side.</span>{items.length > 0 && <button onClick={onClear}><Trash2 size={16} /> Clear spindle</button>}</footer>
    </section>
  </div>;
}
