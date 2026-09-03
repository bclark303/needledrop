import crypto from 'crypto';
import { diagnosticFetch } from './diagnostic-fetch';
import { recordDiagnostic } from './diagnostics';
import { getSession, type Session } from './session';
import { getNavidromeMusicFolderId, getNavidromeUrl } from './settings';
import type { NavidromeLibrary } from '@/components/types';
import { navidromeEndpointSupportsLibraryScope, scopeNavidromeParams } from './navidrome-library';
import { APP_NAME } from './version';

const API_VERSION = '1.16.1';
const CLIENT = APP_NAME;

export function credentials(username: string, password: string): Session {
  const s = crypto.randomBytes(8).toString('hex');
  const t = crypto.createHash('md5').update(password + s).digest('hex');
  return { u: username, s, t };
}

export function authParams(session: Session) {
  return { u: session.u, s: session.s, t: session.t, v: API_VERSION, c: CLIENT, f: 'json' };
}

export async function subsonic(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}, session?: Session) {
  const auth = session ?? await getSession();
  if (!auth) throw new Error('UNAUTHENTICATED');
  const selectedMusicFolderId = navidromeEndpointSupportsLibraryScope(endpoint)
    ? await getNavidromeMusicFolderId()
    : '';
  const scopedParams = scopeNavidromeParams(endpoint, params, selectedMusicFolderId);
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...authParams(auth), ...scopedParams })) {
    if (value !== undefined) q.set(key, String(value));
  }
  const base = await getNavidromeUrl();
  const response = await diagnosticFetch(`${base}/rest/${endpoint}.view?${q}`, { cache: 'no-store' }, {
    provider: 'navidrome',
    operation: endpoint,
    data: {
      paramKeys: Object.keys(scopedParams).sort(),
      requestShape: {
        type: scopedParams.type,
        size: scopedParams.size,
        offset: scopedParams.offset,
        idPresent: scopedParams.id != null,
        musicFolderSelected: scopedParams.musicFolderId != null,
      },
    },
  });
  if (!response.ok) throw new Error(`Navidrome HTTP ${response.status}`);
  const json = await response.json();
  const root = json['subsonic-response'];
  if (root?.status !== 'ok') {
    recordDiagnostic('provider-logical-error', {
      provider: 'navidrome',
      operation: endpoint,
      code: root?.error?.code,
      message: root?.error?.message || 'Navidrome request failed',
    }, 'warn');
    throw new Error(root?.error?.message || 'Navidrome request failed');
  }
  return root;
}

export async function getNavidromeLibraries(session?: Session): Promise<NavidromeLibrary[]> {
  const root = await subsonic('getMusicFolders', {}, session);
  const folders = root.musicFolders?.musicFolder || [];
  return folders
    .map((folder: { id?: string | number; name?: string }) => ({
      id: String(folder.id ?? ''),
      name: String(folder.name || `Library ${folder.id ?? ''}`).trim(),
    }))
    .filter((folder: NavidromeLibrary) => folder.id)
    .sort((a: NavidromeLibrary, b: NavidromeLibrary) => a.name.localeCompare(b.name));
}

export async function mediaUrl(endpoint: 'stream' | 'getCoverArt', id: string, extra: Record<string, string> = {}) {
  const auth = await getSession();
  if (!auth) throw new Error('UNAUTHENTICATED');
  const q = new URLSearchParams({ ...authParams(auth), id, ...extra });
  const base = await getNavidromeUrl();
  return `${base}/rest/${endpoint}.view?${q}`;
}
