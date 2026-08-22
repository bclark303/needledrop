'use client';

import { AlertCircle, CheckCircle2, PlugZap, Save, Search, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';

type Provider = 'newznab' | 'nzbhydra2' | 'prowlarr';
type Settings = {
  provider: Provider;
  indexerUrl: string;
  indexerApiKeyConfigured: boolean;
  categories: string;
  sabUrl: string;
  sabApiKeyConfigured: boolean;
  sabCategory: string;
  stagingPath: string;
  importPath: string;
  cleanupStaging: boolean;
  preferLossless: boolean;
};
type Payload = {
  settings?: Settings;
  canManage?: boolean;
  ok?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
};

export default function NzbRepairSettingsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [provider, setProvider] = useState<Provider>('newznab');
  const [indexerUrl, setIndexerUrl] = useState('');
  const [indexerApiKey, setIndexerApiKey] = useState('');
  const [categories, setCategories] = useState('3000,3040');
  const [sabUrl, setSabUrl] = useState('');
  const [sabApiKey, setSabApiKey] = useState('');
  const [sabCategory, setSabCategory] = useState('needledrop-repair');
  const [stagingPath, setStagingPath] = useState('/repair');
  const [importPath, setImportPath] = useState('/music-repair');
  const [cleanupStaging, setCleanupStaging] = useState(true);
  const [preferLossless, setPreferLossless] = useState(true);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    const response = await fetch('/api/nzb-repair', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return;
    const payload = await response.json() as Payload;
    setData(payload);
    const settings = payload.settings;
    if (!settings) return;
    setProvider(settings.provider);
    setIndexerUrl(settings.indexerUrl || '');
    setCategories(settings.categories || '3000,3040');
    setSabUrl(settings.sabUrl || '');
    setSabCategory(settings.sabCategory || 'needledrop-repair');
    setStagingPath(settings.stagingPath || '/repair');
    setImportPath(settings.importPath || '/music-repair');
    setCleanupStaging(settings.cleanupStaging !== false);
    setPreferLossless(settings.preferLossless !== false);
  }

  function body() {
    return {
      provider,
      indexerUrl,
      ...(indexerApiKey.trim() ? { indexerApiKey: indexerApiKey.trim() } : {}),
      categories,
      sabUrl,
      ...(sabApiKey.trim() ? { sabApiKey: sabApiKey.trim() } : {}),
      sabCategory,
      stagingPath,
      importPath,
      cleanupStaging,
      preferLossless,
    };
  }

  async function test() {
    setBusy('test');
    setResult(null);
    const response = await fetch('/api/nzb-repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test', ...body() }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    setResult({ ok: response.ok, message: payload.message || payload.error || 'No response' });
  }

  async function save() {
    setBusy('save');
    setResult(null);
    const response = await fetch('/api/nzb-repair', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    if (!response.ok) {
      setResult({ ok: false, message: payload.error || 'Could not save NZB repair settings' });
      return;
    }
    setIndexerApiKey('');
    setSabApiKey('');
    setData(payload);
    setResult({ ok: true, message: 'NZB Track Repair settings saved.' });
    await load();
  }

  const settings = data?.settings;
  const canManage = data?.canManage !== false;
  const configured = settings?.indexerApiKeyConfigured && settings?.sabApiKeyConfigured;

  return <section className="library-manager-block nzb-repair-settings-card">
    <div className="library-manager-heading">
      <div>
        <h3><Wrench size={18} /> NZB Track Repair <span className="preferred-badge">Preferred</span></h3>
        <p>Inspect album NZBs before downloading, let SABnzbd unpack the best candidate, keep only the missing songs, then rescan Navidrome. Use only with material you are authorized to retrieve.</p>
      </div>
      {configured && <span className="lidarr-connected"><CheckCircle2 size={15} /> Configured</span>}
    </div>

    <div className="repair-setup-note">
      <strong>One-time SAB setup</strong>
      <span>Create a SABnzbd category named <code>{sabCategory || 'needledrop-repair'}</code>. Give that category its own completed folder, keep normal repair/unpack enabled, and mount that folder into NeedleDrop at <code>{stagingPath || '/repair'}</code>. Mount a dedicated folder inside your Navidrome music tree at <code>{importPath || '/music-repair'}</code> with write access.</span>
    </div>

    <div className="repair-form-grid">
      <label><span>Search provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)} disabled={!canManage}><option value="newznab">Direct Newznab indexer</option><option value="nzbhydra2">NZBHydra2</option><option value="prowlarr">Prowlarr</option></select></label>
      <label className="wide"><span>{provider === 'prowlarr' ? 'Prowlarr URL' : provider === 'nzbhydra2' ? 'NZBHydra2 URL / API endpoint' : 'Newznab API URL'}</span><input value={indexerUrl} onChange={(event) => setIndexerUrl(event.target.value)} placeholder={provider === 'prowlarr' ? 'http://192.168.1.50:9696' : 'https://example.invalid/api'} disabled={!canManage} /></label>
      <label><span>Indexer API key</span><input type="password" value={indexerApiKey} onChange={(event) => setIndexerApiKey(event.target.value)} placeholder={settings?.indexerApiKeyConfigured ? 'Configured — enter to replace' : 'API key'} disabled={!canManage} /></label>
      <label><span>Audio categories</span><input value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="3000,3040" disabled={!canManage} /></label>
      <label className="wide"><span>SABnzbd URL</span><input value={sabUrl} onChange={(event) => setSabUrl(event.target.value)} placeholder="http://192.168.1.50:8080" disabled={!canManage} /></label>
      <label><span>SAB API key</span><input type="password" value={sabApiKey} onChange={(event) => setSabApiKey(event.target.value)} placeholder={settings?.sabApiKeyConfigured ? 'Configured — enter to replace' : 'SAB API key'} disabled={!canManage} /></label>
      <label><span>SAB repair category</span><input value={sabCategory} onChange={(event) => setSabCategory(event.target.value)} placeholder="needledrop-repair" disabled={!canManage} /></label>
      <label><span>Staging path in NeedleDrop</span><input value={stagingPath} onChange={(event) => setStagingPath(event.target.value)} placeholder="/repair" disabled={!canManage} /></label>
      <label><span>Navidrome repair import path</span><input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="/music-repair" disabled={!canManage} /></label>
    </div>

    <div className="repair-options-row">
      <label><input type="checkbox" checked={preferLossless} onChange={(event) => setPreferLossless(event.target.checked)} disabled={!canManage} /><span>Prefer FLAC/lossless candidates</span></label>
      <label><input type="checkbox" checked={cleanupStaging} onChange={(event) => setCleanupStaging(event.target.checked)} disabled={!canManage} /><span>Delete temporary album after requested tracks are retained</span></label>
      <div className="lidarr-buttons"><button onClick={() => void test()} disabled={!canManage || busy !== ''}><PlugZap size={15} /> {busy === 'test' ? 'Testing…' : 'Test everything'}</button><button className="primary" onClick={() => void save()} disabled={!canManage || busy !== ''}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button></div>
    </div>

    <div className="repair-capabilities">
      <span><Search size={14} /> Direct Newznab, NZBHydra2 and Prowlarr</span>
      <span><CheckCircle2 size={14} /> NZB manifest filename inspection</span>
      <span><CheckCircle2 size={14} /> Embedded audio-tag verification after unpack</span>
    </div>

    {result && <div className={`connection-result ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <CheckCircle2 /> : <AlertCircle />}<span>{result.message}</span></div>}
    {configured && <p className="muted">Indexer and SAB API keys stay server-side and are never returned to the browser.</p>}
  </section>;
}
