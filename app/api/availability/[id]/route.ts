import { NextResponse } from 'next/server';
import type { AlbumDetail, VinylMeta } from '@/components/types';
import {
  recordLidarrRequest,
  refreshLatestLidarrRequest,
  resolveVirtualRelease,
} from '@/lib/collection-engine';
import { getAlbumRecord, updateAlbumIdentity } from '@/lib/db';
import { requestAlbumSearch } from '@/lib/lidarr';
import { findReleaseGroup } from '@/lib/musicbrainz';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';
import { getMeta, saveMeta } from '@/lib/store';
import { subsonic } from '@/lib/subsonic';

export const runtime = 'nodejs';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    const resolved = await resolve(id);
    const request = await refreshLatestLidarrRequest(id, resolved.availability);
    return NextResponse.json({
      availability: resolved.availability,
      request,
      releaseGroupMbid: releaseGroupMbid(id, resolved.meta),
      canRequest: canManageSettings(session.u),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not resolve release availability';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHENTICATED' ? 401 : 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    const resolved = await resolve(id);
    if (body.action === 'recheck') {
      const latest = await refreshLatestLidarrRequest(id, resolved.availability);
      return NextResponse.json({ ok: true, availability: resolved.availability, request: latest });
    }
    if (body.action !== 'request-lidarr') return NextResponse.json({ error: 'Unknown availability action' }, { status: 400 });
    if (!resolved.meta?.sides?.length) return NextResponse.json({ error: 'Select a Discogs or MusicBrainz release before requesting missing tracks.' }, { status: 400 });
    if (!resolved.availability.missingTracks.length) return NextResponse.json({ error: 'This selected release is already fully playable.' }, { status: 400 });

    let mbid = releaseGroupMbid(id, resolved.meta);
    if (!mbid) {
      const match = await findReleaseGroup(resolved.album.artist, resolved.album.name).catch(() => null);
      if (!match?.id) return NextResponse.json({ error: 'NeedleDrop could not determine a MusicBrainz release group for Lidarr.' }, { status: 409 });
      mbid = match.id;
      const nextMeta: VinylMeta = { ...(resolved.meta || {}), musicbrainzReleaseGroupId: mbid };
      await saveMeta(id, nextMeta);
      updateAlbumIdentity(id, { musicbrainzReleaseGroupId: mbid });
    }

    const missing = resolved.availability.missingTracks.map((track) => ({ position: track.position, title: track.title }));
    const lidarr = await requestAlbumSearch({ artist: resolved.album.artist, title: resolved.album.name, releaseGroupMbid: mbid });
    recordLidarrRequest(id, mbid, missing, lidarr);
    const latest = await refreshLatestLidarrRequest(id, resolved.availability);
    return NextResponse.json({ ok: true, availability: resolved.availability, request: latest });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not request missing tracks from Lidarr';
    const status = message === 'LIDARR_NOT_CONFIGURED' ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function resolve(id: string) {
  const [root, meta] = await Promise.all([subsonic('getAlbum', { id }), getMeta(id)]);
  const album = root.album as AlbumDetail;
  const resolved = await resolveVirtualRelease(album, meta);
  if (resolved.meta && meta && JSON.stringify(resolved.meta.sides) !== JSON.stringify(meta.sides)) await saveMeta(id, resolved.meta);
  return resolved;
}

function releaseGroupMbid(id: string, meta: VinylMeta | null) {
  return meta?.musicbrainzReleaseGroupId || getAlbumRecord(id)?.musicbrainzReleaseGroupId;
}
