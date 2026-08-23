import type { VinylMeta } from '@/components/types';
import { fetchCachedExternalArtwork } from '@/lib/artwork-cache';
import { orderedArtworkChoices } from '@/lib/artwork-resolution';
import { getAlbumMetaJson, getAlbumRecord } from '@/lib/db';
import { getStoredSettings } from '@/lib/settings';
import { backfillArtworkCandidatesFromMeta } from '@/lib/store';
import { mediaUrl } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const settings = await getStoredSettings();
    const album = getAlbumRecord(id);
    const legacyMeta = getAlbumMetaJson<VinylMeta>(id);
    const size = new URL(request.url).searchParams.get('size') || '1000';

    // Keep the canonical artwork table self-healing. This also recovers very old
    // saved Discogs image metadata that predates persisted Discogs release ids.
    backfillArtworkCandidatesFromMeta(id, legacyMeta);
    const choices = orderedArtworkChoices(id, settings.artworkSourceOrder);

    for (const choice of choices) {
      if (choice.kind === 'candidate' && choice.artwork.remoteUrl) {
        const response = await fetchCachedExternalArtwork(choice.artwork.remoteUrl, settings.musicbrainzUserAgent, settings.discogsToken);
        if (response) return response;
      }

      if (choice.kind === 'navidrome' && album?.navidromeCoverArt) {
        const url = await mediaUrl('getCoverArt', album.navidromeCoverArt, { size });
        const response = await fetch(url, { cache: 'no-store' }).catch(() => null);
        if (response?.ok && response.body) return imageResponse(response, 3600, 'navidrome');
      }
    }

    // Resolver-level compatibility fallback. Album view has historically been
    // able to render meta.images directly; Collection view should never lose a
    // usable saved cover merely because canonical migration metadata is sparse.
    for (const value of legacyArtworkUrls(legacyMeta)) {
      const response = await fetchCachedExternalArtwork(value, settings.musicbrainzUserAgent, settings.discogsToken);
      if (response) return response;
    }

    return placeholderResponse(album?.artist, album?.title);
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') return new Response('UNAUTHENTICATED', { status: 401 });
    const album = getAlbumRecord(id);
    return placeholderResponse(album?.artist, album?.title);
  }
}

function legacyArtworkUrls(meta?: VinylMeta | null) {
  if (!meta?.images?.length) return [];
  const images = meta.images;
  const ordered = [...images.keys()];
  const selected = Number.isInteger(meta.discogsImageIndex) ? Number(meta.discogsImageIndex) : -1;
  const primary = images.findIndex((image) => image.type === 'primary');
  const preferred = [selected, primary, 0, ...ordered]
    .filter((index, position, list) => index >= 0 && index < images.length && list.indexOf(index) === position);
  const urls: string[] = [];
  for (const index of preferred) {
    const image = images[index];
    for (const value of [image?.uri, image?.uri150]) {
      if (value && !urls.includes(value)) urls.push(value);
    }
  }
  return urls;
}

function imageResponse(response: Response, maxAge: number, source: string) {
  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  if (contentType) headers.set('content-type', contentType);
  if (contentLength) headers.set('content-length', contentLength);
  headers.set('cache-control', `private, max-age=${maxAge}`);
  headers.set('x-needledrop-artwork-source', source);
  headers.set('x-needledrop-artwork-cache', 'passthrough');
  return new Response(response.body, { status: 200, headers });
}

function placeholderResponse(artist = 'Unknown artist', title = 'Artwork unavailable') {
  const titleLines = wrap(title, 22, 3);
  const artistLines = wrap(artist, 28, 2);
  const titleSvg = titleLines.map((line, index) => `<text x="72" y="${690 + index * 66}" class="title">${escapeXml(line)}</text>`).join('');
  const artistLinesSvg = artistLines.map((line, index) => `<text x="74" y="${885 + index * 38}" class="artist">${escapeXml(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <defs>
    <radialGradient id="record" cx="48%" cy="42%" r="58%"><stop offset="0" stop-color="#34312b"/><stop offset="0.3" stop-color="#11100e"/><stop offset="0.72" stop-color="#24211d"/><stop offset="1" stop-color="#090908"/></radialGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2a241e"/><stop offset="1" stop-color="#151310"/></linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#paper)"/>
  <rect x="32" y="32" width="936" height="936" rx="12" fill="none" stroke="#695b4b" stroke-width="2"/>
  <circle cx="500" cy="330" r="245" fill="url(#record)" stroke="#080807" stroke-width="8"/>
  <circle cx="500" cy="330" r="86" fill="#b46f56"/>
  <circle cx="500" cy="330" r="12" fill="#171411"/>
  <g fill="none" stroke="#4b4640" opacity="0.45"><circle cx="500" cy="330" r="216"/><circle cx="500" cy="330" r="198"/><circle cx="500" cy="330" r="180"/><circle cx="500" cy="330" r="162"/><circle cx="500" cy="330" r="144"/></g>
  <text x="72" y="610" class="mark">NEEDLEDROP · ARTWORK NOT FOUND</text>
  ${titleSvg}
  ${artistLinesSvg}
  <style>.mark{fill:#a99b88;font:600 24px ui-sans-serif,system-ui,sans-serif;letter-spacing:4px}.title{fill:#f0e5d2;font:700 52px Georgia,serif}.artist{fill:#c9b9a2;font:400 28px ui-sans-serif,system-ui,sans-serif;letter-spacing:1px}</style>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-needledrop-artwork-source': 'placeholder',
      'x-needledrop-artwork-cache': 'none',
    },
  });
}

function wrap(value: string, max: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max || !current) current = next;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(' ').length > lines.join(' ').length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, '')}…`;
  return lines;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] || character));
}
