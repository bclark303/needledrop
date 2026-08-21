import { NextResponse } from 'next/server';
import { credentials, subsonic } from '@/lib/subsonic';
import { setSession } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    const session = credentials(username, password);
    await subsonic('ping', {}, session);
    await setSession(session);
    return NextResponse.json({ ok: true, username });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Login failed' }, { status: 401 });
  }
}
