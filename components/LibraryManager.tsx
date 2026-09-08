'use client';

import Image from 'next/image';
import { Activity, AlertCircle, CheckCircle2, CopyMinus, Database, LayoutDashboard, RefreshCw, RotateCcw, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import DiagnosticsCard from './DiagnosticsCard';
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
type LibrarySection = 'overview' | 'repair' | 'duplicates' | 'diagnostics';

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
  const [activeSection, setActiveSection] = useState<LibrarySection>('overview');

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
        <div><p className="eyebrow">LIBRARY TOOLS</p><h2><Database size={24} /> Library manager</h2><span>Refresh the index, configure repair sources, manage duplicates and capture diagnostics.</span></div>
        <button className="drawer-x" onClick={onClose} aria-label="Close library manager"><X /></button>
      </header>

      {error && <div className="settings-warning" role="alert"><AlertCircle /> {error}</div>}

      <nav className="panel-section-nav library-section-nav" aria-label="Library manager sections">
        <button id="library-tab-overview" aria-current={activeSection === 'overview' ? 'page' : undefined} aria-controls="library-panel-overview" className={activeSection === 'overview' ? 'active' : ''} onClick={() => setActiveSection('overview')}><LayoutDashboard /><span><strong>Overview</strong><small>Index status</small></span></button>
        <button id="library-tab-repair" aria-current={activeSection === 'repair' ? 'page' : undefined} aria-controls="library-panel-repair" className={activeSection === 'repair' ? 'active' : ''} onClick={() => setActiveSection('repair')}><Wrench /><span><strong>Repair</strong><small>Track sources</small></span></button>
        <button id="library-tab-duplicates" aria-current={activeSection === 'duplicates' ? 'page' : undefined} aria-controls="library-panel-duplicates" className={activeSection === 'duplicates' ? 'active' : ''} onClick={() => setActiveSection('duplicates')}><CopyMinus /><span><strong>Duplicates</strong><small>{duplicates.length} possible</small></span></button>
        <button id="library-tab-diagnostics" aria-current={activeSection === 'diagnostics' ? 'page' : undefined} aria-controls="library-panel-diagnostics" className={activeSection === 'diagnostics' ? 'active' : ''} onClick={() => setActiveSection('diagnostics')}><Activity /><span><strong>Diagnostics</strong><small>Capture & export</small></span></button>
      </nav>

      <div id="library-panel-overview" aria-labelledby="library-tab-overview" hidden={activeSection !== 'overview'}>
        <div className="library-overview-grid">
          <div className="library-overview-card"><span>Index refresh</span><strong className={`status-${data?.status?.state || 'idle'}`}>{scanning ? 'Running' : data?.status?.state === 'complete' ? 'Complete' : data?.status?.state === 'error' ? 'Needs attention' : 'Not run'}</strong><small>{data?.status?.albums ? `${data.status.albums} logical albums` : 'Current selected library'}</small></div>
          <button className="library-overview-card" onClick={() => setActiveSection('duplicates')}><span>Possible duplicates</span><strong>{data ? duplicates.length : '—'}</strong><small>{duplicates.length ? 'Review conservative matches' : 'No groups awaiting review'}</small></button>
          <button className="library-overview-card" onClick={() => setActiveSection('duplicates')}><span>Merged entries</span><strong>{data ? merges.length : '—'}</strong><small>Reversible NeedleDrop aliases</small></button>
        </div>
        <section className="library-manager-block library-refresh-block">
          <div className="library-manager-heading"><div><h3>Refresh library</h3><p>Rebuild NeedleDrop's album index and check metadata/artwork. A selected Navidrome library stays isolated; All mode may also request a Navidrome folder scan.</p></div><button className="primary" disabled={scanning || busy === 'scan'} onClick={() => void action({ action: 'scan' }, 'scan')}><RefreshCw size={17} className={scanning ? 'spin' : ''} /> {scanning ? 'Refreshing…' : 'Refresh now'}</button></div>
          <div className={`scan-status ${data?.status?.state || 'idle'}`} aria-live="polite">
            {data?.status?.state === 'complete' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} className={scanning ? 'spin' : ''} />}
            <span>{data?.status?.message || 'No manual scan has been run yet.'}</span>
          </div>
        </section>
      </div>

      <div id="library-panel-repair" aria-labelledby="library-tab-repair" hidden={activeSection !== 'repair'}>
        <div className="panel-section-intro"><Wrench /><div><strong>Track repair sources</strong><span>Configure the preferred NZB workflow, optional direct promotion, and Lidarr fallback in one place.</span></div></div>
        <NzbRepairSettingsCard />
        <DirectRepairSettingsCard />
        <LidarrSettingsCard />
      </div>

      <div id="library-panel-duplicates" aria-labelledby="library-tab-duplicates" hidden={activeSection !== 'duplicates'}>
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
      </div>

      <div id="library-panel-diagnostics" aria-labelledby="library-tab-diagnostics" hidden={activeSection !== 'diagnostics'}>
        <div className="panel-section-intro"><Activity /><div><strong>Diagnostics</strong><span>Capture a sanitized timeline when a problem is reproducible, then export it for review.</span></div></div>
        <DiagnosticsCard />
      </div>
    </section>
  </div>;
}
