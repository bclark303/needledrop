import type { VinylMeta as SharedVinylMeta } from '@/components/types';
import { getAlbumMetaJson, setAlbumMetaJson, setArtworkMode, upsertArtworkCandidate } from './db';

export type VinylMeta = SharedVinylMeta & {
  albumId: string;
  updatedAt: string;
};

export async function getMeta(id: string) {
  return getAlbumMetaJson<VinylMeta>(id);
}

export async function saveMeta(id: string, patch: Partial<VinylMeta>) {
  const current = getAlbumMetaJson<VinylMeta>(id);
  const next = {
    ...(current || {}),
    ...patch,
    albumId: id,
    updatedAt: new Date().toISOString(),
  } as VinylMeta;

  setAlbumMetaJson(id, next);
  syncArtworkSelection(id, next);
  return next;
}

/**
 * Older NeedleDrop installs can have perfectly usable Discogs artwork saved in
 * album_meta without matching rows in the canonical artwork table introduced
 * later. Album view can render those legacy meta.images directly, but collection
 * cards resolve artwork only through the canonical table. This idempotent helper
 * brings old metadata forward without changing an existing automatic/pinned
 * artwork mode unless the legacy metadata contains an explicit selection.
 */
export function backfillArtworkCandidatesFromMeta(albumId: string, meta?: SharedVinylMeta | null) {
  if (!meta) return 0;
  const candidates = syncDiscogsArtworkCandidates(albumId, meta);
  if (meta.artworkSource === 'navidrome') setArtworkMode(albumId, 'navidrome');
  return candidates;
}

function syncArtworkSelection(albumId: string, meta: VinylMeta) {
  syncDiscogsArtworkCandidates(albumId, meta);
  if (meta.artworkSource === 'navidrome') setArtworkMode(albumId, 'navidrome');
  if (!meta.artworkSource) setArtworkMode(albumId, 'auto');
}

function syncDiscogsArtworkCandidates(albumId: string, meta: SharedVinylMeta) {
  let candidates = 0;
  if (!meta.images?.length || !meta.discogsReleaseId) return candidates;

  meta.images.forEach((image, index) => {
    if (!image.uri) return;
    const chosen = meta.artworkSource === 'discogs' && meta.discogsImageIndex === index;
    const isPrimary = image.type === 'primary' || index === 0;
    const candidateId = upsertArtworkCandidate({
      albumId,
      source: 'discogs',
      scope: 'exact-release',
      role: isPrimary || chosen ? 'front' : 'other',
      sourceKey: `discogs:${meta.discogsReleaseId}:${index}`,
      sourceId: String(meta.discogsReleaseId),
      remoteUrl: image.uri,
      width: image.width,
      height: image.height,
      userSelected: chosen,
    });
    candidates += 1;
    if (chosen) setArtworkMode(albumId, 'candidate', candidateId);
  });
  return candidates;
}
