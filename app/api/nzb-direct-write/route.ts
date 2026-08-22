import { NextResponse } from 'next/server';
import {
  getPublicDirectRepairSettings,
  saveDirectRepairSettings,
  testDirectRepairPath,
} from '@/lib/direct-repair';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({
    settings: getPublicDirectRepairSettings(),
    canManage: canManageSettings(session.u),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action !== 'test') return NextResponse.json({ error: 'Unknown direct repair action' }, { status: 400 });
    const result = await testDirectRepairPath({
      libraryPath: typeof body.libraryPath === 'string' ? body.libraryPath : undefined,
    });
    if (!result.exists) return NextResponse.json({ ok: false, result, error: `Direct-library mount not found at ${result.libraryPath}.` }, { status: 409 });
    if (!result.writable) return NextResponse.json({ ok: false, result, error: `Direct-library mount is read-only at ${result.libraryPath}.` }, { status: 409 });
    return NextResponse.json({ ok: true, result, message: `Direct-library mount is writable at ${result.libraryPath}. Existing files will never be overwritten.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Direct repair path test failed' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    saveDirectRepairSettings({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      libraryPath: typeof body.libraryPath === 'string' ? body.libraryPath : undefined,
    });
    return NextResponse.json({ settings: getPublicDirectRepairSettings(), canManage: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save direct repair settings' }, { status: 500 });
  }
}
