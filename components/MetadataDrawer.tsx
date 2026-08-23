'use client';

import Image from 'next/image';
import { AlertTriangle, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AlbumDetail,
  AlbumLibraryRecord,
  CanonicalArtworkCandidate,
  VinylMeta,
} from './types';
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
  coverArtArchiveEnabled?: boolean;
  lastfmEnabled?: boolean;
  lastfmConfigured?: boolean;
  metadataSourceOrder?: string[];
  artworkSourceOrder?: string[];
  library?: AlbumLibraryRecord | null;
  artwork?: CanonicalArtworkCandidate[];
  metadataValues?: Array<Record<string, unknown>>;
  navidromeCoverArt?: string;
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
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [selectingPressingImage, setSelectingPressingImage] = useState<number | null>(null);
  const [savingRelease, setSavingRelease] = useState<number | null>(null);
  const [form, setForm] = useState<VinylMeta>(meta || {});
  const [error, setError] = useState('');

  useEffect(() => setForm(meta || {}), [meta]);
  useEffect(() => { if (open) void refresh(); }, [open, album.id]);

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

  async function refreshArtwork() {
    setArtworkBusy(true);
    setError('');
    const response = await fetch(`/api/artwork/${encodeURIComponent(album.id)}/refresh`, { method: 'POST' });
    const payload = await response.json().catch(() => ({}));
    setArtworkBusy(false);
    if (!response.ok) {
      setError(payload.error || 'Could not refresh artwork');
      return;
    }
    await refresh();
    window.dispatchEvent(new Event('needledrop:artwork-updated'));
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
    if (payload.meta) {
      setForm(payload.meta);
      onMeta(payload.meta);
    }
    await refresh();
    window.dispatchEvent(new Event('needledrop:artwork-updated'));
  }

  async function selectMusicBrainz(release: any) {
    const patch: Partial<VinylMeta> = {
      source: 'musicbrainz',
      pressingId: `musicbrainz:${release.id}`,
      pressingLabel: release['label-info']?.[0]?.label?.name || 'MusicBrainz vinyl',
      catalogNumber: release['label-info']?.[0]?.['catalog-number'],
      country: release.country,
      releaseYear: Number((release.date || '').slice(0, 4)) || undefined,
      musicbrainzReleaseId: release.id,
      musicbrainzReleaseGroupId: release['release-group']?.id,
    };
    await save(patch);
    await refresh();
  }

  async function chooseCanonicalArtwork(mode: 'auto' | 'navidrome' | 'candidate', candidateId?: number) {
    setError('');
    const response = await fetch(`/api/artwork/${encodeURIComponent(album.id)}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, candidateId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || 'Could not select artwork');
      return;
    }
    if (payload.meta) {
      setForm(payload.meta);
      onMeta(payload.meta);
    }
    await refresh();
    window.dispatchEvent(new Event('needledrop:artwork-updated'));
  }

  async function choosePressingArtwork(imageIndex: number) {
    setSelectingPressingImage(imageIndex);
    setError('');
    try {
      const response = await fetch(`/api/artwork/${encodeURIComponent(album.id)}/selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'pressing', imageIndex }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || 'Could not use this pressing image for the collection');
        return;
      }
      if (payload.meta) {
        setForm(payload.meta);
        onMeta(payload.meta);
      }
      await refresh();
      window.dispatchEvent(new Event('needledrop:artwork-updated'));
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Could not use this pressing image for the collection');
    } finally {
      setSelectingPressingImage(null);
    }
  }

  const dc = data?.discogs || [];
  const mb = data?.musicbrainz || [];
  const releaseUrl = meta ? discogsReleaseUrl(meta) : undefined;
  const library = data?.library;
  const pressingImages = form.images || data?.saved?.images || meta?.images || [];
  const frontArtwork = (data?.artwork || []).filter((candidate) => candidate.role === 'front' && candidate.remoteUrl);
  const otherCanonicalArtwork = frontArtwork.filter((candidate) => !(
    pressingImages.length && candidate.source === 'discogs' && /^discogs:[^:]+:\d+$/.test(candidate.sourceKey)
  ));
  const physicalSources = (data?.metadataSourceOrder || ['discogs', 'musicbrainz']).filter((source) => source === 'discogs' || source === 'musicbrainz');

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="drawer metadata-drawer" onClick={(event) => event.stopPropagation()}>
      <button className="drawer-x" onClick={onClose} aria-label="Close"><X /></button>
      <p className="eyebrow">PRESSING & DETAILS</p>
      <h2>{album.name}</h2>
      <p className="drawer-subtitle">{album.artist}</p>

      {error && <div className="settings-warning"><AlertTriangle /> {error}</div>}

      <section className="meta-block">
        <div className="meta-block-title"><h3>Your virtual copy</h3><span>These fields are authoritative local overrides in NeedleDrop.</span></div>
        <div className="meta-form">
          <label>Vinyl colour<input value={form.vinylColor || ''} onChange={(e) => setForm((value) => ({ ...value, vinylColor: e.target.value }))} placeholder="Black" /></label>
          <label>Condition<input value={form.condition || ''} onChange={(e) => setForm((value) => ({ ...value, condition: e.target.value }))} placeholder="NM" /></label>
          <label>Crate / shelf<input value={form.crate || ''} onChange={(e) => setForm((value) => ({ ...value, crate: e.target.value }))} placeholder="Main shelf" /></label>
          <label>Acquired<input type="date" value={form.acquiredAt || ''} onChange={(e) => setForm((value) => ({ ...value, acquiredAt: e.target.value }))} /></label>
          <label>My rating<select value={form.rating || 0} onChange={(e) => setForm((value) => ({ ...value, rating: Number(e.target.value) || undefined }))}><option value="0">Not rated</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label>
          <label className="wide">Notes<textarea value={form.notes || ''} onChange={(e) => setForm((value) => ({ ...value, notes: e.target.value }))} /></label>
          <button className="primary wide" onClick={() => save({ vinylColor: form.vinylColor, condition: form.condition, crate: form.crate, acquiredAt: form.acquiredAt, rating: form.rating, notes: form.notes })}>Save local details</button>
        </div>
      </section>

      {meta?.discogsReleaseId && <section className="meta-block selected-pressing">
        <div className="meta-block-title"><h3>Selected Discogs release</h3>{releaseUrl && <a href={releaseUrl} target="_blank" rel="noreferrer">Open on Discogs <ExternalLink size={14} /></a>}</div>
        <div className="pressing-facts"><strong>{meta.pressingLabel || 'Discogs release'}</strong><span>{[meta.country, meta.releaseYear, meta.catalogNumber, meta.formatDescription].filter(Boolean).join(' · ')}</span></div>
        {meta.trackMappingWarnings?.length ? <div className="mapping-warning"><AlertTriangle /><div><strong>Track mapping needs attention</strong>{meta.trackMappingWarnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}</div></div> : <div className="mapping-ok"><Check /> Discogs side positions map cleanly to the Navidrome files.</div>}
      </section>}

      <section className="meta-block">
        <div className="meta-block-title"><div><h3>Canonical album artwork</h3><span>Choose the cover NeedleDrop should use everywhere. A pinned image always wins.</span></div><button className="text-button" onClick={() => void refreshArtwork()} disabled={artworkBusy}><RefreshCw size={14} className={artworkBusy ? 'spin' : ''} /> {artworkBusy ? 'Resolving…' : 'Resolve again'}</button></div>

        {pressingImages.length > 0 && <>
          <p className="muted">Selected pressing artwork · choose any image below to make it the Collection cover.</p>
          <div className="artwork-picker canonical-artwork-picker">
            {pressingImages.map((image, index) => {
              const selected = form.artworkSource === 'discogs' && form.discogsImageIndex === index;
              const busy = selectingPressingImage === index;
              return <button key={`pressing-${index}`} className={selected ? 'selected' : ''} aria-pressed={selected} disabled={selectingPressingImage !== null} onClick={() => void choosePressingArtwork(index)}>
                <div><Image src={`/api/metadata/${encodeURIComponent(album.id)}/image/${index}`} alt={`${album.name} pressing artwork ${index + 1}`} fill sizes="130px" unoptimized /></div>
                <span>{selected ? 'Collection cover' : busy ? 'Applying…' : 'Use for collection'} · {image.type === 'primary' ? 'front' : `image ${index + 1}`}</span>
              </button>;
            })}
          </div>
        </>}

        <p className="muted">Automatic and alternate sources</p>
        <div className="artwork-picker canonical-artwork-picker">
          <button className={library?.artworkMode === 'auto' ? 'selected' : ''} onClick={() => chooseCanonicalArtwork('auto')}><div><Image src={cover(album.coverArt, 300)} alt="Automatic artwork" fill sizes="130px" unoptimized /></div><span>Auto · best source</span></button>
          {data?.navidromeCoverArt && <button className={library?.artworkMode === 'navidrome' ? 'selected' : ''} onClick={() => chooseCanonicalArtwork('navidrome')}><div><Image src={cover(data.navidromeCoverArt, 300)} alt="Navidrome artwork" fill sizes="130px" unoptimized /></div><span>Navidrome</span></button>}
          {otherCanonicalArtwork.map((candidate) => <button key={candidate.id} className={library?.artworkMode === 'candidate' && library.canonicalArtworkId === candidate.id ? 'selected' : ''} onClick={() => chooseCanonicalArtwork('candidate', candidate.id)}><div><Image src={`/api/artwork/candidate/${candidate.id}`} alt={`${candidate.source} artwork`} fill sizes="130px" unoptimized /></div><span>{candidate.source === 'coverartarchive' ? 'Cover Art Archive' : candidate.source} · {candidate.scope === 'release-group' ? 'album' : candidate.scope === 'library' ? 'library match' : 'exact release'}</span></button>)}
        </div>
        {!data?.navidromeCoverArt && !frontArtwork.length && !pressingImages.length && <p className="muted">No artwork candidates have been resolved yet. Use Resolve again or run a Library rescan.</p>}
      </section>

      {library && (library.lastfmTags?.length || library.lastfmSummary) && <section className="meta-block">
        <div className="meta-block-title"><h3>Last.fm context</h3>{library.lastfmUrl && <a href={library.lastfmUrl} target="_blank" rel="noreferrer">Open on Last.fm <ExternalLink size={14} /></a>}</div>
        {library.lastfmTags?.length ? <div className="metadata-tags">{library.lastfmTags.slice(0, 12).map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        {library.lastfmSummary && <p className="release-notes">{library.lastfmSummary}</p>}
        {(library.lastfmListeners || library.lastfmPlaycount) && <p className="muted">{library.lastfmListeners?.toLocaleString()} listeners · {library.lastfmPlaycount?.toLocaleString()} plays</p>}
      </section>}

      <section className="meta-block">
        <div className="meta-block-title"><h3>Find the physical release</h3><button className="text-button" onClick={refresh}><RefreshCw size={14} /> Refresh candidates</button></div>
        {loading ? <p className="muted">Searching Discogs and MusicBrainz…</p> : <div className="pressings">
          {physicalSources.flatMap((source) => source === 'discogs'
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
