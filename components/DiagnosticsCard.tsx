'use client';

import { Activity, Bug, Camera, CheckCircle2, Download, Flag, Play, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

type Status = {
  active: boolean;
  sessionId?: string;
  startedAt?: string;
  stoppedAt?: string;
  eventCount: number;
  lastEventAt?: string;
  truncated?: boolean;
  logBytes?: number;
  maxLogBytes?: number;
};

type Summary = {
  totalEvents?: number;
  byType?: Record<string, number>;
  byLevel?: Record<string, number>;
  artworkServed?: Record<string, number>;
  cacheStates?: Record<string, number>;
  placeholderAlbums?: string[];
  failedAlbums?: string[];
  clientImageLoads?: number;
  clientImageErrors?: number;
};

type CacheStats = {
  entries?: number;
  bytes?: number;
  sources?: Record<string, number>;
  orphanBins?: number;
  orphanMetadata?: number;
  activeExternalFetches?: number;
  queuedExternalFetches?: number;
  backoffEntries?: number;
};

type Payload = {
  status?: Status;
  summary?: Summary;
  cache?: CacheStats;
  enrichment?: { state?: string; message?: string };
  overview?: { status?: Status; summary?: Summary; cache?: CacheStats; enrichment?: { state?: string; message?: string } };
  canManage?: boolean;
  error?: string;
};

export default function DiagnosticsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const response = await fetch('/api/diagnostics', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const payload = await response.json() as Payload;
      setData(payload);
    }
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setBusy(actionName);
    setResult(null);
    const response = await fetch('/api/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...extra }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    if (!response.ok) {
      setResult({ ok: false, message: payload.error || 'Diagnostics action failed' });
      return;
    }
    const overview = payload.overview || payload;
    setData((current) => ({ ...current, ...overview, canManage: current?.canManage }));
    window.dispatchEvent(new Event('needledrop:diagnostics-changed'));
    const messages: Record<string, string> = {
      start: 'Clean diagnostics capture started. Run enrichment, reproduce the refresh problem, then stop and export.',
      stop: 'Capture stopped. The log and artwork cache inventory are ready to export.',
      clear: 'Diagnostics log cleared.',
      snapshot: 'Artwork state snapshot captured.',
      marker: 'Timeline marker recorded.',
    };
    setResult({ ok: true, message: messages[actionName] || 'Diagnostics action complete.' });
  }

  async function exportReport() {
    setBusy('export');
    setResult(null);
    const response = await fetch('/api/diagnostics?export=1', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) {
      const payload = await response?.json().catch(() => ({})) as { error?: string } | undefined;
      setBusy('');
      setResult({ ok: false, message: payload?.error || 'Could not export diagnostics report' });
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `needledrop-diagnostics-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setBusy('');
    setResult({ ok: true, message: 'Sanitized diagnostics report exported.' });
  }

  const status = data?.status;
  const summary = data?.summary;
  const cache = data?.cache;
  const active = status?.active === true;
  const canManage = data?.canManage !== false;
  const placeholderCount = summary?.placeholderAlbums?.length || 0;
  const failedCount = summary?.failedAlbums?.length || 0;

  return <section className="library-manager-block diagnostics-card">
    <div className="library-manager-heading">
      <div>
        <h3><Bug size={18} /> Debug diagnostics <span className="advanced-badge">Advanced</span></h3>
        <p>Capture the complete artwork path across Collection, Album view, remote providers, persistent cache, enrichment transitions and browser image loads. Secrets and URL query values are removed from exports.</p>
      </div>
      <strong>{active ? 'CAPTURING' : 'IDLE'}</strong>
    </div>

    <div className={`scan-status ${active ? 'running' : 'idle'}`}>
      {active ? <Activity size={18} className="spin" /> : <CheckCircle2 size={18} />}
      <span>{active
        ? `Capture ${status?.sessionId?.slice(0, 8) || ''} · ${status?.eventCount || 0} events · ${formatBytes(status?.logBytes || 0)}`
        : status?.eventCount
          ? `Last capture has ${status.eventCount} events (${formatBytes(status.logBytes || 0)}).`
          : 'No diagnostics capture has been recorded yet.'}</span>
    </div>

    <div className="repair-capabilities">
      <span><Camera size={14} /> Cache: {cache?.entries || 0} covers · {formatBytes(cache?.bytes || 0)}</span>
      <span><Activity size={14} /> Placeholders observed: {placeholderCount}</span>
      <span><Activity size={14} /> Albums with warnings: {failedCount}</span>
      <span><Activity size={14} /> Browser loads/errors: {summary?.clientImageLoads || 0}/{summary?.clientImageErrors || 0}</span>
      <span><Activity size={14} /> Upstream active/queued: {cache?.activeExternalFetches || 0}/{cache?.queuedExternalFetches || 0}</span>
      <span><Activity size={14} /> Backoff URLs: {cache?.backoffEntries || 0}</span>
    </div>

    <div className="direct-repair-warning">
      <Bug size={19} />
      <div><strong>Recommended reproduction</strong><span>Start a clean capture → run a full enrichment → wait until covers settle → add the “after enrichment” marker → refresh the browser → add the “after refresh” marker → stop → export the JSON report.</span></div>
    </div>

    <div className="repair-options-row direct-repair-options">
      <div className="lidarr-buttons">
        <button className="primary" disabled={!canManage || busy !== '' || active} onClick={() => void action('start', { clear: true })}><Play size={15} /> {busy === 'start' ? 'Starting…' : 'Start clean capture'}</button>
        <button disabled={!canManage || busy !== '' || !active} onClick={() => void action('stop')}><Square size={15} /> {busy === 'stop' ? 'Stopping…' : 'Stop capture'}</button>
        <button disabled={!canManage || busy !== '' || !active} onClick={() => void action('snapshot', { reason: 'manual-ui' })}><Camera size={15} /> Snapshot</button>
      </div>
      <div className="lidarr-buttons">
        <button disabled={!canManage || busy !== '' || !active} onClick={() => void action('marker', { label: 'AFTER ENRICHMENT' })}><Flag size={15} /> Mark after enrichment</button>
        <button disabled={!canManage || busy !== '' || !active} onClick={() => void action('marker', { label: 'AFTER BROWSER REFRESH' })}><Flag size={15} /> Mark after refresh</button>
      </div>
    </div>

    <div className="repair-options-row direct-repair-options">
      <div><small>Exports include per-album candidate order, cache presence, resolver requests, HTTP statuses/timings, browser load telemetry, runtime UID/GID, enrichment state and current artwork DB state.</small></div>
      <div className="lidarr-buttons">
        <button disabled={!canManage || busy !== '' || !(status?.eventCount)} onClick={() => void exportReport()}><Download size={15} /> {busy === 'export' ? 'Building…' : 'Export JSON'}</button>
        <button disabled={!canManage || busy !== '' || active || !(status?.eventCount)} onClick={() => void action('clear')}><Trash2 size={15} /> Clear</button>
      </div>
    </div>

    {status?.truncated && <div className="settings-warning">The diagnostics log reached its 25 MB safety limit and capture stopped automatically.</div>}
    {cache && ((cache.orphanBins || 0) > 0 || (cache.orphanMetadata || 0) > 0) && <div className="settings-warning">Artwork cache integrity warning: {cache.orphanBins || 0} data files and {cache.orphanMetadata || 0} metadata files are orphaned.</div>}
    {result && <div className={`connection-result ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <CheckCircle2 /> : <Bug />}<span>{result.message}</span></div>}
  </section>;
}

function formatBytes(value: number) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
