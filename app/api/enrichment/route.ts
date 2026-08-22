import { NextResponse } from 'next/server';
import type { Album } from '@/components/types';
import { getEnrichmentStatus, indexAlbums } from '@/lib/db';
import { startEnrichment } from '@/lib/enrichment';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ status: getEnrichmentStatus() });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const albums = await loadAllAlbums();
    indexAlbums(albums);
    const status = startEnrichment(albums, body.force === true);
    return NextResponse.json({ ok: true, albums: albums.length, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start enrichment';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}

async function loadAllAlbums() {
  const albums: Album[] = [];
  const seen = new Set<string>();
  const size = 500;

  for (let offset = 0; offset < 25000; offset += size) {
    const root = await subsonic('getAlbumList2', { type: 'alphabeticalByArtist', size, offset });
    const page = (root.albumList2?.album || []) as Album[];
    for (const album of page) {
      if (!album?.id || seen.has(album.id)) continue;
      seen.add(album.id);
      albums.push(album);
    }
    if (page.length < size) break;
  }

  return albums;
}
