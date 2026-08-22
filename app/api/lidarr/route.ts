import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';
import {
  getLidarrOptions,
  getPublicLidarrSettings,
  saveLidarrSettings,
  testLidarrConnection,
} from '@/lib/lidarr';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const settings = getPublicLidarrSettings();
  let options = null;
  if (settings.url && settings.apiKeyConfigured) options = await getLidarrOptions().catch(() => null);
  return NextResponse.json({ settings, options, canManage: canManageSettings(session.u) });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const body = await request.json() as {
      url?: string;
      apiKey?: string;
      clearApiKey?: boolean;
      rootFolderPath?: string;
      qualityProfileId?: number;
      metadataProfileId?: number;
    };
    saveLidarrSettings(body);
    const settings = getPublicLidarrSettings();
    const options = settings.url && settings.apiKeyConfigured ? await getLidarrOptions().catch(() => null) : null;
    return NextResponse.json({ ok: true, settings, options, canManage: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save Lidarr settings' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const body = await request.json() as { action?: string; url?: string; apiKey?: string };
    if (body.action !== 'test') return NextResponse.json({ error: 'Unknown Lidarr action' }, { status: 400 });
    const status = await testLidarrConnection(body.url, body.apiKey);
    return NextResponse.json({ ok: true, message: `${status.appName} ${status.version || ''} responded successfully.`.trim() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Lidarr connection test failed' }, { status: 400 });
  }
}
