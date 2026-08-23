import type { Album } from '@/components/types';

export type SplitDiscTitle = {
  baseTitle: string;
  discNumber: number;
};

const TRAILING_DISC_PATTERNS = [
  /^(.*?)\s*(?:[-–—:]\s*)?(?:cd|disc|disk)\s*0?(\d{1,2})\s*$/i,
  /^(.*?)\s*[\[(]\s*(?:cd|disc|disk)\s*0?(\d{1,2})\s*[\])]\s*$/i,
];

export function parseSplitDiscTitle(title: string): SplitDiscTitle | null {
  const value = title.trim();
  for (const pattern of TRAILING_DISC_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const discNumber = Number(match[2]);
    const baseTitle = cleanBaseTitle(match[1]);
    if (!baseTitle || !Number.isInteger(discNumber) || discNumber < 1 || discNumber > 99) return null;
    return { baseTitle, discNumber };
  }
  return null;
}

export function logicalAlbumTitle(title: string) {
  return parseSplitDiscTitle(title)?.baseTitle || title.trim();
}

export function albumLookupTitles(title: string) {
  const values: string[] = [];
  const add = (value: string) => {
    const cleaned = cleanBaseTitle(value);
    if (cleaned && !values.some((existing) => existing.toLocaleLowerCase() === cleaned.toLocaleLowerCase())) values.push(cleaned);
  };

  add(title);
  const split = parseSplitDiscTitle(title);
  let current = split?.baseTitle || title.trim();
  add(current);

  // Edition, region, bitrate and remaster notes are useful display metadata but
  // often prevent an otherwise obvious MusicBrainz/Discogs/Last.fm match. Keep
  // the literal title first and progressively remove only trailing bracketed
  // qualifiers as fallback lookup variants.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stripped = current.replace(/\s*(?:\([^()]+\)|\[[^\[\]]+\]|\{[^{}]+\})\s*$/, '').trim();
    if (!stripped || stripped === current) break;
    current = stripped;
    add(current);
  }

  return values;
}

export function normalizedAlbumIdentity(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function splitDiscGroupKey(album: Pick<Album, 'artist' | 'name' | 'year'>) {
  const split = parseSplitDiscTitle(album.name);
  if (!split) return null;
  const artist = normalizedAlbumIdentity(album.artist);
  const title = normalizedAlbumIdentity(split.baseTitle);
  if (!artist || !title) return null;
  return {
    key: `${artist}\u0000${title}\u0000${album.year || ''}`,
    baseTitle: split.baseTitle,
    discNumber: split.discNumber,
  };
}

function cleanBaseTitle(value: string) {
  return value.replace(/[\s\-–—:]+$/, '').replace(/\s+/g, ' ').trim();
}
