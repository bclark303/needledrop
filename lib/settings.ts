import fs from 'fs/promises';
import path from 'path';
import type { AppSettings, AppSettingsPatch, ArtworkSource, MetadataSource, PlaybackMode, TurntableSpeed } from '@/components/types';
import { APP_VERSION, SETTINGS_SCHEMA_VERSION } from './version';

export type StoredSettings = {
  schemaVersion: number;
  navidromeUrl?: string;
  discogsEnabled?: boolean;
  discogsToken?: string;
  musicbrainzEnabled?: boolean;
  musicbrainzUserAgent?: string;
  metadataSourceOrder?: MetadataSource[];
  artworkSourceOrder?: ArtworkSource[];
  defaultPlaybackMode?: PlaybackMode;
  defaultTurntableSpeed?: TurntableSpeed;
  simulateSpeed?: boolean;
  changerEnabled?: boolean;
  updatedAt?: string;
};

const dataDir = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const settingsFile = path.join(dataDir, 'settings.json');

function envDefaults(): StoredSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    navidromeUrl: process.env.NAVIDROME_URL?.trim() || '',
    discogsEnabled: true,
    discogsToken: process.env.DISCOGS_TOKEN?.trim() || '',
    musicbrainzEnabled: true,
    musicbrainzUserAgent: process.env.MUSICBRAINZ_USER_AGENT?.trim() || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`,
    metadataSourceOrder: ['discogs', 'musicbrainz'],
    artworkSourceOrder: ['discogs', 'navidrome'],
    defaultPlaybackMode: 'vinyl',
    defaultTurntableSpeed: 33.333,
    simulateSpeed: true,
    changerEnabled: true,
  };
}

async function readStored(): Promise<StoredSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile, 'utf8')) as StoredSettings;
    return raw && typeof raw === 'object' ? raw : { schemaVersion: SETTINGS_SCHEMA_VERSION };
  } catch {
    return { schemaVersion: SETTINGS_SCHEMA_VERSION };
  }
}

async function writeStored(settings: StoredSettings) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = `${settingsFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await fs.rename(tmp, settingsFile);
  await fs.chmod(settingsFile, 0o600).catch(() => {});
}

export async function getStoredSettings(): Promise<StoredSettings> {
  const defaults = envDefaults();
  const stored = await readStored();
  return {
    ...defaults,
    ...stored,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    metadataSourceOrder: stored.metadataSourceOrder?.length ? stored.metadataSourceOrder : defaults.metadataSourceOrder,
    artworkSourceOrder: stored.artworkSourceOrder?.length ? stored.artworkSourceOrder : defaults.artworkSourceOrder,
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

export async function getPublicSettings(username?: string | null): Promise<AppSettings> {
  const settings = await getStoredSettings();
  return {
    navidromeUrl: settings.navidromeUrl || '',
    discogsEnabled: settings.discogsEnabled !== false,
    discogsTokenConfigured: Boolean(settings.discogsToken?.trim()),
    musicbrainzEnabled: settings.musicbrainzEnabled !== false,
    musicbrainzUserAgent: settings.musicbrainzUserAgent || `NeedleDrop/${APP_VERSION}`,
    metadataSourceOrder: settings.metadataSourceOrder || ['discogs', 'musicbrainz'],
    artworkSourceOrder: settings.artworkSourceOrder || ['discogs', 'navidrome'],
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
  return [...new Set(unique)].length ? [...new Set(unique)] : fallback;
}

export async function saveSettings(patch: AppSettingsPatch): Promise<StoredSettings> {
  const current = await getStoredSettings();
  const next: StoredSettings = { ...current };

  if (typeof patch.navidromeUrl === 'string') next.navidromeUrl = patch.navidromeUrl.trim();
  if (typeof patch.discogsEnabled === 'boolean') next.discogsEnabled = patch.discogsEnabled;
  if (typeof patch.musicbrainzEnabled === 'boolean') next.musicbrainzEnabled = patch.musicbrainzEnabled;
  if (typeof patch.musicbrainzUserAgent === 'string') next.musicbrainzUserAgent = patch.musicbrainzUserAgent.trim();
  if (patch.metadataSourceOrder) next.metadataSourceOrder = cleanSourceOrder(patch.metadataSourceOrder, ['discogs', 'musicbrainz'] as const, ['discogs', 'musicbrainz']);
  if (patch.artworkSourceOrder) next.artworkSourceOrder = cleanSourceOrder(patch.artworkSourceOrder, ['discogs', 'navidrome'] as const, ['discogs', 'navidrome']);
  if (patch.defaultPlaybackMode === 'vinyl' || patch.defaultPlaybackMode === 'normal') next.defaultPlaybackMode = patch.defaultPlaybackMode;
  if (patch.defaultTurntableSpeed === 33.333 || patch.defaultTurntableSpeed === 45 || patch.defaultTurntableSpeed === 78) next.defaultTurntableSpeed = patch.defaultTurntableSpeed;
  if (typeof patch.simulateSpeed === 'boolean') next.simulateSpeed = patch.simulateSpeed;
  if (typeof patch.changerEnabled === 'boolean') next.changerEnabled = patch.changerEnabled;
  if (patch.clearDiscogsToken) next.discogsToken = '';
  else if (typeof patch.discogsToken === 'string' && patch.discogsToken.trim()) next.discogsToken = patch.discogsToken.trim();

  next.schemaVersion = SETTINGS_SCHEMA_VERSION;
  next.updatedAt = new Date().toISOString();
  await writeStored(next);
  return next;
}
