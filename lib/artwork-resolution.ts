import {
  getAlbumRecord,
  getArtworkById,
  listArtwork,
  type ArtworkCandidate,
} from './db';

export type CanonicalArtworkChoice = {
  album: ReturnType<typeof getAlbumRecord>;
  artwork: ArtworkCandidate | null;
  useNavidrome: boolean;
};

export function resolveCanonicalArtwork(
  albumId: string,
  sourceOrder: string[] = ['discogs', 'coverartarchive', 'navidrome'],
): CanonicalArtworkChoice {
  const album = getAlbumRecord(albumId);
  if (!album) return { album: null, artwork: null, useNavidrome: false };

  if (album.artworkMode === 'navidrome') {
    return { album, artwork: null, useNavidrome: Boolean(album.navidromeCoverArt) };
  }

  if (album.artworkMode === 'candidate' && album.canonicalArtworkId) {
    const pinned = getArtworkById(album.canonicalArtworkId);
    if (pinned) return { album, artwork: pinned, useNavidrome: false };
  }

  const candidates = listArtwork(albumId).filter((item) => item.role === 'front' && item.remoteUrl);
  const exact = candidates.filter((item) => item.scope === 'exact-release');
  const releaseGroup = candidates.filter((item) => item.scope === 'release-group');
  const library = candidates.filter((item) => item.scope === 'library');

  // An exact pressing image is more specific than a generic library cover and
  // wins in Auto mode. Users can still explicitly force Navidrome or pin any
  // individual candidate from the artwork picker.
  const exactChoice = chooseBySource(exact, sourceOrder);
  if (exactChoice) return { album, artwork: exactChoice, useNavidrome: false };

  const groupChoice = chooseBySource(releaseGroup, sourceOrder);
  const groupDecision = chooseAgainstNavidrome(groupChoice, Boolean(album.navidromeCoverArt), sourceOrder);
  if (groupDecision) return { album, ...groupDecision };

  const libraryChoice = chooseBySource(library, sourceOrder);
  const libraryDecision = chooseAgainstNavidrome(libraryChoice, Boolean(album.navidromeCoverArt), sourceOrder);
  if (libraryDecision) return { album, ...libraryDecision };

  return { album, artwork: null, useNavidrome: Boolean(album.navidromeCoverArt) };
}

function chooseBySource(candidates: ArtworkCandidate[], sourceOrder: string[]) {
  return [...candidates].sort((left, right) => {
    if (left.userSelected !== right.userSelected) return left.userSelected ? -1 : 1;
    return sourceRank(left.source, sourceOrder) - sourceRank(right.source, sourceOrder) || left.id - right.id;
  })[0] || null;
}

function chooseAgainstNavidrome(
  candidate: ArtworkCandidate | null,
  navidromeAvailable: boolean,
  sourceOrder: string[],
): Pick<CanonicalArtworkChoice, 'artwork' | 'useNavidrome'> | null {
  if (!candidate && !navidromeAvailable) return null;
  if (!candidate) return { artwork: null, useNavidrome: true };
  if (!navidromeAvailable) return { artwork: candidate, useNavidrome: false };

  const navidromeRank = sourceRank('navidrome', sourceOrder);
  const candidateRank = sourceRank(candidate.source, sourceOrder);
  return navidromeRank < candidateRank
    ? { artwork: null, useNavidrome: true }
    : { artwork: candidate, useNavidrome: false };
}

function sourceRank(source: string, sourceOrder: string[]) {
  const index = sourceOrder.indexOf(source);
  return index < 0 ? sourceOrder.length + 100 : index;
}
