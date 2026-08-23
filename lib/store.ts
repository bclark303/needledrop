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
 * later. Some of the oldest records also have meta.images but no persisted
 * discogsReleaseId. Album view can still render those images directly, so the
 * canonical resolver must not require a release id in order to recover them.
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
  if (!meta.images?.length) return candidates;

  meta.images.forEach((image, index) => {
    const remoteUrl = image.uri || image.uri150;
    if (!remoteUrl) return;
    const chosen = meta.artworkSource === 'discogs' && meta.discogsImageIndex === index;
    const isPrimary = image.type === 'primary' || index === 0;
    const releaseKey = meta.discogsReleaseId ? String(meta.discogsReleaseId) : 'legacy';
    const candidateId = upsertArtworkCandidate({
      albumId,
      source: 'discogs',
      scope: meta.discogsReleaseId || meta.source === 'discogs' ? 'exact-release' : 'library',
      role: isPrimary || chosen ? 'front' : 'other',
      sourceKey: `discogs:${releaseKey}:${index}`,
      sourceId: meta.discogsReleaseId ? String(meta.discogsReleaseId) : undefined,
      remoteUrl,
      width: image.width,
      height: image.height,
      userSelected: chosen,
    });
    candidates += 1;
    if (chosen) setArtworkMode(albumId, 'candidate', candidateId);
  });
  return candidates;
}
