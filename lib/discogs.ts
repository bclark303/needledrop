import type {
  DiscogsCredit,
  DiscogsIdentifier,
  DiscogsSide,
  DiscogsTrack,
  Song,
  VinylMeta,
} from '@/components/types';
import { getDiscogsConfig } from './settings';

const API = 'https://api.discogs.com';
type DiscogsRelease = Record<string, any>;

export async function discogsConfigured() {
  const config = await getDiscogsConfig();
  return config.enabled && Boolean(config.token);
}

async function request(path: string, params?: URLSearchParams, cache: RequestCache = 'no-store') {
  const config = await getDiscogsConfig();
  if (!config.enabled || !config.token) throw new Error('DISCOGS_NOT_CONFIGURED');
  const url = new URL(path, API);
  if (params) params.forEach((value, key) => url.searchParams.append(key, value));
  const response = await fetch(url, {
    headers: {
      'User-Agent': config.userAgent,
      Authorization: `Discogs token=${config.token}`,
      Accept: 'application/vnd.discogs.v2.discogs+json',
    },
    cache,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Discogs ${response.status}${message ? `: ${message.slice(0, 180)}` : ''}`);
  }
  return response.json();
}

export async function searchDiscogs(artist: string, title: string) {
  if (!(await discogsConfigured())) return [];
  const params = new URLSearchParams({
    type: 'release',
    format: 'vinyl',
    artist,
    release_title: title,
    per_page: '30',
  });
  const data = await request('/database/search', params);
  return data.results || [];
}

export async function getDiscogsRelease(releaseId: number): Promise<DiscogsRelease> {
  return request(`/releases/${releaseId}`);
}

export async function testDiscogsConnection(tokenOverride?: string) {
  const current = await getDiscogsConfig();
  const token = tokenOverride?.trim() || current.token;
  if (!token) throw new Error('Discogs token is not configured');
  const response = await fetch(`${API}/oauth/identity`, {
    headers: {
      'User-Agent': current.userAgent,
      Authorization: `Discogs token=${token}`,
      Accept: 'application/vnd.discogs.v2.discogs+json',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Discogs HTTP ${response.status}`);
  return response.json();
}

function normalizedTitle(value = '') {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(a = '', b = '') {
  const left = normalizedTitle(a);
  const right = normalizedTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const l = new Set(left.split(' ').filter(Boolean));
  const r = new Set(right.split(' ').filter(Boolean));
  const intersection = [...l].filter((x) => r.has(x)).length;
  const union = new Set([...l, ...r]).size || 1;
  return intersection / union;
}

function seconds(value?: string) {
  if (!value) return undefined;
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

function durationScore(discogs?: string, navidrome?: number) {
  const a = seconds(discogs);
  if (!a || !navidrome) return 0.5;
  const diff = Math.abs(a - navidrome);
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.85;
  if (diff <= 15) return 0.6;
  if (diff <= 30) return 0.35;
  return 0;
}

function sideLabel(position = '') {
  const match = position.trim().toUpperCase().match(/^([A-Z]+)(?=\d|[.-]?\d|$)/);
  return match?.[1];
}

function physicalTracks(release: DiscogsRelease): DiscogsTrack[] {
  return (release.tracklist || [])
    .filter((track: any) => track?.type_ !== 'heading' && track?.title)
    .map((track: any) => ({
      position: String(track.position || '').trim(),
      title: String(track.title || '').trim(),
      duration: track.duration || undefined,
      type: track.type_ || 'track',
    }));
}

function mapTracks(tracks: DiscogsTrack[], songs: Song[]) {
  const warnings: string[] = [];
  const mapped = tracks.map((track) => ({ ...track }));
  const unused = new Set(songs.map((_, index) => index));

  if (mapped.length === songs.length) {
    mapped.forEach((track, index) => {
      const song = songs[index];
      track.navidromeSongId = song.id;
      track.navidromeIndex = index;
      if (titleScore(track.title, song.title) < 0.3) warnings.push(`${track.position || index + 1}: “${track.title}” matched by order to “${song.title}”.`);
      unused.delete(index);
    });
  } else {
    mapped.forEach((track, discogsIndex) => {
      let bestIndex = -1;
      let bestScore = -1;
      for (const navIndex of unused) {
        const song = songs[navIndex];
        const proximity = 1 - Math.min(Math.abs(navIndex - discogsIndex), 8) / 10;
        const score = titleScore(track.title, song.title) * 0.68 + durationScore(track.duration, song.duration) * 0.22 + proximity * 0.1;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = navIndex;
        }
      }
      if (bestIndex >= 0 && bestScore >= 0.42) {
        const song = songs[bestIndex];
        track.navidromeSongId = song.id;
        track.navidromeIndex = bestIndex;
        unused.delete(bestIndex);
      } else {
        warnings.push(`${track.position || discogsIndex + 1}: “${track.title}” could not be confidently mapped to a Navidrome track.`);
      }
    });
  }

  if (unused.size) {
    const names = [...unused].map((i) => songs[i]?.title).filter(Boolean);
    warnings.push(`${unused.size} Navidrome track${unused.size === 1 ? '' : 's'} not present in the selected Discogs tracklist${names.length ? `: ${names.join(', ')}` : ''}.`);
  }

  return { tracks: mapped, warnings };
}

function groupSides(tracks: DiscogsTrack[]): DiscogsSide[] {
  const groups = new Map<string, DiscogsTrack[]>();
  for (const track of tracks) {
    const label = sideLabel(track.position) || 'Other';
    const existing = groups.get(label) || [];
    existing.push(track);
    groups.set(label, existing);
  }
  return [...groups.entries()].map(([label, sideTracks]) => ({ label, tracks: sideTracks }));
}

function releaseCredits(release: DiscogsRelease): DiscogsCredit[] {
  const credits: DiscogsCredit[] = [];
  for (const credit of release.extraartists || []) credits.push({ name: credit.anv || credit.name, role: credit.role, tracks: credit.tracks || undefined });
  for (const track of release.tracklist || []) {
    for (const credit of track.extraartists || []) credits.push({ name: credit.anv || credit.name, role: credit.role, tracks: track.position || credit.tracks || undefined });
  }
  const seen = new Set<string>();
  return credits.filter((credit) => {
    const key = `${credit.name}|${credit.role || ''}|${credit.tracks || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(credit.name);
  });
}

function formatDescription(release: DiscogsRelease) {
  return (release.formats || [])
    .map((format: any) => {
      const parts = [format.name, ...(format.descriptions || []), format.text].filter(Boolean);
      const description = [...new Set(parts)].join(', ');
      return format.qty && String(format.qty) !== '1' ? `${format.qty}× ${description}` : description;
    })
    .filter(Boolean)
    .join(' + ');
}

function inferredVinylColor(release: DiscogsRelease) {
  const text = JSON.stringify(release.formats || []).toLowerCase();
  const colors = ['clear', 'transparent', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'pink', 'purple', 'gold', 'silver', 'marbled', 'splatter'];
  const found = colors.find((color) => text.includes(color));
  return found ? found[0].toUpperCase() + found.slice(1) : undefined;
}

export function normalizeDiscogsRelease(release: DiscogsRelease, songs: Song[]): Partial<VinylMeta> {
  const mapped = mapTracks(physicalTracks(release), songs);
  const labels = release.labels || [];
  const year = Number(release.year || String(release.released || '').slice(0, 4)) || undefined;
  const vinylColor = inferredVinylColor(release);
  const identifiers: DiscogsIdentifier[] = (release.identifiers || []).map((id: any) => ({
    type: id.type || undefined,
    value: id.value || undefined,
    description: id.description || undefined,
  }));

  return {
    source: 'discogs',
    pressingId: `discogs:${release.id}`,
    discogsReleaseId: Number(release.id),
    discogsMasterId: release.master_id ? Number(release.master_id) : undefined,
    discogsUri: release.uri || undefined,
    pressingTitle: release.title || undefined,
    pressingLabel: labels[0]?.name || 'Discogs vinyl',
    catalogNumber: labels[0]?.catno || undefined,
    country: release.country || undefined,
    releaseYear: year,
    released: release.released || undefined,
    formatDescription: formatDescription(release) || undefined,
    formatQuantity: Number(release.format_quantity || release.formats?.reduce((sum: number, f: any) => sum + Number(f.qty || 1), 0)) || undefined,
    ...(vinylColor ? { vinylColor } : {}),
    genres: release.genres || [],
    styles: release.styles || [],
    releaseNotes: release.notes || undefined,
    identifiers,
    credits: releaseCredits(release),
    images: (release.images || []).map((image: any) => ({
      type: image.type || undefined,
      uri: image.uri || undefined,
      uri150: image.uri150 || undefined,
      width: image.width || undefined,
      height: image.height || undefined,
    })),
    sides: groupSides(mapped.tracks),
    trackMappingWarnings: mapped.warnings,
    discogsFetchedAt: new Date().toISOString(),
  };
}
