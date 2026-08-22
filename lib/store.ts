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

function syncArtworkSelection(albumId: string, meta: VinylMeta) {
  if (meta.images?.length && meta.discogsReleaseId) {
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
      if (chosen) setArtworkMode(albumId, 'candidate', candidateId);
    });
  }

  if (meta.artworkSource === 'navidrome') setArtworkMode(albumId, 'navidrome');
  if (!meta.artworkSource) setArtworkMode(albumId, 'auto');
}
