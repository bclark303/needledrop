import { getSystemJson, setSystemJson } from './db';

export type LidarrSettings = {
  url?: string;
  apiKey?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  updatedAt?: string;
};

export type LidarrPublicSettings = {
  url: string;
  apiKeyConfigured: boolean;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
};

export type LidarrOption = { id: number; name: string };
export type LidarrRootFolder = {
  id: number;
  path: string;
  defaultQualityProfileId?: number;
  defaultMetadataProfileId?: number;
};

export type LidarrOptions = {
  rootFolders: LidarrRootFolder[];
  qualityProfiles: LidarrOption[];
  metadataProfiles: LidarrOption[];
};

export type LidarrAlbumRequest = {
  albumId: number;
  commandId?: number;
  baselineTrackFiles: number;
  albumTitle?: string;
};

export type LidarrProgress = {
  state: 'searching' | 'downloading' | 'search-complete' | 'imported' | 'unknown';
  message: string;
  trackFiles: number;
  queueItems: number;
};

function envDefaults(): LidarrSettings {
  return {
    url: process.env.LIDARR_URL?.trim() || '',
    apiKey: process.env.LIDARR_API_KEY?.trim() || '',
  };
}

export function getLidarrSettings(): LidarrSettings {
  const stored = getSystemJson<LidarrSettings>('lidarr_settings') || {};
  return { ...envDefaults(), ...stored };
}

export function getPublicLidarrSettings(): LidarrPublicSettings {
  const settings = getLidarrSettings();
  return {
    url: settings.url || '',
    apiKeyConfigured: Boolean(settings.apiKey?.trim()),
    rootFolderPath: settings.rootFolderPath,
    qualityProfileId: settings.qualityProfileId,
    metadataProfileId: settings.metadataProfileId,
  };
}

export function saveLidarrSettings(patch: {
  url?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
}) {
  const current = getLidarrSettings();
  const next: LidarrSettings = { ...current };
  if (typeof patch.url === 'string') next.url = patch.url.trim();
  if (patch.clearApiKey) next.apiKey = '';
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (typeof patch.rootFolderPath === 'string') next.rootFolderPath = patch.rootFolderPath.trim();
  if (Number.isInteger(patch.qualityProfileId)) next.qualityProfileId = Number(patch.qualityProfileId);
  if (Number.isInteger(patch.metadataProfileId)) next.metadataProfileId = Number(patch.metadataProfileId);
  next.updatedAt = new Date().toISOString();
  setSystemJson('lidarr_settings', next);
  return next;
}

function config(overrides?: { url?: string; apiKey?: string }) {
  const stored = getLidarrSettings();
  const url = (overrides?.url?.trim() || stored.url || '').replace(/\/$/, '');
  const apiKey = overrides?.apiKey?.trim() || stored.apiKey?.trim() || '';
  if (!url || !apiKey) throw new Error('LIDARR_NOT_CONFIGURED');
  return { url, apiKey };
}

async function lidarr(path: string, init: RequestInit = {}, overrides?: { url?: string; apiKey?: string }) {
  const current = config(overrides);
  const response = await fetch(`${current.url}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: {
      'X-Api-Key': current.apiKey,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Lidarr HTTP ${response.status}${body ? `: ${body.slice(0, 220)}` : ''}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export async function testLidarrConnection(url?: string, apiKey?: string) {
  const status = await lidarr('/api/v1/system/status', {}, { url, apiKey }) as Record<string, unknown>;
  return {
    version: status?.version ? String(status.version) : '',
    appName: status?.appName ? String(status.appName) : 'Lidarr',
  };
}

export async function getLidarrOptions(): Promise<LidarrOptions> {
  const [rootsRaw, qualityRaw, metadataRaw] = await Promise.all([
    lidarr('/api/v1/rootfolder').catch(() => []),
    lidarr('/api/v1/qualityprofile').catch(() => []),
    lidarr('/api/v1/metadataprofile').catch(() => []),
  ]);
  return {
    rootFolders: asArray(rootsRaw).map((item) => ({
      id: Number(item.id || 0),
      path: String(item.path || ''),
      defaultQualityProfileId: numberOrUndefined(item.defaultQualityProfileId),
      defaultMetadataProfileId: numberOrUndefined(item.defaultMetadataProfileId),
    })).filter((item) => item.id && item.path),
    qualityProfiles: asArray(qualityRaw).map(profile).filter((item) => item.id),
    metadataProfiles: asArray(metadataRaw).map(profile).filter((item) => item.id),
  };
}

export async function requestAlbumSearch(input: {
  artist: string;
  title: string;
  releaseGroupMbid: string;
}): Promise<LidarrAlbumRequest> {
  const settings = getLidarrSettings();
  let album = await findAlbum(input.releaseGroupMbid);
  if (!album) album = await addAlbum(input, settings);
  if (!album?.id) throw new Error('Lidarr could not add or resolve this MusicBrainz album.');

  album = await ensureAlbumMonitored(album);
  await ensureArtistMonitored(album).catch(() => {});
  const baselineTrackFiles = Number(album.statistics?.trackFileCount || album.statistics?.trackFileCountTotal || 0);
  const command = await lidarr('/api/v1/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'AlbumSearch', albumIds: [Number(album.id)] }),
  }) as Record<string, unknown> | null;

  return {
    albumId: Number(album.id),
    commandId: numberOrUndefined(command?.id),
    baselineTrackFiles,
    albumTitle: album.title ? String(album.title) : input.title,
  };
}

export async function getLidarrProgress(albumId: number, commandId: number | undefined, baselineTrackFiles: number): Promise<LidarrProgress> {
  const [album, command, queue] = await Promise.all([
    lidarr(`/api/v1/album/${albumId}`).catch(() => null),
    commandId ? lidarr(`/api/v1/command/${commandId}`).catch(() => null) : Promise.resolve(null),
    lidarr(`/api/v1/queue?page=1&pageSize=100&sortDirection=ascending&sortKey=timeleft`).catch(() => ({ records: [] })),
  ]);
  const trackFiles = Number(album?.statistics?.trackFileCount || album?.statistics?.trackFileCountTotal || 0);
  const queueRecords = asArray(queue?.records || queue).filter((item) => Number(item.albumId || item.album?.id || 0) === albumId);
  if (trackFiles > baselineTrackFiles) {
    return { state: 'imported', message: `Lidarr imported new audio (${trackFiles} track files now present).`, trackFiles, queueItems: queueRecords.length };
  }
  if (queueRecords.length) {
    const status = String(queueRecords[0]?.status || queueRecords[0]?.trackedDownloadStatus || 'downloading');
    return { state: 'downloading', message: `Lidarr queue: ${status}.`, trackFiles, queueItems: queueRecords.length };
  }
  const commandStatus = String(command?.status || '').toLowerCase();
  if (commandStatus === 'completed') {
    return { state: 'search-complete', message: 'Lidarr search completed; waiting for a download/import.', trackFiles, queueItems: 0 };
  }
  if (commandStatus === 'queued' || commandStatus === 'started') {
    return { state: 'searching', message: 'Lidarr is searching for a suitable release.', trackFiles, queueItems: 0 };
  }
  return { state: 'unknown', message: 'Lidarr request is active.', trackFiles, queueItems: 0 };
}

async function findAlbum(releaseGroupMbid: string) {
  const albums = asArray(await lidarr(`/api/v1/album?foreignAlbumId=${encodeURIComponent(releaseGroupMbid)}`).catch(() => []));
  return albums[0] || null;
}

async function addAlbum(input: { artist: string; title: string; releaseGroupMbid: string }, settings: LidarrSettings) {
  const options = await getLidarrOptions();
  const root = options.rootFolders.find((item) => item.path === settings.rootFolderPath) || options.rootFolders[0];
  if (!root) throw new Error('Lidarr has no root folder configured.');
  const qualityProfileId = settings.qualityProfileId || root.defaultQualityProfileId || options.qualityProfiles[0]?.id;
  const metadataProfileId = settings.metadataProfileId || root.defaultMetadataProfileId || options.metadataProfiles[0]?.id;
  if (!qualityProfileId || !metadataProfileId) throw new Error('Lidarr quality/metadata profiles could not be determined.');

  const terms = [`lidarr:${input.releaseGroupMbid}`, `${input.artist} ${input.title}`];
  let candidate: Record<string, any> | null = null;
  for (const term of terms) {
    const results = asArray(await lidarr(`/api/v1/search?term=${encodeURIComponent(term)}`).catch(() => []));
    candidate = results
      .map((item) => (item.album && typeof item.album === 'object' ? item.album : item))
      .find((item) => String(item.foreignAlbumId || '') === input.releaseGroupMbid) ||
      results.map((item) => (item.album && typeof item.album === 'object' ? item.album : item)).find((item) => normalize(String(item.title || '')) === normalize(input.title)) || null;
    if (candidate) break;
  }
  if (!candidate) throw new Error('Lidarr search could not find this MusicBrainz release group.');

  const artist = candidate.artist && typeof candidate.artist === 'object' ? { ...candidate.artist } : {};
  const albumPayload: Record<string, unknown> = {
    ...candidate,
    monitored: true,
    artist: {
      ...artist,
      rootFolderPath: root.path,
      qualityProfileId,
      metadataProfileId,
      monitored: false,
      monitorNewItems: 'none',
      addOptions: { monitor: 'none', monitored: false, searchForMissingAlbums: false },
    },
    addOptions: { searchForNewAlbum: false },
  };
  delete albumPayload.id;
  if (albumPayload.artist && typeof albumPayload.artist === 'object') delete (albumPayload.artist as Record<string, unknown>).id;

  await lidarr('/api/v1/album', { method: 'POST', body: JSON.stringify(albumPayload) });
  return await findAlbum(input.releaseGroupMbid);
}

async function ensureAlbumMonitored(album: Record<string, any>) {
  if (album.monitored === true) return album;
  const updated = await lidarr(`/api/v1/album/${Number(album.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...album, monitored: true }),
  });
  return updated || { ...album, monitored: true };
}

async function ensureArtistMonitored(album: Record<string, any>) {
  const artistId = Number(album.artistId || album.artist?.id || 0);
  if (!artistId) return;
  const artist = await lidarr(`/api/v1/artist/${artistId}`);
  if (!artist || artist.monitored === true) return;
  await lidarr(`/api/v1/artist/${artistId}`, {
    method: 'PUT',
    body: JSON.stringify({ ...artist, monitored: true, monitorNewItems: artist.monitorNewItems || 'none' }),
  });
}

function asArray(value: any): Array<Record<string, any>> {
  return Array.isArray(value) ? value : [];
}

function profile(item: Record<string, any>): LidarrOption {
  return { id: Number(item.id || 0), name: String(item.name || `Profile ${item.id || ''}`) };
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
