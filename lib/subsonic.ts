import crypto from 'crypto';
import { diagnosticFetch } from './diagnostic-fetch';
import { recordDiagnostic } from './diagnostics';
import { getSession, type Session } from './session';
import { getNavidromeUrl } from './settings';
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
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...authParams(auth), ...params })) {
    if (value !== undefined) q.set(key, String(value));
  }
  const base = await getNavidromeUrl();
  const response = await diagnosticFetch(`${base}/rest/${endpoint}.view?${q}`, { cache: 'no-store' }, {
    provider: 'navidrome',
    operation: endpoint,
    data: {
      paramKeys: Object.keys(params).sort(),
      requestShape: {
        type: params.type,
        size: params.size,
        offset: params.offset,
        idPresent: params.id != null,
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

export async function mediaUrl(endpoint: 'stream' | 'getCoverArt', id: string, extra: Record<string, string> = {}) {
  const auth = await getSession();
  if (!auth) throw new Error('UNAUTHENTICATED');
  const q = new URLSearchParams({ ...authParams(auth), id, ...extra });
  const base = await getNavidromeUrl();
  return `${base}/rest/${endpoint}.view?${q}`;
}
