import { NextResponse } from 'next/server';
import { getRecordRoom, saveRecordRoom } from '@/lib/record-room';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ room: getRecordRoom(session.u) });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json({ room: saveRecordRoom(session.u, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save Record Room' }, { status: 400 });
  }
}
