import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canManageSettings, getPublicSettings, saveSettings } from '@/lib/settings';
import type { AppSettingsPatch } from '@/components/types';
import { APP_VERSION } from '@/lib/version';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ settings: await getPublicSettings(session.u), version: APP_VERSION });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const patch = await request.json() as AppSettingsPatch;
    await saveSettings(patch);
    return NextResponse.json({ settings: await getPublicSettings(session.u), version: APP_VERSION });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save settings' }, { status: 400 });
  }
}
