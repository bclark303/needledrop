import { NextResponse } from 'next/server';
import {
  getLibraryScanStatus,
  listDuplicateGroups,
  listMerges,
  mergeAlbums,
  startLibraryRescan,
  unmergeAlbum,
} from '@/lib/library';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json(snapshot());
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({})) as {
      action?: 'scan' | 'merge' | 'unmerge';
      canonicalId?: string;
      aliasIds?: string[];
      aliasId?: string;
    };

    if (body.action === 'scan') {
      const status = startLibraryRescan();
      return NextResponse.json({ ...snapshot(), status });
    }

    if (body.action === 'merge') {
      if (!body.canonicalId || !Array.isArray(body.aliasIds)) {
        return NextResponse.json({ error: 'canonicalId and aliasIds are required' }, { status: 400 });
      }
      mergeAlbums(body.canonicalId, body.aliasIds);
      return NextResponse.json(snapshot());
    }

    if (body.action === 'unmerge') {
      if (!body.aliasId) return NextResponse.json({ error: 'aliasId is required' }, { status: 400 });
      unmergeAlbum(body.aliasId);
      return NextResponse.json(snapshot());
    }

    return NextResponse.json({ error: 'Unknown library action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Library action failed';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}

function snapshot() {
  return {
    status: getLibraryScanStatus(),
    duplicates: listDuplicateGroups(),
    merges: listMerges(),
  };
}
