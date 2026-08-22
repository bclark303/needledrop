import { APP_VERSION } from './version';

export type CoverArtArchiveImage = {
  id?: number | string;
  image?: string;
  front?: boolean;
  back?: boolean;
  types?: string[];
  thumbnails?: Record<string, string>;
  approved?: boolean;
};

export async function getCoverArtArchiveImages(scope: 'release' | 'release-group', id: string) {
  const response = await fetch(`https://coverartarchive.org/${scope}/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)` },
    cache: 'no-store',
    redirect: 'follow',
  });
  if (response.status === 404) return [] as CoverArtArchiveImage[];
  if (!response.ok) throw new Error(`Cover Art Archive HTTP ${response.status}`);
  const data = await response.json() as { images?: CoverArtArchiveImage[] };
  return data.images || [];
}

export function artworkRole(image: CoverArtArchiveImage) {
  if (image.front || image.types?.some((type) => type.toLowerCase() === 'front')) return 'front';
  if (image.back || image.types?.some((type) => type.toLowerCase() === 'back')) return 'back';
  const type = image.types?.[0]?.toLowerCase();
  if (type?.includes('booklet')) return 'booklet';
  if (type?.includes('medium') || type?.includes('disc')) return 'label';
  if (type?.includes('spine')) return 'spine';
  return type || 'other';
}
