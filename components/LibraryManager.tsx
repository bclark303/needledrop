'use client';

import Image from 'next/image';
import { AlertCircle, CheckCircle2, CopyMinus, Database, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import DirectRepairSettingsCard from './DirectRepairSettingsCard';
import LidarrSettingsCard from './LidarrSettingsCard';
import NzbRepairSettingsCard from './NzbRepairSettingsCard';
import { cover } from './vinyl';

type ScanStatus = {
  state: 'idle' | 'running' | 'complete' | 'error';
  phase?: string;
  albums?: number;
  message?: string;
};

type DuplicateAlbum = { id: string; artist: string; name: string; year?: number; coverArt: string };
type DuplicateGroup = { key: string; artist: string; title: string; albums: DuplicateAlbum[] };
type MergeRecord = {
  aliasId: string;
  aliasArtist: string;
  aliasTitle: string;
  canonicalId: string;
  canonicalArtist: string;
  canonicalTitle: string;
};
type Payload = { status: ScanStatus; duplicates: DuplicateGroup[]; merges: MergeRecord[]; error?: string };

export default function LibraryManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      const response = await fetch('/api/library', { cache: 'no-store' }).catch(() => null);
      if (!response || !response.ok || cancelled) return;
      const payload = await response.json() as Payload;
      setData(payload);
      if (payload.status?.state !== 'running') setBusy((value) => value === 'scan' ? '' : value);
    }
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  if (!open) return null;

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError('');
    const response = await fetch('/api/library', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    if (!response.ok) {
      setError(payload.error || 'Library action failed');
      setBusy('');
      return;
    }
    setData(payload);
    if (key !== 'scan' || payload.status?.state !== 'running') setBusy('');
    onChanged();
    window.dispatchEvent(new Event('needledrop:artwork-updated'));
  }

  const duplicates = data?.duplicates || [];
  const merges = data?.merges || [];
  const scanning = data?.status?.state === 'running';

  return <div className="settings-backdrop" onClick={onClose}>
    <section className="library-manager" onClick={(event) => event.stopPropagation()} aria-label="Library management">
      <header className="settings-header">
        <div><p className="eyebrow">COLLECTION MAINTENANCE</p><h2><Database size={24} /> Library manager</h2><span>Navidrome stays the playback library; NeedleDrop manages virtual releases, gaps and collection presentation.</span></div>
        <button className="drawer-x" onClick={onClose} aria-label="Close library manager"><X /></button>
      </header>

      {error && <div className="settings-warning"><AlertCircle /> {error}</div>}

      <section className="library-manager-block">
        <div className="library-manager-heading"><div><h3>Rescan library</h3><p>Ask Navidrome to scan its folders, then rebuild NeedleDrop's complete album index and check new metadata/artwork.</p></div><button className="primary" disabled={scanning || busy === 'scan'} onClick={() => void action({ action: 'scan' }, 'scan')}><RefreshCw size={17} className={scanning ? 'spin' : ''} /> {scanning ? 'Scanning…' : 'Rescan now'}</button></div>
        <div className={`scan-status ${data?.status?.state || 'idle'}`}>
          {data?.status?.state === 'complete' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} className={scanning ? 'spin' : ''} />}
          <span>{data?.status?.message || 'No manual scan has been run yet.'}</span>
        </div>
      </section>

      <NzbRepairSettingsCard />
      <DirectRepairSettingsCard />
      <LidarrSettingsCard />

      <section className="library-manager-block">
        <div className="library-manager-heading"><div><h3>Possible duplicates</h3><p>Matches are deliberately conservative: artist and album title must normalize to the same value. Choose the copy NeedleDrop should keep visible.</p></div><strong>{duplicates.length}</strong></div>
        {!duplicates.length && <div className="library-empty"><CheckCircle2 /> No unmerged duplicate groups detected.</div>}
        <div className="duplicate-groups">
          {duplicates.map((group) => <div className="duplicate-group" key={group.key}>
            <div className="duplicate-title"><strong>{group.artist}</strong><span>{group.title}</span></div>
            <div className="duplicate-copies">
              {group.albums.map((album) => <div className="duplicate-copy" key={album.id}>
                <Image src={cover(album.coverArt, 160)} alt="" width={72} height={72} unoptimized />
                <div><strong>{album.name}</strong><span>{album.artist}{album.year ? ` · ${album.year}` : ''}</span><small>{album.id}</small></div>
                <button disabled={Boolean(busy)} onClick={() => void action({ action: 'merge', canonicalId: album.id, aliasIds: group.albums.filter((item) => item.id !== album.id).map((item) => item.id) }, `merge:${group.key}`)}><CopyMinus size={15} /> Keep this copy</button>
              </div>)}
            </div>
          </div>)}
        </div>
      </section>

      <section className="library-manager-block">
        <div className="library-manager-heading"><div><h3>Merged entries</h3><p>Merging is reversible and only affects NeedleDrop's collection view.</p></div><strong>{merges.length}</strong></div>
        {!merges.length && <div className="library-empty">No album entries are currently merged.</div>}
        <div className="merged-list">
          {merges.map((merge) => <div className="merged-row" key={merge.aliasId}><div><strong>{merge.aliasArtist || merge.canonicalArtist} — {merge.aliasTitle || merge.canonicalTitle}</strong><span>Hidden ID {merge.aliasId} → visible ID {merge.canonicalId}</span></div><button disabled={Boolean(busy)} onClick={() => void action({ action: 'unmerge', aliasId: merge.aliasId }, `unmerge:${merge.aliasId}`)}><RotateCcw size={15} /> Undo</button></div>)}
        </div>
      </section>
    </section>
  </div>;
}
