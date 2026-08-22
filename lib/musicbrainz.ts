import { getStoredSettings } from './settings';
import { APP_VERSION } from './version';

let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

async function throttledFetch(url: string) {
  const previous = requestChain;
  let release!: () => void;
  requestChain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const settings = await getStoredSettings();
    const userAgent = settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`;
    const response = await fetch(url, { headers: { 'User-Agent': userAgent }, cache: 'no-store' });
    lastRequestAt = Date.now();
    if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
    return response.json();
  } finally {
    release();
  }
}

function quote(value: string) {
  return `\"${value.replace(/\"/g, '')}\"`;
}

export type MusicBrainzMatch = {
  id: string;
  score: number;
  title?: string;
  releaseGroupId?: string;
  country?: string;
  date?: string;
};

export async function findReleaseGroup(artist: string, title: string): Promise<MusicBrainzMatch | null> {
  const query = encodeURIComponent(`releasegroup:${quote(title)} AND artist:${quote(artist)}`);
  const data = await throttledFetch(`https://musicbrainz.org/ws/2/release-group/?query=${query}&fmt=json&limit=8`) as { 'release-groups'?: Array<Record<string, unknown>> };
  const candidates = data['release-groups'] || [];
  const best = candidates
    .map((item) => ({
      id: String(item.id || ''),
      score: Number(item.score || 0),
      title: item.title ? String(item.title) : undefined,
    }))
    .filter((item) => item.id)
    .sort((a, b) => b.score - a.score)[0];
  return best || null;
}

export async function findRelease(input: {
  artist: string;
  title: string;
  country?: string;
  year?: number;
  catalogNumber?: string;
}): Promise<MusicBrainzMatch | null> {
  const terms = [`release:${quote(input.title)}`, `artist:${quote(input.artist)}`];
  if (input.country) terms.push(`country:${quote(input.country)}`);
  if (input.catalogNumber) terms.push(`catno:${quote(input.catalogNumber)}`);
  const query = encodeURIComponent(terms.join(' AND '));
  const data = await throttledFetch(`https://musicbrainz.org/ws/2/release/?query=${query}&fmt=json&limit=12`) as { releases?: Array<Record<string, unknown>> };
  const candidates = (data.releases || []).map((item) => {
    const group = item['release-group'] as Record<string, unknown> | undefined;
    const date = item.date ? String(item.date) : undefined;
    let score = Number(item.score || 0);
    if (input.year && date?.startsWith(String(input.year))) score += 5;
    if (input.country && String(item.country || '').toLowerCase() === input.country.toLowerCase()) score += 5;
    return {
      id: String(item.id || ''),
      score,
      title: item.title ? String(item.title) : undefined,
      releaseGroupId: group?.id ? String(group.id) : undefined,
      country: item.country ? String(item.country) : undefined,
      date,
    };
  }).filter((item) => item.id).sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}
