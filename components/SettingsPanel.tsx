'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, PlugZap, Save, Settings2, X } from 'lucide-react';
import type { AppSettings, AppSettingsPatch, ArtworkSource, MetadataSource, TurntableSpeed } from './types';

type TestState = { service: string; ok: boolean; message: string } | null;

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
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settings) return;
    setForm({
      navidromeUrl: settings.navidromeUrl,
      discogsEnabled: settings.discogsEnabled,
      musicbrainzEnabled: settings.musicbrainzEnabled,
      musicbrainzUserAgent: settings.musicbrainzUserAgent,
      metadataSourceOrder: settings.metadataSourceOrder,
      artworkSourceOrder: settings.artworkSourceOrder,
      defaultPlaybackMode: settings.defaultPlaybackMode,
      defaultTurntableSpeed: settings.defaultTurntableSpeed,
      simulateSpeed: settings.simulateSpeed,
      changerEnabled: settings.changerEnabled,
    });
    setDiscogsToken('');
    setTestState(null);
    setError('');
  }, [settings, open]);

  if (!open || !settings) return null;

  function update<K extends keyof AppSettingsPatch>(key: K, value: AppSettingsPatch[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function swapMetadata() {
    const current = (form.metadataSourceOrder || settings.metadataSourceOrder) as MetadataSource[];
    update('metadataSourceOrder', [...current].reverse());
  }

  function swapArtwork() {
    const current = (form.artworkSourceOrder || settings.artworkSourceOrder) as ArtworkSource[];
    update('artworkSourceOrder', [...current].reverse());
  }

  async function test(service: 'navidrome' | 'discogs' | 'musicbrainz') {
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
      }),
    });
    const data = await response.json().catch(() => ({}));
    setTestState({ service, ok: response.ok && data.ok !== false, message: data.message || data.error || 'No response' });
  }

  async function save() {
    if (!settings.canManage) return;
    setBusy(true);
    setError('');
    const patch: AppSettingsPatch = { ...form };
    if (discogsToken.trim()) patch.discogsToken = discogsToken.trim();
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
    onSaved(data.settings);
  }

  const metadataOrder = (form.metadataSourceOrder || settings.metadataSourceOrder) as MetadataSource[];
  const artworkOrder = (form.artworkSourceOrder || settings.artworkSourceOrder) as ArtworkSource[];

  return <div className="settings-backdrop" onClick={onClose}>
    <section className="settings-panel" onClick={(event) => event.stopPropagation()} aria-label="NeedleDrop settings">
      <header className="settings-header">
        <div><p className="eyebrow">SYSTEM SETTINGS</p><h2><Settings2 size={24} /> NeedleDrop</h2><span>v{version}</span></div>
        <button className="drawer-x" onClick={onClose} aria-label="Close settings"><X /></button>
      </header>

      {!settings.canManage && <div className="settings-warning"><AlertCircle /> System settings are read-only for this Navidrome user.</div>}

      <div className="settings-section">
        <div className="settings-section-title"><h3>Connections</h3><p>Server-side connections used by every NeedleDrop client.</p></div>
        <label className="settings-field wide"><span>Navidrome URL</span><div className="field-with-button"><input value={String(form.navidromeUrl || '')} onChange={(e) => update('navidromeUrl', e.target.value)} disabled={!settings.canManage} placeholder="http://192.168.1.20:4533" /><button onClick={() => test('navidrome')}><PlugZap size={16} /> Test</button></div></label>
        <label className="settings-field wide"><span>Discogs personal access token</span><div className="field-with-button"><input type="password" value={discogsToken} onChange={(e) => setDiscogsToken(e.target.value)} disabled={!settings.canManage} placeholder={settings.discogsTokenConfigured ? 'Configured — enter a new token to replace it' : 'Paste a Discogs token'} /><button onClick={() => test('discogs')}><PlugZap size={16} /> Test</button></div></label>
        <label className="settings-check"><input type="checkbox" checked={form.discogsEnabled !== false} onChange={(e) => update('discogsEnabled', e.target.checked)} disabled={!settings.canManage} /><span>Enable Discogs metadata and release artwork</span></label>
        <label className="settings-field wide"><span>MusicBrainz User-Agent</span><div className="field-with-button"><input value={String(form.musicbrainzUserAgent || '')} onChange={(e) => update('musicbrainzUserAgent', e.target.value)} disabled={!settings.canManage} /><button onClick={() => test('musicbrainz')}><PlugZap size={16} /> Test</button></div></label>
        <label className="settings-check"><input type="checkbox" checked={form.musicbrainzEnabled !== false} onChange={(e) => update('musicbrainzEnabled', e.target.checked)} disabled={!settings.canManage} /><span>Enable MusicBrainz fallback metadata</span></label>
        {testState && <div className={`connection-result ${testState.ok ? 'ok' : 'bad'}`}>{testState.ok ? <CheckCircle2 /> : <AlertCircle />}<span>{testState.message}</span></div>}
      </div>

      <div className="settings-section settings-grid">
        <div className="settings-section-title wide"><h3>Metadata & artwork</h3><p>Choose which service wins when more than one source is available.</p></div>
        <div className="preference-card"><span>Metadata priority</span><strong>{metadataOrder.join(' → ')}</strong><button onClick={swapMetadata} disabled={!settings.canManage}>Reverse priority</button></div>
        <div className="preference-card"><span>Artwork priority</span><strong>{artworkOrder.join(' → ')}</strong><button onClick={swapArtwork} disabled={!settings.canManage}>Reverse priority</button></div>
      </div>

      <div className="settings-section settings-grid">
        <div className="settings-section-title wide"><h3>Playback defaults</h3><p>These become the defaults on newly opened clients; they can still be changed while playing.</p></div>
        <label className="settings-field"><span>Default mode</span><select value={String(form.defaultPlaybackMode || 'vinyl')} onChange={(e) => update('defaultPlaybackMode', e.target.value as 'vinyl' | 'normal')} disabled={!settings.canManage}><option value="vinyl">Vinyl mode</option><option value="normal">Normal mode</option></select></label>
        <label className="settings-field"><span>Turntable speed</span><select value={String(form.defaultTurntableSpeed || 33.333)} onChange={(e) => update('defaultTurntableSpeed', Number(e.target.value) as TurntableSpeed)} disabled={!settings.canManage}><option value="33.333">33⅓ RPM</option><option value="45">45 RPM</option><option value="78">78 RPM</option></select></label>
        <label className="settings-check"><input type="checkbox" checked={form.simulateSpeed !== false} onChange={(e) => update('simulateSpeed', e.target.checked)} disabled={!settings.canManage} /><span>Actually change playback rate when turntable speed/pitch changes</span></label>
        <label className="settings-check"><input type="checkbox" checked={form.changerEnabled !== false} onChange={(e) => update('changerEnabled', e.target.checked)} disabled={!settings.canManage} /><span>Enable automatic record-changer queue</span></label>
      </div>

      {error && <div className="settings-warning"><AlertCircle /> {error}</div>}
      <footer className="settings-footer"><span>Settings are stored in NeedleDrop appdata, not in Navidrome.</span><button className="primary" onClick={save} disabled={busy || !settings.canManage}><Save size={17} /> {busy ? 'Saving…' : 'Save settings'}</button></footer>
    </section>
  </div>;
}
