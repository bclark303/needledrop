import { APP_VERSION } from '@/lib/version';
import type { AlbumDetail, ArtworkSource, Song, VinylMeta, TurntableSpeed } from './types';

export type PlaybackSide = { label: string; songs: Song[] };
export type SideRow = { position: string; title: string; duration?: string; song?: Song };
export type DisplaySide = { label: string; rows: SideRow[] };

export function cover(id?: string, size = 500) {
  if (!id) return '/needledrop-icon.svg';
  if (id.startsWith('nd:')) return `/api/artwork/${encodeURIComponent(id.slice(3))}?size=${size}&app=${encodeURIComponent(APP_VERSION)}`;
  return `/api/cover/${encodeURIComponent(id)}?size=${size}`;
}

export function fmt(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fallbackSplit(album: AlbumDetail, meta: VinylMeta | null) {
  if (meta?.sideBreakAfterTrack) return meta.sideBreakAfterTrack;
  const songs = album.song || [];
  const half = songs.reduce((a, song) => a + (song.duration || 0), 0) / 2;
  let sum = 0;
  let best = 1;
  let bestDiff = Infinity;
  songs.forEach((song, index) => {
    sum += song.duration || 0;
    const diff = Math.abs(sum - half);
    if (diff < bestDiff && index < songs.length - 1) {
      best = index + 1;
      bestDiff = diff;
    }
  });
  return best;
}

export function buildPlaybackSides(album: AlbumDetail, meta: VinylMeta | null): PlaybackSide[] {
  const exact = meta?.sides || [];
  if (exact.length) {
    const byId = new Map(album.song.map((song) => [song.id, song]));
    // Once a physical release is selected it defines the record. Missing tracks
    // remain visibly missing instead of making NeedleDrop silently fall back to
    // a generic two-side split of the digital album.
    return exact.map((side) => ({
      label: side.label,
      songs: side.tracks
        .map((track) => (track.navidromeSongId ? byId.get(track.navidromeSongId) : undefined))
        .filter(Boolean) as Song[],
    }));
  }

  const split = fallbackSplit(album, meta);
  return [
    { label: 'A', songs: album.song.slice(0, split) },
    { label: 'B', songs: album.song.slice(split) },
  ].filter((side) => side.songs.length);
}

export function buildDisplaySides(album: AlbumDetail, meta: VinylMeta | null, playback: PlaybackSide[]): DisplaySide[] {
  if (meta?.sides?.length) {
    const byId = new Map(album.song.map((song) => [song.id, song]));
    return meta.sides.map((side) => ({
      label: side.label,
      rows: side.tracks.map((track) => ({
        position: track.position,
        title: track.title,
        duration: track.duration,
        song: track.navidromeSongId ? byId.get(track.navidromeSongId) : undefined,
      })),
    }));
  }
  return playback.map((side) => ({
    label: side.label,
    rows: side.songs.map((song, index) => ({
      position: `${side.label}${index + 1}`,
      title: song.title,
      duration: song.duration ? fmt(song.duration) : undefined,
      song,
    })),
  }));
}

export function selectedReleaseImage(meta: VinylMeta | null, album: AlbumDetail, artworkOrder: ArtworkSource[] = ['discogs', 'coverartarchive', 'navidrome']) {
  const explicit = meta?.artworkSource;
  const requested = Number.isInteger(meta?.discogsImageIndex) ? meta!.discogsImageIndex! : -1;

  // A specifically selected image from an exact Discogs release can be served
  // directly. Other pinned candidates (including Discogs search fallbacks)
  // should go through the canonical /api/artwork route instead.
  if (explicit === 'discogs' && requested >= 0 && meta?.images?.[requested]?.uri) {
    return `/api/metadata/${encodeURIComponent(album.id)}/image/${requested}`;
  }

  if (!explicit && artworkOrder[0] === 'discogs' && meta?.images?.length) {
    const primaryIndex = meta.images.findIndex((image) => image.type === 'primary' && image.uri);
    const firstIndex = meta.images.findIndex((image) => image.uri);
    const index = primaryIndex >= 0 ? primaryIndex : firstIndex;
    if (index >= 0) return `/api/metadata/${encodeURIComponent(album.id)}/image/${index}`;
  }

  return cover(album.coverArt, 1000);
}

export function nominalSpeed(meta?: VinylMeta | null): TurntableSpeed {
  const format = meta?.formatDescription?.toLowerCase() || '';
  if (/\b78\s*rpm\b/.test(format)) return 78;
  if (/\b45\s*rpm\b/.test(format)) return 45;
  return 33.333;
}

export function transitionText(from?: string, to?: string) {
  if (!from || !to) return `Continue to Side ${to || ''}`;
  const fromIndex = /^[A-Z]$/.test(from) ? from.charCodeAt(0) - 65 : -1;
  const toIndex = /^[A-Z]$/.test(to) ? to.charCodeAt(0) - 65 : -1;
  if (fromIndex >= 0 && toIndex === fromIndex + 1) {
    return fromIndex % 2 === 0 ? `Flip to Side ${to}` : `Change record · Side ${to}`;
  }
  return `Continue to Side ${to}`;
}
