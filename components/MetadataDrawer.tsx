'use client';

import Image from 'next/image';
import { AlertTriangle, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AlbumDetail, VinylMeta } from './types';
import { cover } from './vinyl';

type DiscogsSearchResult = {
  id: number;
  title?: string;
  country?: string;
  year?: number;
  label?: string[];
  catno?: string;
  format?: string[];
  thumb?: string;
  cover_image?: string;
};

type MetadataResponse = {
  saved?: VinylMeta | null;
  musicbrainz?: Array<Record<string, any>>;
  discogs?: DiscogsSearchResult[];
  discogsConfigured?: boolean;
  musicbrainzEnabled?: boolean;
  metadataSourceOrder?: string[];
  artworkSourceOrder?: string[];
};

function discogsReleaseUrl(meta: VinylMeta) {
  if (!meta.discogsUri) return undefined;
  if (/^https?:\/\//i.test(meta.discogsUri)) return meta.discogsUri;
  return `https://www.discogs.com${meta.discogsUri.startsWith('/') ? meta.discogsUri : `/${meta.discogsUri}`}`;
}

export default function MetadataDrawer({
  album,
  meta,
  open,
  onClose,
  onMeta,
}: {
  album: AlbumDetail;
  meta: VinylMeta | null;
  open: boolean;
  onClose: () => void;
  onMeta: (meta: VinylMeta) => void;
}) {
  const [data, setData] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingRelease, setSavingRelease] = useState<number | null>(null);
  const [form, setForm] = useState<VinylMeta>(meta || {});
  const [error, setError] = useState('');

  useEffect(() => setForm(meta || {}), [meta]);
  useEffect(() => { if (open) refresh(); }, [open, album.id]);

  if (!open) return null;

  async function refresh() {
    setLoading(true);
    setError('');
    const response = await fetch(`/api/metadata/${encodeURIComponent(album.id)}`);
    const payload = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) setError(payload.error || 'Metadata lookup failed');
    else setData(payload);
  }

  async function save(patch: Partial<VinylMeta>) {
    const response = await fetch(`/api/metadata/${encodeURIComponent(album.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not save metadata');
    setForm(payload.meta);
    onMeta(payload.meta);
    return payload.meta as VinylMeta;
  }

  async function selectDiscogs(releaseId: number) {
    setSavingRelease(releaseId);
    setError('');
    const response = await fetch(`/api/metadata/${encodeURIComponent(album.id)}/discogs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId }),
    });
    const payload = await response.json().catch(() => ({}));
    setSavingRelease(null);
    if (!response.ok) {
      setError(payload.error || 'Could not load the Discogs release');
      return;
    }
    setForm(payload.meta);
    onMeta(payload.meta);
    await refresh();
  }

  async function selectMusicBrainz(release: any) {
    const patch: Partial<VinylMeta> = {
      source: 'musicbrainz',
      pressingId: `musicbrainz:${release.id}`,
      pressingLabel: release['label-info']?.[0]?.label?.name || 'MusicBrainz vinyl',
      catalogNumber: release['label-info']?.[0]?.['catalog-number'],
      country: release.country,
      releaseYear: Number((release.date || '').slice(0, 4)) || undefined,
    };
    await save(patch);
  }

  async function chooseArtwork(source: 'navidrome' | 'discogs', index?: number) {
    await save({ artworkSource: source, discogsImageIndex: source === 'discogs' ? index : undefined });
  }

  const dc = data?.discogs || [];
  const mb = data?.musicbrainz || [];
  const releaseUrl = meta ? discogsReleaseUrl(meta) : undefined;

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="drawer metadata-drawer" onClick={(event) => event.stopPropagation()}>
      <button className="drawer-x" onClick={onClose} aria-label="Close"><X /></button>
      <p className="eyebrow">PRESSING & DETAILS</p>
      <h2>{album.name}</h2>
      <p className="drawer-subtitle">{album.artist}</p>

      {error && <div className="settings-warning"><AlertTriangle /> {error}</div>}

      <section className="meta-block">
        <div className="meta-block-title"><h3>Your virtual copy</h3><span>These fields are local to NeedleDrop.</span></div>
        <div className="meta-form">
          <label>Vinyl colour<input value={form.vinylColor || ''} onChange={(e) => setForm((value) => ({ ...value, vinylColor: e.target.value }))} placeholder="Black" /></label>
          <label>Condition<input value={form.condition || ''} onChange={(e) => setForm((value) => ({ ...value, condition: e.target.value }))} placeholder="NM" /></label>
          <label>Crate / shelf<input value={form.crate || ''} onChange={(e) => setForm((value) => ({ ...value, crate: e.target.value }))} placeholder="Main shelf" /></label>
          <label>Acquired<input type="date" value={form.acquiredAt || ''} onChange={(e) => setForm((value) => ({ ...value, acquiredAt: e.target.value }))} /></label>
          <label className="wide">Notes<textarea value={form.notes || ''} onChange={(e) => setForm((value) => ({ ...value, notes: e.target.value }))} /></label>
          <button className="primary wide" onClick={() => save({ vinylColor: form.vinylColor, condition: form.condition, crate: form.crate, acquiredAt: form.acquiredAt, notes: form.notes })}>Save local details</button>
        </div>
      </section>

      {meta?.discogsReleaseId && <section className="meta-block selected-pressing">
        <div className="meta-block-title"><h3>Selected Discogs release</h3>{releaseUrl && <a href={releaseUrl} target="_blank" rel="noreferrer">Open on Discogs <ExternalLink size={14} /></a>}</div>
        <div className="pressing-facts"><strong>{meta.pressingLabel || 'Discogs release'}</strong><span>{[meta.country, meta.releaseYear, meta.catalogNumber, meta.formatDescription].filter(Boolean).join(' · ')}</span></div>
        {meta.trackMappingWarnings?.length ? <div className="mapping-warning"><AlertTriangle /><div><strong>Track mapping needs attention</strong>{meta.trackMappingWarnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}</div></div> : <div className="mapping-ok"><Check /> Discogs side positions map cleanly to the Navidrome files.</div>}
      </section>}

      <section className="meta-block">
        <div className="meta-block-title"><h3>Album artwork</h3><span>Choose Navidrome art or an image from the selected Discogs release.</span></div>
        <div className="artwork-picker">
          <button className={meta?.artworkSource === 'navidrome' ? 'selected' : ''} onClick={() => chooseArtwork('navidrome')}><div><Image src={cover(album.coverArt, 300)} alt="Navidrome cover" fill sizes="130px" unoptimized /></div><span>Navidrome</span></button>
          {(meta?.images || []).map((image, index) => image.uri ? <button key={`${image.uri}-${index}`} className={meta.artworkSource !== 'navidrome' && meta.discogsImageIndex === index ? 'selected' : ''} onClick={() => chooseArtwork('discogs', index)}><div><Image src={`/api/metadata/${encodeURIComponent(album.id)}/image/${index}`} alt={`Discogs image ${index + 1}`} fill sizes="130px" unoptimized /></div><span>{image.type || `Discogs ${index + 1}`}</span></button> : null)}
        </div>
      </section>

      <section className="meta-block">
        <div className="meta-block-title"><h3>Find the physical release</h3><button className="text-button" onClick={refresh}><RefreshCw size={14} /> Refresh</button></div>
        {loading ? <p className="muted">Searching Discogs and MusicBrainz…</p> : <div className="pressings">
          {(data?.metadataSourceOrder || ['discogs', 'musicbrainz']).flatMap((source) => source === 'discogs'
            ? dc.map((release) => <button key={`d${release.id}`} className={meta?.discogsReleaseId === release.id ? 'selected' : ''} onClick={() => selectDiscogs(release.id)} disabled={savingRelease !== null}><strong>{release.title}</strong><span>{[release.country, release.year, release.label?.[0], release.catno, release.format?.join(', ')].filter(Boolean).join(' · ')}</span><em>{savingRelease === release.id ? 'Loading exact release…' : 'Discogs'}</em></button>)
            : mb.map((release: any) => <button key={`m${release.id}`} onClick={() => selectMusicBrainz(release)}><strong>{release.title}</strong><span>{[release.country, release.date, release['label-info']?.[0]?.label?.name, release['label-info']?.[0]?.['catalog-number']].filter(Boolean).join(' · ')}</span><em>MusicBrainz</em></button>))}
          {!dc.length && !mb.length && <p>No matching vinyl releases were returned. Check Connections in Settings or keep the local details above.</p>}
        </div>}
      </section>

      {meta?.releaseNotes && <section className="meta-block"><div className="meta-block-title"><h3>Discogs release notes</h3></div><p className="release-notes">{meta.releaseNotes}</p></section>}
      {meta?.credits?.length ? <section className="meta-block"><div className="meta-block-title"><h3>Credits</h3></div><div className="credits-grid">{meta.credits.slice(0, 80).map((credit, index) => <div key={`${credit.name}-${credit.role}-${index}`}><strong>{credit.name}</strong><span>{credit.role}{credit.tracks ? ` · ${credit.tracks}` : ''}</span></div>)}</div></section> : null}
    </aside>
  </div>;
}
