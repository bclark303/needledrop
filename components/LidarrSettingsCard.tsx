'use client';

import { AlertCircle, CheckCircle2, Download, PlugZap, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

type PublicSettings = {
  url: string;
  apiKeyConfigured: boolean;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
};
type Option = { id: number; name: string };
type Root = { id: number; path: string; defaultQualityProfileId?: number; defaultMetadataProfileId?: number };
type Payload = {
  settings?: PublicSettings;
  options?: { rootFolders: Root[]; qualityProfiles: Option[]; metadataProfiles: Option[] } | null;
  canManage?: boolean;
  message?: string;
  error?: string;
};

export default function LidarrSettingsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [rootFolderPath, setRootFolderPath] = useState('');
  const [qualityProfileId, setQualityProfileId] = useState<number | undefined>();
  const [metadataProfileId, setMetadataProfileId] = useState<number | undefined>();
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    const response = await fetch('/api/lidarr', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return;
    const payload = await response.json() as Payload;
    setData(payload);
    const settings = payload.settings;
    if (settings) {
      setUrl(settings.url || '');
      setRootFolderPath(settings.rootFolderPath || payload.options?.rootFolders?.[0]?.path || '');
      setQualityProfileId(settings.qualityProfileId);
      setMetadataProfileId(settings.metadataProfileId);
    }
  }

  async function test() {
    setBusy('test');
    setResult(null);
    const response = await fetch('/api/lidarr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test', url, apiKey }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    setResult({ ok: response.ok, message: payload.message || payload.error || 'No response' });
  }

  async function save() {
    setBusy('save');
    setResult(null);
    const response = await fetch('/api/lidarr', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        rootFolderPath,
        qualityProfileId,
        metadataProfileId,
      }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    if (!response.ok) {
      setResult({ ok: false, message: payload.error || 'Could not save Lidarr settings' });
      return;
    }
    setApiKey('');
    setData(payload);
    setResult({ ok: true, message: 'Lidarr settings saved.' });
    await load();
  }

  const settings = data?.settings;
  const options = data?.options;
  const canManage = data?.canManage !== false;
  return <section className="library-manager-block lidarr-settings-card">
    <div className="library-manager-heading"><div><h3><Download size={18} /> Lidarr gap filling</h3><p>When a selected physical release is missing tracks, NeedleDrop can ask Lidarr to find a suitable album release, then automatically rescan Navidrome after new audio is imported.</p></div>{settings?.apiKeyConfigured && <span className="lidarr-connected"><CheckCircle2 size={15} /> Configured</span>}</div>

    <div className="lidarr-form">
      <label><span>Lidarr URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://192.168.1.50:8686" disabled={!canManage} /></label>
      <label><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.apiKeyConfigured ? 'Configured — enter a new key to replace it' : 'Lidarr API key'} disabled={!canManage} /></label>
      <div className="lidarr-buttons"><button onClick={() => void test()} disabled={!canManage || busy !== ''}><PlugZap size={15} /> {busy === 'test' ? 'Testing…' : 'Test'}</button><button className="primary" onClick={() => void save()} disabled={!canManage || busy !== ''}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button></div>
    </div>

    {options && <div className="lidarr-options">
      <label><span>Root folder</span><select value={rootFolderPath} onChange={(event) => setRootFolderPath(event.target.value)} disabled={!canManage}>{options.rootFolders.map((root) => <option key={root.id} value={root.path}>{root.path}</option>)}</select></label>
      <label><span>Quality profile</span><select value={qualityProfileId || ''} onChange={(event) => setQualityProfileId(Number(event.target.value) || undefined)} disabled={!canManage}><option value="">Use root-folder default</option>{options.qualityProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <label><span>Metadata profile</span><select value={metadataProfileId || ''} onChange={(event) => setMetadataProfileId(Number(event.target.value) || undefined)} disabled={!canManage}><option value="">Use root-folder default</option>{options.metadataProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
    </div>}

    {result && <div className={`connection-result ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <CheckCircle2 /> : <AlertCircle />}<span>{result.message}</span></div>}
    {!settings?.apiKeyConfigured && <p className="muted">NeedleDrop never exposes the Lidarr API key back to the browser after it is stored.</p>}
  </section>;
}
