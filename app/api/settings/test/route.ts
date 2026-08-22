import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { authParams } from '@/lib/subsonic';
import { canManageSettings, getStoredSettings } from '@/lib/settings';
import { testDiscogsConnection } from '@/lib/discogs';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json() as { service?: string; navidromeUrl?: string; discogsToken?: string; musicbrainzUserAgent?: string };
    const current = await getStoredSettings();

    if (body.service === 'navidrome') {
      const base = (body.navidromeUrl?.trim() || current.navidromeUrl || '').replace(/\/$/, '');
      if (!base) throw new Error('Navidrome URL is empty');
      const params = new URLSearchParams(authParams(session));
      const response = await fetch(`${base}/rest/ping.view?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Navidrome HTTP ${response.status}`);
      const json = await response.json();
      const root = json['subsonic-response'];
      if (root?.status !== 'ok') throw new Error(root?.error?.message || 'Navidrome rejected the request');
      return NextResponse.json({ ok: true, message: `Navidrome ${root.version || ''} responded successfully.`.trim() });
    }

    if (body.service === 'discogs') {
      const identity = await testDiscogsConnection(body.discogsToken);
      return NextResponse.json({ ok: true, message: `Discogs authenticated as ${identity.username || 'your account'}.` });
    }

    if (body.service === 'musicbrainz') {
      const userAgent = body.musicbrainzUserAgent?.trim() || current.musicbrainzUserAgent || '';
      if (!userAgent) throw new Error('MusicBrainz User-Agent is empty');
      const url = 'https://musicbrainz.org/ws/2/artist/?query=artist%3APink%20Floyd&fmt=json&limit=1';
      const response = await fetch(url, { headers: { 'User-Agent': userAgent }, cache: 'no-store' });
      if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
      return NextResponse.json({ ok: true, message: 'MusicBrainz responded successfully.' });
    }

    return NextResponse.json({ error: 'Unknown service' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Connection test failed' }, { status: 400 });
  }
}
