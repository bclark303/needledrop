import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canManageSettings, getPublicSettings, getStoredSettings, saveSettings } from '@/lib/settings';
import type { AppSettingsPatch } from '@/components/types';
import { APP_VERSION } from '@/lib/version';
import { getNavidromeLibraries } from '@/lib/subsonic';
import { invalidateLibraryIndexSnapshot } from '@/lib/library';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ settings: await publicSettings(session), version: APP_VERSION });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const patch = await request.json() as AppSettingsPatch;
    if (patch.navidromeMusicFolderId) {
      const libraries = await getNavidromeLibraries(session);
      if (!libraries.some((library) => library.id === patch.navidromeMusicFolderId)) {
        return NextResponse.json({ error: 'The selected Navidrome library is not available to this user' }, { status: 400 });
      }
    }
    const previous = await getStoredSettings();
    await saveSettings(patch);
    if (typeof patch.navidromeMusicFolderId === 'string'
      && patch.navidromeMusicFolderId.trim() !== (previous.navidromeMusicFolderId || '')) {
      invalidateLibraryIndexSnapshot(patch.navidromeMusicFolderId.trim());
    }
    return NextResponse.json({ settings: await publicSettings(session), version: APP_VERSION });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save settings' }, { status: 400 });
  }
}

async function publicSettings(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const [settings, navidromeLibraries] = await Promise.all([
    getPublicSettings(session.u),
    getNavidromeLibraries(session).catch(() => []),
  ]);
  return { ...settings, navidromeLibraries };
}
