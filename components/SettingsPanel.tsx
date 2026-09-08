'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, AudioLines, CheckCircle2, Database, Images, Library, PlugZap, RefreshCw, Save, Settings2, X } from 'lucide-react';
import type {
  AppSettings,
  AppSettingsPatch,
  ArtworkSource,
  EnrichmentStatus,
  MetadataSource,
  TurntableSpeed,
} from './types';

type TestState = { service: string; ok: boolean; message: string } | null;
type SettingsSection = 'library' | 'metadata' | 'playback';

export default function SettingsPanel({
  open,
  settings,
  version,
  onClose,
  onSaved,
}: {
  open: boolean;
  settings: AppSettings | null;
  version: string;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}) {
  const [form, setForm] = useState<AppSettingsPatch>({});
  const [discogsToken, setDiscogsToken] = useState('');
  const [lastfmApiKey, setLastfmApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichmentStatus | null>(null);
  const [testState, setTestState] = useState<TestState>(null);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<SettingsSection>('library');

  useEffect(() => {
    if (!settings) return;
    setForm({
      navidromeUrl: settings.navidromeUrl,
      navidromeMusicFolderId: settings.navidromeMusicFolderId,
      discogsEnabled: settings.discogsEnabled,
      musicbrainzEnabled: settings.musicbrainzEnabled,
      musicbrainzUserAgent: settings.musicbrainzUserAgent,
      coverArtArchiveEnabled: settings.coverArtArchiveEnabled,
      lastfmEnabled: settings.lastfmEnabled,
      autoEnrich: settings.autoEnrich,
      metadataSourceOrder: settings.metadataSourceOrder,
      artworkSourceOrder: settings.artworkSourceOrder,
      defaultPlaybackMode: settings.defaultPlaybackMode,
      defaultTurntableSpeed: settings.defaultTurntableSpeed,
      simulateSpeed: settings.simulateSpeed,
      changerEnabled: settings.changerEnabled,
    });
    setDiscogsToken('');
    setLastfmApiKey('');
    setTestState(null);
    setError('');
  }, [settings, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function poll() {
      const response = await fetch('/api/enrichment', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const payload = await response.json().catch(() => ({}));
      const next = payload.status as EnrichmentStatus | undefined;
      if (next) {
        setEnrichment((previous) => {
          if (previous?.state === 'running' && next.state !== 'running') {
            window.dispatchEvent(new Event('needledrop:artwork-updated'));
          }
          return next;
        });
        if (next.state !== 'running') setEnrichBusy(false);
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  if (!open || !settings) return null;
  const activeSettings = settings;

  function update<K extends keyof AppSettingsPatch>(key: K, value: AppSettingsPatch[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateNavidromeUrl(navidromeUrl: string) {
    setForm((current) => ({ ...current, navidromeUrl, navidromeMusicFolderId: '' }));
  }

  function moveMetadata(source: MetadataSource, delta: -1 | 1) {
    const current = [...((form.metadataSourceOrder || activeSettings.metadataSourceOrder) as MetadataSource[])];
    const index = current.indexOf(source);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    update('metadataSourceOrder', current);
  }

  function moveArtwork(source: ArtworkSource, delta: -1 | 1) {
    const current = [...((form.artworkSourceOrder || activeSettings.artworkSourceOrder) as ArtworkSource[])];
    const index = current.indexOf(source);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    update('artworkSourceOrder', current);
  }

  async function test(service: 'navidrome' | 'discogs' | 'musicbrainz' | 'lastfm') {
    setTestState(null);
    setError('');
    const response = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service,
        navidromeUrl: form.navidromeUrl,
        discogsToken,
        musicbrainzUserAgent: form.musicbrainzUserAgent,
        lastfmApiKey,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setTestState({ service, ok: response.ok && data.ok !== false, message: data.message || data.error || 'No response' });
  }

  async function enrich(force = true) {
    if (!activeSettings.canManage) return;
    setEnrichBusy(true);
    setError('');
    const response = await fetch('/api/enrichment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setEnrichBusy(false);
      setError(payload.error || 'Could not start library enrichment');
      return;
    }
    if (payload.status) setEnrichment(payload.status);
  }

  async function save() {
    if (!activeSettings.canManage) return;
    setBusy(true);
    setError('');
    const patch: AppSettingsPatch = { ...form };
    if (discogsToken.trim()) patch.discogsToken = discogsToken.trim();
    if (lastfmApiKey.trim()) patch.lastfmApiKey = lastfmApiKey.trim();
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error || 'Could not save settings');
      return;
    }
    setDiscogsToken('');
    setLastfmApiKey('');
    onSaved(data.settings);
  }

  const metadataOrder = (form.metadataSourceOrder || activeSettings.metadataSourceOrder) as MetadataSource[];
  const artworkOrder = (form.artworkSourceOrder || activeSettings.artworkSourceOrder) as ArtworkSource[];
  const selectedLibraryId = String(form.navidromeMusicFolderId ?? activeSettings.navidromeMusicFolderId ?? '');
  const selectedLibraryAvailable = !selectedLibraryId || activeSettings.navidromeLibraries.some((library) => library.id === selectedLibraryId);
  const progress = enrichment?.total ? Math.round((enrichment.completed / enrichment.total) * 100) : 0;

  return <div className="settings-backdrop" onClick={onClose}>
    <section className="settings-panel" onClick={(event) => event.stopPropagation()} aria-label="NeedleDrop settings">
      <header className="settings-header">
        <div><p className="eyebrow">ADMINISTRATION</p><h2><Settings2 size={24} /> Settings</h2><span>NeedleDrop v{version} · library, metadata and playback defaults</span></div>
        <button className="drawer-x" onClick={onClose} aria-label="Close settings"><X /></button>
      </header>

      {!activeSettings.canManage && <div className="settings-warning"><AlertCircle /> System settings are read-only for this Navidrome user.</div>}

      <nav className="panel-section-nav settings-section-nav" aria-label="Settings sections">
        <button id="settings-tab-library" aria-current={activeSection === 'library' ? 'page' : undefined} aria-controls="settings-panel-library" className={activeSection === 'library' ? 'active' : ''} onClick={() => setActiveSection('library')}><Library /><span><strong>Library</strong><small>Navidrome & index</small></span></button>
        <button id="settings-tab-metadata" aria-current={activeSection === 'metadata' ? 'page' : undefined} aria-controls="settings-panel-metadata" className={activeSection === 'metadata' ? 'active' : ''} onClick={() => setActiveSection('metadata')}><Images /><span><strong>Metadata & artwork</strong><small>Sources & priority</small></span></button>
        <button id="settings-tab-playback" aria-current={activeSection === 'playback' ? 'page' : undefined} aria-controls="settings-panel-playback" className={activeSection === 'playback' ? 'active' : ''} onClick={() => setActiveSection('playback')}><AudioLines /><span><strong>Playback</strong><small>Turntable defaults</small></span></button>
      </nav>

      <div id="settings-panel-library" aria-labelledby="settings-tab-library" hidden={activeSection !== 'library'}>
        <div className="settings-section settings-section-first">
          <div className="settings-section-title"><h3>Navidrome connection</h3><p>Choose the server and the one Navidrome library NeedleDrop should use.</p></div>
          <label className="settings-field wide"><span>Navidrome URL</span><div className="field-with-button"><input value={String(form.navidromeUrl || '')} onChange={(e) => updateNavidromeUrl(e.target.value)} disabled={!activeSettings.canManage} placeholder="http://192.168.1.20:4533" /><button onClick={() => test('navidrome')}><PlugZap size={16} /> Test</button></div></label>
          <label className="settings-field wide"><span>Navidrome library</span><select value={selectedLibraryId} onChange={(e) => update('navidromeMusicFolderId', e.target.value)} disabled={!activeSettings.canManage}><option value="">All accessible libraries</option>{!selectedLibraryAvailable && <option value={selectedLibraryId}>Unavailable library ({selectedLibraryId})</option>}{activeSettings.navidromeLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select><small>Browsing, search, random selection, enrichment, track matching and NeedleDrop refreshes stay inside this library.</small></label>
          {testState?.service === 'navidrome' && <div className={`connection-result ${testState.ok ? 'ok' : 'bad'}`}>{testState.ok ? <CheckCircle2 /> : <AlertCircle />}<span>{testState.message}</span></div>}
        </div>

        <div className="settings-section">
          <div className="settings-section-title"><h3><Database size={19} /> Collection database</h3><p>Scan every album in the selected library, resolve identity and artwork, and save the results in /data/needledrop.db.</p></div>
          <div className="enrichment-card">
            <div><strong>{enrichment?.state === 'running' ? `Enriching library · ${progress}%` : enrichment?.message || 'Canonical library is ready to enrich.'}</strong><span>{enrichment?.state === 'running' && enrichment.currentAlbum ? enrichment.currentAlbum : enrichment ? `${enrichment.artworkResolved}/${enrichment.total || 0} artwork resolved · ${enrichment.failed} failed` : 'Discogs + MusicBrainz + Cover Art Archive + Last.fm'}</span></div>
            <button className="primary" onClick={() => enrich(true)} disabled={enrichBusy || enrichment?.state === 'running' || !activeSettings.canManage}><RefreshCw size={16} className={enrichment?.state === 'running' ? 'spin' : ''} /> {enrichment?.state === 'running' ? 'Running…' : 'Enrich entire library'}</button>
          </div>
          {enrichment?.state === 'running' && <progress className="enrichment-progress" max={enrichment.total || 1} value={enrichment.completed} />}
        </div>
      </div>

      <div id="settings-panel-metadata" aria-labelledby="settings-tab-metadata" hidden={activeSection !== 'metadata'}>
        <div className="settings-section settings-section-first">
          <div className="settings-section-title"><h3>Metadata services</h3><p>Server-side sources used to identify physical releases and build NeedleDrop's canonical collection database.</p></div>
          <div className="settings-service-card">
            <div className="settings-service-heading"><div><strong>Discogs</strong><span>Exact pressing metadata and release artwork</span></div><label className="settings-switch"><input type="checkbox" checked={form.discogsEnabled !== false} onChange={(e) => update('discogsEnabled', e.target.checked)} disabled={!activeSettings.canManage} /><span>{form.discogsEnabled !== false ? 'Enabled' : 'Disabled'}</span></label></div>
            <label className="settings-field wide"><span>Personal access token</span><div className="field-with-button"><input type="password" value={discogsToken} onChange={(e) => setDiscogsToken(e.target.value)} disabled={!activeSettings.canManage} placeholder={activeSettings.discogsTokenConfigured ? 'Configured — enter a new token to replace it' : 'Paste a Discogs token'} /><button onClick={() => test('discogs')}><PlugZap size={16} /> Test</button></div></label>
          </div>

          <div className="settings-service-card">
            <div className="settings-service-heading"><div><strong>MusicBrainz & Cover Art Archive</strong><span>Release identity, exact-release artwork and release-group artwork</span></div></div>
            <label className="settings-field wide"><span>MusicBrainz User-Agent</span><div className="field-with-button"><input value={String(form.musicbrainzUserAgent || '')} onChange={(e) => update('musicbrainzUserAgent', e.target.value)} disabled={!activeSettings.canManage} /><button onClick={() => test('musicbrainz')}><PlugZap size={16} /> Test</button></div></label>
            <div className="settings-service-toggles"><label className="settings-check"><input type="checkbox" checked={form.musicbrainzEnabled !== false} onChange={(e) => update('musicbrainzEnabled', e.target.checked)} disabled={!activeSettings.canManage} /><span>MusicBrainz identity matching</span></label><label className="settings-check"><input type="checkbox" checked={form.coverArtArchiveEnabled !== false} onChange={(e) => update('coverArtArchiveEnabled', e.target.checked)} disabled={!activeSettings.canManage} /><span>Cover Art Archive artwork</span></label></div>
          </div>

          <div className="settings-service-card">
            <div className="settings-service-heading"><div><strong>Last.fm</strong><span>Tags, summaries and popularity metadata</span></div><label className="settings-switch"><input type="checkbox" checked={form.lastfmEnabled !== false} onChange={(e) => update('lastfmEnabled', e.target.checked)} disabled={!activeSettings.canManage} /><span>{form.lastfmEnabled !== false ? 'Enabled' : 'Disabled'}</span></label></div>
            <label className="settings-field wide"><span>API key</span><div className="field-with-button"><input type="password" value={lastfmApiKey} onChange={(e) => setLastfmApiKey(e.target.value)} disabled={!activeSettings.canManage} placeholder={activeSettings.lastfmApiKeyConfigured ? 'Configured — enter a new key to replace it' : 'Paste a Last.fm API key'} /><button onClick={() => test('lastfm')}><PlugZap size={16} /> Test</button></div></label>
          </div>

          {testState && testState.service !== 'navidrome' && <div className={`connection-result ${testState.ok ? 'ok' : 'bad'}`}>{testState.ok ? <CheckCircle2 /> : <AlertCircle />}<span>{testState.message}</span></div>}
        </div>

        <div className="settings-section settings-grid">
          <div className="settings-section-title wide"><h3>Automatic source priority</h3><p>Move sources up or down to set automatic priority. A manual album artwork choice always wins.</p></div>
          <div className="preference-card source-priority"><span>Metadata priority</span>{metadataOrder.map((source, index) => <div className="source-order-row" key={source}><strong>{index + 1}. {source}</strong><span><button onClick={() => moveMetadata(source, -1)} disabled={!activeSettings.canManage || index === 0} aria-label={`Move ${source} metadata source up`}>↑</button><button onClick={() => moveMetadata(source, 1)} disabled={!activeSettings.canManage || index === metadataOrder.length - 1} aria-label={`Move ${source} metadata source down`}>↓</button></span></div>)}</div>
          <div className="preference-card source-priority"><span>Artwork priority</span>{artworkOrder.map((source, index) => <div className="source-order-row" key={source}><strong>{index + 1}. {source}</strong><span><button onClick={() => moveArtwork(source, -1)} disabled={!activeSettings.canManage || index === 0} aria-label={`Move ${source} artwork source up`}>↑</button><button onClick={() => moveArtwork(source, 1)} disabled={!activeSettings.canManage || index === artworkOrder.length - 1} aria-label={`Move ${source} artwork source down`}>↓</button></span></div>)}</div>
          <label className="settings-check wide"><input type="checkbox" checked={form.autoEnrich !== false} onChange={(e) => update('autoEnrich', e.target.checked)} disabled={!activeSettings.canManage} /><span>Automatically enrich albums in the background when they enter the library view</span></label>
        </div>
      </div>

      <div id="settings-panel-playback" aria-labelledby="settings-tab-playback" hidden={activeSection !== 'playback'}>
        <div className="settings-section settings-grid settings-section-first">
          <div className="settings-section-title wide"><h3>Playback defaults</h3><p>These become the defaults on newly opened clients; they can still be changed while playing.</p></div>
          <label className="settings-field"><span>Default mode</span><select value={String(form.defaultPlaybackMode || 'vinyl')} onChange={(e) => update('defaultPlaybackMode', e.target.value as 'vinyl' | 'normal')} disabled={!activeSettings.canManage}><option value="vinyl">Vinyl mode</option><option value="normal">Normal mode</option></select></label>
          <label className="settings-field"><span>Turntable speed</span><select value={String(form.defaultTurntableSpeed || 33.333)} onChange={(e) => update('defaultTurntableSpeed', Number(e.target.value) as TurntableSpeed)} disabled={!activeSettings.canManage}><option value="33.333">33⅓ RPM</option><option value="45">45 RPM</option><option value="78">78 RPM</option></select></label>
          <label className="settings-check"><input type="checkbox" checked={form.simulateSpeed !== false} onChange={(e) => update('simulateSpeed', e.target.checked)} disabled={!activeSettings.canManage} /><span>Actually change playback rate when turntable speed or fine pitch changes</span></label>
          <label className="settings-check"><input type="checkbox" checked={form.changerEnabled !== false} onChange={(e) => update('changerEnabled', e.target.checked)} disabled={!activeSettings.canManage} /><span>Enable automatic record-changer queue</span></label>
        </div>
      </div>

      {error && <div className="settings-warning" role="alert"><AlertCircle /> {error}</div>}
      <footer className="settings-footer"><span>System settings and canonical metadata are stored in NeedleDrop appdata, not written back to Navidrome.</span><button className="primary" onClick={save} disabled={busy || !activeSettings.canManage}><Save size={17} /> {busy ? 'Saving…' : 'Save settings'}</button></footer>
    </section>
  </div>;
}
