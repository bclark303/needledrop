'use client';

import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
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

type Payload = {
  availability?: Availability;
  request?: LidarrRequest | null;
  canRequest?: boolean;
  releaseGroupMbid?: string;
  error?: string;
};

export default function AvailabilityPanel({ albumId }: { albumId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch(`/api/availability/${encodeURIComponent(albumId)}`, { cache: 'no-store' }).catch(() => null);
      if (!response || cancelled) return;
      const payload = await response.json().catch(() => ({})) as Payload;
      if (response.ok) setData(payload);
      else setError(payload.error || 'Could not check release availability');
    }
    void load();
    const timer = window.setInterval(() => {
      if (data?.request && !['ready'].includes(data.request.state)) void load();
    }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [albumId, data?.request?.state]);

  async function action(name: 'request-lidarr' | 'recheck') {
    setBusy(true);
    setError('');
    const response = await fetch(`/api/availability/${encodeURIComponent(albumId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: name }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy(false);
    if (!response.ok) {
      const message = payload.error || 'Availability action failed';
      setError(message === 'LIDARR_NOT_CONFIGURED' ? 'Lidarr is not configured. Open Library Manager to connect it.' : message);
      return;
    }
    setData((current) => ({ ...current, ...payload }));
  }

  const availability = data?.availability;
  if (!availability && !error) return <div className="availability-panel loading"><RefreshCw className="spin" size={17} /> Checking selected release…</div>;

  if (!availability?.releaseDefined) {
    return <div className="availability-panel neutral"><div><strong>Digital album</strong><span>Select a physical release in Pressing & artwork to make its exact tracklist authoritative.</span></div></div>;
  }

  const full = availability.status === 'fully-playable';
  const none = availability.status === 'collection-only';
  return <section className={`availability-panel ${full ? 'complete' : 'missing'}`}>
    <div className="availability-summary">
      <div className="availability-icon">{full ? <CheckCircle2 /> : <AlertTriangle />}</div>
      <div>
        <strong>{full ? 'Fully playable' : none ? 'Collection only' : `${availability.missingTracks.length} track${availability.missingTracks.length === 1 ? '' : 's'} missing`}</strong>
        <span>{availability.availableTracks}/{availability.totalTracks} tracks from the selected physical release are available in Navidrome.</span>
      </div>
      {!full && data?.canRequest && <button className="primary" disabled={busy} onClick={() => void action('request-lidarr')}><Download size={16} /> {busy ? 'Sending…' : 'Find with Lidarr'}</button>}
      {!full && <button disabled={busy} onClick={() => void action('recheck')}><RefreshCw size={15} /> Check again</button>}
    </div>

    {!full && <div className="missing-track-list">{availability.missingTracks.map((track) => <div key={`${track.position}-${track.title}`}><span>{track.position || `Side ${track.side}`}</span><strong>{track.title}</strong></div>)}</div>}

    {data?.request && <div className={`lidarr-request-state ${data.request.state}`}><Download size={16} /><div><strong>Lidarr · {label(data.request.state)}</strong><span>{data.request.message || 'Request submitted.'}</span></div></div>}
    {error && <div className="availability-error"><AlertTriangle size={16} /> {error}</div>}
  </section>;
}

function label(state: string) {
  if (state === 'searching') return 'Searching';
  if (state === 'downloading') return 'Downloading';
  if (state === 'search-complete') return 'Search complete';
  if (state === 'waiting-for-navidrome') return 'Waiting for Navidrome';
  if (state === 'ready') return 'Ready';
  return state.replace(/-/g, ' ');
}
