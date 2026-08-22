import type { AppSettings, AppSettingsPatch, ArtworkSource, MetadataSource, PlaybackMode, TurntableSpeed } from '@/components/types';
import { getSystemJson, setSystemJson } from './db';
import { APP_VERSION, SETTINGS_SCHEMA_VERSION } from './version';

export type StoredSettings = {
  schemaVersion: number;
  navidromeUrl?: string;
  discogsEnabled?: boolean;
  discogsToken?: string;
  musicbrainzEnabled?: boolean;
  musicbrainzUserAgent?: string;
  coverArtArchiveEnabled?: boolean;
  lastfmEnabled?: boolean;
  lastfmApiKey?: string;
  autoEnrich?: boolean;
  metadataSourceOrder?: MetadataSource[];
  artworkSourceOrder?: ArtworkSource[];
  defaultPlaybackMode?: PlaybackMode;
  defaultTurntableSpeed?: TurntableSpeed;
  simulateSpeed?: boolean;
  changerEnabled?: boolean;
  updatedAt?: string;
};

const METADATA_DEFAULT: MetadataSource[] = ['discogs', 'musicbrainz', 'lastfm'];
const ARTWORK_DEFAULT: ArtworkSource[] = ['discogs', 'coverartarchive', 'navidrome'];

function envDefaults(): StoredSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    navidromeUrl: process.env.NAVIDROME_URL?.trim() || '',
    discogsEnabled: true,
    discogsToken: process.env.DISCOGS_TOKEN?.trim() || '',
    musicbrainzEnabled: true,
    musicbrainzUserAgent: process.env.MUSICBRAINZ_USER_AGENT?.trim() || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`,
    coverArtArchiveEnabled: true,
    lastfmEnabled: true,
    lastfmApiKey: process.env.LASTFM_API_KEY?.trim() || '',
    autoEnrich: true,
    metadataSourceOrder: METADATA_DEFAULT,
    artworkSourceOrder: ARTWORK_DEFAULT,
    defaultPlaybackMode: 'vinyl',
    defaultTurntableSpeed: 33.333,
    simulateSpeed: true,
    changerEnabled: true,
  };
}

function withMissingSources<T extends string>(stored: T[] | undefined, defaults: T[]) {
  const result = [...(stored || [])].filter((item, index, all) => defaults.includes(item) && all.indexOf(item) === index);
  for (const source of defaults) if (!result.includes(source)) result.push(source);
  return result.length ? result : defaults;
}

export async function getStoredSettings(): Promise<StoredSettings> {
  const defaults = envDefaults();
  const stored = getSystemJson<StoredSettings>('app_settings') || { schemaVersion: SETTINGS_SCHEMA_VERSION };
  return {
    ...defaults,
    ...stored,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    metadataSourceOrder: withMissingSources(stored.metadataSourceOrder, METADATA_DEFAULT),
    artworkSourceOrder: withMissingSources(stored.artworkSourceOrder, ARTWORK_DEFAULT),
  };
}

export async function getNavidromeUrl() {
  const settings = await getStoredSettings();
  const value = settings.navidromeUrl?.trim();
  if (!value) throw new Error('NAVIDROME_URL is not configured');
  return value.replace(/\/$/, '');
}

export async function getDiscogsConfig() {
  const settings = await getStoredSettings();
  return {
    enabled: settings.discogsEnabled !== false,
    token: settings.discogsToken?.trim() || '',
    userAgent: settings.musicbrainzUserAgent?.trim() || `NeedleDrop/${APP_VERSION}`,
  };
}

export async function getLastFmConfig() {
  const settings = await getStoredSettings();
  return {
    enabled: settings.lastfmEnabled !== false,
    apiKey: settings.lastfmApiKey?.trim() || '',
  };
}

export async function getPublicSettings(username?: string | null): Promise<AppSettings> {
  const settings = await getStoredSettings();
  return {
    navidromeUrl: settings.navidromeUrl || '',
    discogsEnabled: settings.discogsEnabled !== false,
    discogsTokenConfigured: Boolean(settings.discogsToken?.trim()),
    musicbrainzEnabled: settings.musicbrainzEnabled !== false,
    musicbrainzUserAgent: settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION}`,
    coverArtArchiveEnabled: settings.coverArtArchiveEnabled !== false,
    lastfmEnabled: settings.lastfmEnabled !== false,
    lastfmApiKeyConfigured: Boolean(settings.lastfmApiKey?.trim()),
    autoEnrich: settings.autoEnrich !== false,
    metadataSourceOrder: settings.metadataSourceOrder || METADATA_DEFAULT,
    artworkSourceOrder: settings.artworkSourceOrder || ARTWORK_DEFAULT,
    defaultPlaybackMode: settings.defaultPlaybackMode || 'vinyl',
    defaultTurntableSpeed: settings.defaultTurntableSpeed || 33.333,
    simulateSpeed: settings.simulateSpeed !== false,
    changerEnabled: settings.changerEnabled !== false,
    canManage: canManageSettings(username),
  };
}

export function canManageSettings(username?: string | null) {
  if (!username) return false;
  const configured = (process.env.NEEDLEDROP_ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (!configured.length) return true;
  return configured.includes(username.toLocaleLowerCase());
}

function cleanSourceOrder<T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  const unique = value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T));
  const cleaned = [...new Set(unique)];
  for (const source of fallback) if (!cleaned.includes(source)) cleaned.push(source);
  return cleaned.length ? cleaned : fallback;
}

export async function saveSettings(patch: AppSettingsPatch): Promise<StoredSettings> {
  const current = await getStoredSettings();
  const next: StoredSettings = { ...current };

  if (typeof patch.navidromeUrl === 'string') next.navidromeUrl = patch.navidromeUrl.trim();
  if (typeof patch.discogsEnabled === 'boolean') next.discogsEnabled = patch.discogsEnabled;
  if (typeof patch.musicbrainzEnabled === 'boolean') next.musicbrainzEnabled = patch.musicbrainzEnabled;
  if (typeof patch.musicbrainzUserAgent === 'string') next.musicbrainzUserAgent = patch.musicbrainzUserAgent.trim();
  if (typeof patch.coverArtArchiveEnabled === 'boolean') next.coverArtArchiveEnabled = patch.coverArtArchiveEnabled;
  if (typeof patch.lastfmEnabled === 'boolean') next.lastfmEnabled = patch.lastfmEnabled;
  if (typeof patch.autoEnrich === 'boolean') next.autoEnrich = patch.autoEnrich;
  if (patch.metadataSourceOrder) next.metadataSourceOrder = cleanSourceOrder(patch.metadataSourceOrder, ['discogs', 'musicbrainz', 'lastfm'] as const, METADATA_DEFAULT);
  if (patch.artworkSourceOrder) next.artworkSourceOrder = cleanSourceOrder(patch.artworkSourceOrder, ['discogs', 'coverartarchive', 'navidrome'] as const, ARTWORK_DEFAULT);
  if (patch.defaultPlaybackMode === 'vinyl' || patch.defaultPlaybackMode === 'normal') next.defaultPlaybackMode = patch.defaultPlaybackMode;
  if (patch.defaultTurntableSpeed === 33.333 || patch.defaultTurntableSpeed === 45 || patch.defaultTurntableSpeed === 78) next.defaultTurntableSpeed = patch.defaultTurntableSpeed;
  if (typeof patch.simulateSpeed === 'boolean') next.simulateSpeed = patch.simulateSpeed;
  if (typeof patch.changerEnabled === 'boolean') next.changerEnabled = patch.changerEnabled;
  if (patch.clearDiscogsToken) next.discogsToken = '';
  else if (typeof patch.discogsToken === 'string' && patch.discogsToken.trim()) next.discogsToken = patch.discogsToken.trim();
  if (patch.clearLastfmApiKey) next.lastfmApiKey = '';
  else if (typeof patch.lastfmApiKey === 'string' && patch.lastfmApiKey.trim()) next.lastfmApiKey = patch.lastfmApiKey.trim();

  next.schemaVersion = SETTINGS_SCHEMA_VERSION;
  next.updatedAt = new Date().toISOString();
  setSystemJson('app_settings', next);
  return next;
}
