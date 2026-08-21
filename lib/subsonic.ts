import crypto from 'crypto';
import { getSession, Session } from './session';

const API_VERSION = '1.16.1';
const CLIENT = 'NeedleDrop';

function baseUrl() {
  const url = process.env.NAVIDROME_URL;
  if (!url) throw new Error('NAVIDROME_URL is not configured');
  return url.replace(/\/$/, '');
}

export function credentials(username: string, password: string): Session {
  const s = crypto.randomBytes(8).toString('hex');
  const t = crypto.createHash('md5').update(password + s).digest('hex');
  return { u: username, s, t };
}

function authParams(session: Session) {
  return { u: session.u, s: session.s, t: session.t, v: API_VERSION, c: CLIENT, f: 'json' };
}

export async function subsonic(endpoint: string, params: Record<string,string|number|boolean|undefined> = {}, session?: Session) {
  const auth = session ?? await getSession();
  if (!auth) throw new Error('UNAUTHENTICATED');
  const q = new URLSearchParams();
  for (const [k,v] of Object.entries({ ...authParams(auth), ...params })) if (v !== undefined) q.set(k, String(v));
  const res = await fetch(`${baseUrl()}/rest/${endpoint}.view?${q}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Navidrome HTTP ${res.status}`);
  const json = await res.json();
  const root = json['subsonic-response'];
  if (root?.status !== 'ok') throw new Error(root?.error?.message || 'Navidrome request failed');
  return root;
}

export async function mediaUrl(endpoint: 'stream'|'getCoverArt', id: string, extra: Record<string,string> = {}) {
  const auth = await getSession();
  if (!auth) throw new Error('UNAUTHENTICATED');
  const q = new URLSearchParams({ ...authParams(auth), id, ...extra });
  return `${baseUrl()}/rest/${endpoint}.view?${q}`;
}
