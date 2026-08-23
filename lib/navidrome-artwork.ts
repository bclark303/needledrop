import crypto from 'crypto';
import { getSystemJson, setSystemJson } from './db';
import { logicalAlbumTitle, normalizedAlbumIdentity } from './album-normalization';

const REGISTRY_KEY = 'navidrome_artwork_fingerprints_v1';
const GENERIC_IDENTITY_THRESHOLD = 3;
const MAX_FINGERPRINTS = 600;
const MAX_ALBUMS_PER_FINGERPRINT = 30;

type FingerprintEntry = {
  hash: string;
  bytes: number;
  contentType?: string;
  albumIds: string[];
  identities: string[];
  generic: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

type FingerprintRegistry = {
  version: 1;
  entries: Record<string, FingerprintEntry>;
};

export type NavidromeArtworkClassification = {
  hash: string;
  shortHash: string;
  bytes: number;
  generic: boolean;
  distinctAlbumCount: number;
  distinctIdentityCount: number;
};

export function classifyNavidromeArtwork(input: {
  albumId: string;
  artist?: string;
  title?: string;
  bytes: Uint8Array;
  contentType?: string | null;
}): NavidromeArtworkClassification {
  const hash = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const now = new Date().toISOString();
  const registry = loadRegistry();
  const identity = albumIdentity(input.artist || '', input.title || '', input.albumId);
  const existing = registry.entries[hash];
  const albumIds = unique([...(existing?.albumIds || []), input.albumId]).slice(-MAX_ALBUMS_PER_FINGERPRINT);
  const identities = unique([...(existing?.identities || []), identity]).slice(-MAX_ALBUMS_PER_FINGERPRINT);
  const generic = Boolean(existing?.generic) || identities.length >= GENERIC_IDENTITY_THRESHOLD;

  registry.entries[hash] = {
    hash,
    bytes: input.bytes.byteLength,
    contentType: input.contentType || existing?.contentType || undefined,
    albumIds,
    identities,
    generic,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
  };
  trimRegistry(registry);
  setSystemJson(REGISTRY_KEY, registry);

  return {
    hash,
    shortHash: hash.slice(0, 16),
    bytes: input.bytes.byteLength,
    generic,
    distinctAlbumCount: albumIds.length,
    distinctIdentityCount: identities.length,
  };
}

export function navidromeArtworkKnownGeneric(albumId: string) {
  const registry = loadRegistry();
  return Object.values(registry.entries).some((entry) => entry.generic && entry.albumIds.includes(albumId));
}

function loadRegistry(): FingerprintRegistry {
  const stored = getSystemJson<FingerprintRegistry>(REGISTRY_KEY);
  if (!stored || stored.version !== 1 || !stored.entries || typeof stored.entries !== 'object') {
    return { version: 1, entries: {} };
  }
  return stored;
}

function trimRegistry(registry: FingerprintRegistry) {
  const entries = Object.values(registry.entries);
  if (entries.length <= MAX_FINGERPRINTS) return;
  entries
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(MAX_FINGERPRINTS)
    .forEach((entry) => { delete registry.entries[entry.hash]; });
}

function albumIdentity(artist: string, title: string, albumId: string) {
  const normalizedArtist = normalizedAlbumIdentity(artist);
  const normalizedTitle = normalizedAlbumIdentity(logicalAlbumTitle(title));
  return normalizedArtist && normalizedTitle ? `${normalizedArtist}\u0000${normalizedTitle}` : `album:${albumId}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
