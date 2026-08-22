'use client';

import { AlertTriangle, CheckCircle2, Download, FileSearch, RefreshCw, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';

type AvailabilityTrack = {
  side: string;
  position: string;
  title: string;
  duration?: string;
  available: boolean;
};

type Availability = {
  releaseDefined: boolean;
  status: 'fully-playable' | 'partially-playable' | 'collection-only' | 'digital-library';
  totalTracks: number;
  availableTracks: number;
  missingTracks: AvailabilityTrack[];
};

type LidarrRequest = {
  id: number;
  state: string;
  message?: string;
  missingTracks: Array<{ position: string; title: string }>;
  updatedAt: string;
};

type RepairRequest = {
  id: number;
  state: string;
  message?: string;
  candidateTitle: string;
  importedTracks: string[];
  updatedAt: string;
};

type RepairCandidate = {
  id: string;
  title: string;
  size?: number;
  indexer?: string;
  score: number;
  quality: string;
  manifestVisible: boolean;
  archive: boolean;
  matchedTracks: string[];
  coverage: number;
  manifestFiles: string[];
};

type Payload = {
  availability?: Availability;
  request?: LidarrRequest | null;
  repair?: RepairRequest | null;
  candidates?: RepairCandidate[];
  repairConfigured?: boolean;
  canRequest?: boolean;
  releaseGroupMbid?: string;
  error?: string;
};

export default function AvailabilityPanel({ albumId }: { albumId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/availability/${encodeURIComponent(albumId)}`, { cache: 'no-store' }).catch(() => null);
      if (!response || cancelled) return;
      const payload = await response.json().catch(() => ({})) as Payload;
      if (response.ok) setData((current) => ({ ...current, ...payload }));
      else setError(payload.error || 'Could not check release availability');
    }
    void load();
    const timer = window.setInterval(() => {
      const repairActive = data?.repair && !['ready', 'failed', 'partial'].includes(data.repair.state);
      const lidarrActive = data?.request && !['ready'].includes(data.request.state);
      if (repairActive || lidarrActive) void load();
    }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [albumId, data?.repair?.state, data?.request?.state]);

  async function action(name: 'search-nzb' | 'start-nzb' | 'request-lidarr' | 'recheck', candidateId?: string) {
    setBusy(candidateId ? `${name}:${candidateId}` : name);
    setError('');
    const response = await fetch(`/api/availability/${encodeURIComponent(albumId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: name, ...(candidateId ? { candidateId } : {}) }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    if (!response.ok) {
      let message = payload.error || 'Availability action failed';
      if (message === 'LIDARR_NOT_CONFIGURED') message = 'Lidarr is not configured. Open Library Manager to connect it.';
      if (message.startsWith('NZB_REPAIR_')) message = 'NZB Track Repair is not configured. Open Library Manager and complete the indexer/SAB setup.';
      setError(message);
      return;
    }
    setData((current) => ({ ...current, ...payload, ...(name === 'start-nzb' ? { candidates: [] } : {}) }));
  }

  const availability = data?.availability;
  if (!availability && !error) return <div className="availability-panel loading"><RefreshCw className="spin" size={17} /> Checking selected release…</div>;

  if (!availability?.releaseDefined) {
    return <div className="availability-panel neutral"><div><strong>Digital album</strong><span>Select a physical release in Pressing & artwork to make its exact tracklist authoritative.</span></div></div>;
  }

  const full = availability.status === 'fully-playable';
  const none = availability.status === 'collection-only';
  const repairBusy = busy === 'search-nzb' || busy.startsWith('start-nzb:');

  return <section className={`availability-panel ${full ? 'complete' : 'missing'}`}>
    <div className="availability-summary">
      <div className="availability-icon">{full ? <CheckCircle2 /> : <AlertTriangle />}</div>
      <div>
        <strong>{full ? 'Fully playable' : none ? 'Collection only' : `${availability.missingTracks.length} track${availability.missingTracks.length === 1 ? '' : 's'} missing`}</strong>
        <span>{availability.availableTracks}/{availability.totalTracks} tracks from the selected physical release are available in Navidrome.</span>
      </div>
      {!full && data?.canRequest && <button className="primary" disabled={Boolean(busy) || !data.repairConfigured} onClick={() => void action('search-nzb')}><Wrench size={16} /> {busy === 'search-nzb' ? 'Inspecting NZBs…' : data.repairConfigured ? 'Repair missing tracks' : 'Configure Track Repair'}</button>}
      {!full && <button disabled={Boolean(busy)} onClick={() => void action('recheck')}><RefreshCw size={15} /> Check again</button>}
    </div>

    {!full && <div className="missing-track-list">{availability.missingTracks.map((track) => <div key={`${track.position}-${track.title}`}><span>{track.position || `Side ${track.side}`}</span><strong>{track.title}</strong></div>)}</div>}

    {!full && data?.canRequest && data.repairConfigured === false && <div className="repair-hint"><AlertTriangle size={15} /><span>Open Library Manager → NZB Track Repair to connect an indexer and SABnzbd and add the two repair mounts.</span></div>}

    {!!data?.candidates?.length && <div className="repair-candidates">
      <div className="repair-candidates-heading"><FileSearch size={17} /><div><strong>Inspected NZB candidates</strong><span>NeedleDrop downloaded only the NZB manifests. Nothing has been queued yet.</span></div></div>
      {data.candidates.map((candidate, index) => <article className={`repair-candidate ${index === 0 ? 'best' : ''}`} key={candidate.id}>
        <div className="repair-candidate-rank">{index === 0 ? 'BEST' : `${Math.round(candidate.score * 100)}%`}</div>
        <div className="repair-candidate-info">
          <strong>{candidate.title}</strong>
          <span>{candidate.quality}{candidate.size ? ` · ${formatBytes(candidate.size)}` : ''}{candidate.indexer ? ` · ${candidate.indexer}` : ''}</span>
          <small>{candidate.manifestVisible
            ? `${candidate.matchedTracks.length}/${availability.missingTracks.length} missing track${availability.missingTracks.length === 1 ? '' : 's'} visible by filename in the NZB manifest.`
            : candidate.archive
              ? 'Archive contents are hidden in the NZB; SABnzbd must download/unpack the album before NeedleDrop can identify the requested tracks.'
              : 'Manifest filenames are obfuscated or inconclusive; the extracted audio will be verified by filename and embedded tags.'}</small>
          {!!candidate.matchedTracks.length && <em>{candidate.matchedTracks.join(' · ')}</em>}
        </div>
        <button className={index === 0 ? 'primary' : ''} disabled={repairBusy || Boolean(data.repair && !['failed', 'ready', 'partial'].includes(data.repair.state))} onClick={() => void action('start-nzb', candidate.id)}><Download size={15} /> {busy === `start-nzb:${candidate.id}` ? 'Sending…' : 'Download & repair'}</button>
      </article>)}
    </div>}

    {data?.repair && <div className={`repair-request-state ${data.repair.state}`}><Wrench size={16} /><div><strong>Track Repair · {repairLabel(data.repair.state)}</strong><span>{data.repair.message || data.repair.candidateTitle}</span>{!!data.repair.importedTracks?.length && <small>Retained: {data.repair.importedTracks.join(' · ')}</small>}</div></div>}

    {!full && data?.canRequest && <details className="lidarr-fallback"><summary>Lidarr fallback</summary><div><p>Use Lidarr if you prefer its album-level search/import workflow.</p><button disabled={Boolean(busy)} onClick={() => void action('request-lidarr')}><Download size={15} /> {busy === 'request-lidarr' ? 'Sending…' : 'Find with Lidarr'}</button></div></details>}
    {data?.request && <div className={`lidarr-request-state ${data.request.state}`}><Download size={16} /><div><strong>Lidarr · {lidarrLabel(data.request.state)}</strong><span>{data.request.message || 'Request submitted.'}</span></div></div>}
    {error && <div className="availability-error"><AlertTriangle size={16} /> {error}</div>}
  </section>;
}

function repairLabel(state: string) {
  if (state === 'queued') return 'Queued';
  if (state === 'downloading') return 'Downloading temporary album';
  if (state === 'processing') return 'Identifying requested tracks';
  if (state === 'waiting-for-staging') return 'Waiting for staging mount';
  if (state === 'waiting-for-navidrome') return 'Waiting for Navidrome';
  if (state === 'partial') return 'Partially repaired';
  if (state === 'ready') return 'Ready';
  if (state === 'failed') return 'Needs attention';
  return state.replace(/-/g, ' ');
}

function lidarrLabel(state: string) {
  if (state === 'searching') return 'Searching';
  if (state === 'downloading') return 'Downloading';
  if (state === 'search-complete') return 'Search complete';
  if (state === 'waiting-for-navidrome') return 'Waiting for Navidrome';
  if (state === 'ready') return 'Ready';
  return state.replace(/-/g, ' ');
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}
