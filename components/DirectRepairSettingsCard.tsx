'use client';

import { AlertTriangle, CheckCircle2, FolderInput, PlugZap, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

type Settings = {
  enabled: boolean;
  libraryPath: string;
};

type Payload = {
  settings?: Settings;
  canManage?: boolean;
  ok?: boolean;
  message?: string;
  error?: string;
};

export default function DirectRepairSettingsCard() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, libraryPath: '/music' });
  const [canManage, setCanManage] = useState(true);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    const response = await fetch('/api/nzb-direct-write', { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) return;
    const payload = await response.json() as Payload;
    if (payload.settings) setSettings(payload.settings);
    setCanManage(payload.canManage !== false);
  }

  async function test() {
    setBusy('test');
    setResult(null);
    const response = await fetch('/api/nzb-direct-write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test', libraryPath: settings.libraryPath }),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    setResult({ ok: response.ok, message: payload.message || payload.error || 'No response' });
  }

  async function save() {
    setBusy('save');
    setResult(null);
    const response = await fetch('/api/nzb-direct-write', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const payload = await response.json().catch(() => ({})) as Payload;
    setBusy('');
    if (!response.ok) {
      setResult({ ok: false, message: payload.error || 'Could not save direct repair settings' });
      return;
    }
    if (payload.settings) setSettings(payload.settings);
    setResult({ ok: true, message: settings.enabled ? 'Verified direct-write mode enabled.' : 'Direct-write mode disabled; isolated repair remains the default.' });
  }

  return <section className="library-manager-block direct-repair-settings-card">
    <div className="library-manager-heading">
      <div>
        <h3><FolderInput size={18} /> Verified direct album repair <span className="advanced-badge">Advanced</span></h3>
        <p>Optionally promote a repaired track into the album's existing Navidrome folder after a second, stricter metadata and duration verification pass.</p>
      </div>
      {settings.enabled && <span className="direct-write-enabled"><AlertTriangle size={15} /> Write access enabled</span>}
    </div>

    <div className="direct-repair-warning">
      <AlertTriangle size={19} />
      <div><strong>This lowers the library guardrail.</strong><span>The isolated repair folder is still used first. NeedleDrop will never overwrite an existing file, and any track that fails the stricter direct-write check stays isolated instead of being promoted.</span></div>
    </div>

    <div className="repair-form-grid">
      <label className="wide"><span>Main music library path in NeedleDrop</span><input value={settings.libraryPath} onChange={(event) => setSettings((current) => ({ ...current, libraryPath: event.target.value }))} placeholder="/music" disabled={!canManage} /><small>Mount the same host music root Navidrome scans at this path. If Navidrome reports relative song paths, NeedleDrop resolves them below this root; absolute paths must also remain inside it.</small></label>
    </div>

    <div className="repair-options-row direct-repair-options">
      <label className="direct-write-toggle"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} disabled={!canManage} /><span><strong>Allow verified writes to existing album folders</strong><small>This only makes the option available. Each repair still defaults to the isolated repair library unless you explicitly choose direct album repair.</small></span></label>
      <div className="lidarr-buttons"><button onClick={() => void test()} disabled={!canManage || busy !== ''}><PlugZap size={15} /> {busy === 'test' ? 'Testing…' : 'Test mount'}</button><button className="primary" onClick={() => void save()} disabled={!canManage || busy !== ''}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button></div>
    </div>

    <div className="repair-capabilities">
      <span><ShieldCheck size={14} /> Isolated copy first</span>
      <span><CheckCircle2 size={14} /> Strict title/tag/duration verification</span>
      <span><CheckCircle2 size={14} /> Existing files are never overwritten</span>
    </div>

    {result && <div className={`connection-result ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <CheckCircle2 /> : <AlertTriangle />}<span>{result.message}</span></div>}
  </section>;
}
