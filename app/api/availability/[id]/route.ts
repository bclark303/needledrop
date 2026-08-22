import { NextResponse } from 'next/server';
import type { AlbumDetail, VinylMeta } from '@/components/types';
import {
  recordLidarrRequest,
  refreshLatestLidarrRequest,
  resolveVirtualRelease,
  type ReleaseAvailability,
} from '@/lib/collection-engine';
import { getAlbumRecord, updateAlbumIdentity } from '@/lib/db';
import {
  getPublicDirectRepairSettings,
  maybePromoteDirectRepair,
  requestDirectPromotion,
  validateDirectRepairTarget,
} from '@/lib/direct-repair';
import { requestAlbumSearch } from '@/lib/lidarr';
import { findReleaseGroup } from '@/lib/musicbrainz';
import {
  nzbRepairConfigured,
  refreshNzbRepairRequest,
  searchNzbRepairCandidates,
  startNzbRepair,
  type MissingRepairTrack,
} from '@/lib/nzb-repair';
import { getAlbumRepairOverrides, saveAlbumRepairOverrides } from '@/lib/repair-overrides';
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
    const missing = repairTracks(resolved.availability);
    const [request, repair] = await Promise.all([
      refreshLatestLidarrRequest(id, resolved.availability),
      refreshNzbRepairRequest(id, missing),
    ]);
    const directPromotion = await maybePromoteDirectRepair(repair);
    return NextResponse.json({
      availability: resolved.availability,
      request,
      repair,
      directPromotion,
      repairOptions: publicRepairOptions(id, resolved.album.name),
      repairConfigured: nzbRepairConfigured(),
      directWriteEnabled: getPublicDirectRepairSettings().enabled,
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
    const body = await request.json().catch(() => ({})) as {
      action?: string;
      candidateId?: string;
      destinationMode?: 'repair-library' | 'album-folder';
      searchTitle?: string;
      folderName?: string;
    };
    const resolved = await resolve(id);
    const missing = repairTracks(resolved.availability);

    if (body.action === 'recheck') {
      const [latest, repair] = await Promise.all([
        refreshLatestLidarrRequest(id, resolved.availability),
        refreshNzbRepairRequest(id, missing),
      ]);
      const directPromotion = await maybePromoteDirectRepair(repair);
      return NextResponse.json({
        ok: true,
        availability: resolved.availability,
        request: latest,
        repair,
        directPromotion,
        repairOptions: publicRepairOptions(id, resolved.album.name),
        repairConfigured: nzbRepairConfigured(),
        directWriteEnabled: getPublicDirectRepairSettings().enabled,
      });
    }

    if (body.action === 'save-repair-options') {
      saveRepairOptions(id, body);
      return NextResponse.json({
        ok: true,
        repairOptions: publicRepairOptions(id, resolved.album.name),
      });
    }

    if (!resolved.meta?.sides?.length) return NextResponse.json({ error: 'Select a Discogs or MusicBrainz release before repairing missing tracks.' }, { status: 400 });
    if (!missing.length) return NextResponse.json({ error: 'This selected release is already fully playable.' }, { status: 400 });

    if (body.action === 'search-nzb') {
      saveRepairOptions(id, body);
      const options = publicRepairOptions(id, resolved.album.name);
      const candidates = await searchNzbRepairCandidates({
        albumId: id,
        artist: resolved.album.artist,
        albumTitle: options.searchTitle,
        missingTracks: missing,
      });
      return NextResponse.json({
        ok: true,
        availability: resolved.availability,
        candidates,
        repairOptions: options,
        repairConfigured: nzbRepairConfigured(),
        directWriteEnabled: getPublicDirectRepairSettings().enabled,
      });
    }

    if (body.action === 'start-nzb') {
      if (!body.candidateId) return NextResponse.json({ error: 'Choose an NZB candidate first.' }, { status: 400 });
      saveRepairOptions(id, body);
      const options = publicRepairOptions(id, resolved.album.name);
      const directRequested = body.destinationMode === 'album-folder';
      if (directRequested) await validateDirectRepairTarget(id);

      const repair = await startNzbRepair({
        albumId: id,
        artist: resolved.album.artist,
        // The repair title controls the safe-import directory. This lets an album whose
        // Navidrome title includes release noise use a clean, user-selected folder name.
        albumTitle: options.folderName,
        missingTracks: missing,
        candidateId: body.candidateId,
      });
      if (!repair) throw new Error('NeedleDrop queued the repair but could not persist its repair record.');
      const directPromotion = directRequested ? requestDirectPromotion(repair.id, id) : null;
      return NextResponse.json({
        ok: true,
        availability: resolved.availability,
        repair,
        directPromotion,
        repairOptions: options,
        repairConfigured: true,
        directWriteEnabled: getPublicDirectRepairSettings().enabled,
      });
    }

    if (body.action !== 'request-lidarr') return NextResponse.json({ error: 'Unknown availability action' }, { status: 400 });

    let mbid = releaseGroupMbid(id, resolved.meta);
    if (!mbid) {
      const match = await findReleaseGroup(resolved.album.artist, resolved.album.name).catch(() => null);
      if (!match?.id) return NextResponse.json({ error: 'NeedleDrop could not determine a MusicBrainz release group for Lidarr.' }, { status: 409 });
      mbid = match.id;
      const nextMeta: VinylMeta = { ...(resolved.meta || {}), musicbrainzReleaseGroupId: mbid };
      await saveMeta(id, nextMeta);
      updateAlbumIdentity(id, { musicbrainzReleaseGroupId: mbid });
    }

    const lidarrMissing = missing.map((track) => ({ position: track.position, title: track.title }));
    const lidarr = await requestAlbumSearch({ artist: resolved.album.artist, title: resolved.album.name, releaseGroupMbid: mbid });
    recordLidarrRequest(id, mbid, lidarrMissing, lidarr);
    const latest = await refreshLatestLidarrRequest(id, resolved.availability);
    return NextResponse.json({ ok: true, availability: resolved.availability, request: latest });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not repair missing tracks';
    const status = message === 'LIDARR_NOT_CONFIGURED' || message.startsWith('NZB_REPAIR_') || message === 'DIRECT_REPAIR_NOT_ENABLED' ? 503 : 500;
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

function repairTracks(availability: ReleaseAvailability): MissingRepairTrack[] {
  return availability.tracks
    .map((track, index) => ({ ...track, ordinal: index + 1 }))
    .filter((track) => !track.available)
    .map((track) => ({
      side: track.side,
      position: track.position,
      title: track.title,
      duration: track.duration,
      ordinal: track.ordinal,
    }));
}

function saveRepairOptions(id: string, body: { searchTitle?: string; folderName?: string }) {
  saveAlbumRepairOverrides(id, {
    searchTitle: typeof body.searchTitle === 'string' ? body.searchTitle : undefined,
    folderName: typeof body.folderName === 'string' ? body.folderName : undefined,
  });
}

function publicRepairOptions(id: string, albumTitle: string) {
  const overrides = getAlbumRepairOverrides(id);
  return {
    searchTitle: overrides.searchTitle || albumTitle,
    folderName: overrides.folderName || albumTitle,
    searchTitleOverridden: Boolean(overrides.searchTitle),
    folderNameOverridden: Boolean(overrides.folderName),
  };
}

function releaseGroupMbid(id: string, meta: VinylMeta | null) {
  return meta?.musicbrainzReleaseGroupId || getAlbumRecord(id)?.musicbrainzReleaseGroupId;
}
