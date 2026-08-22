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

export type ArtworkChoice =
  | { kind: 'candidate'; artwork: ArtworkCandidate }
  | { kind: 'navidrome' };

export function resolveCanonicalArtwork(
  albumId: string,
  sourceOrder: string[] = ['discogs', 'coverartarchive', 'navidrome'],
): CanonicalArtworkChoice {
  const album = getAlbumRecord(albumId);
  if (!album) return { album: null, artwork: null, useNavidrome: false };
  const first = orderedArtworkChoices(albumId, sourceOrder)[0];
  if (!first) return { album, artwork: null, useNavidrome: false };
  if (first.kind === 'navidrome') return { album, artwork: null, useNavidrome: true };
  return { album, artwork: first.artwork, useNavidrome: false };
}

export function orderedArtworkChoices(
  albumId: string,
  sourceOrder: string[] = ['discogs', 'coverartarchive', 'navidrome'],
): ArtworkChoice[] {
  const album = getAlbumRecord(albumId);
  if (!album) return [];

  const front = listArtwork(albumId).filter((item) => item.role === 'front' && item.remoteUrl);
  const pinned = album.canonicalArtworkId ? getArtworkById(album.canonicalArtworkId) : null;

  if (album.artworkMode === 'navidrome') {
    return album.navidromeCoverArt ? [{ kind: 'navidrome' }] : fallbackCandidateChoices(front, sourceOrder);
  }

  if (album.artworkMode === 'candidate' && pinned?.remoteUrl) {
    const remaining = front.filter((item) => item.id !== pinned.id);
    return [
      { kind: 'candidate', artwork: pinned },
      ...fallbackCandidateChoices(remaining, sourceOrder),
      ...(album.navidromeCoverArt ? [{ kind: 'navidrome' } as ArtworkChoice] : []),
    ];
  }

  const exact = front.filter((item) => item.scope === 'exact-release').sort((a, b) => candidateRank(a, sourceOrder) - candidateRank(b, sourceOrder));
  const releaseGroup = front.filter((item) => item.scope === 'release-group').sort((a, b) => candidateRank(a, sourceOrder) - candidateRank(b, sourceOrder));
  const library = front.filter((item) => item.scope === 'library' || item.scope === 'manual').sort((a, b) => candidateRank(a, sourceOrder) - candidateRank(b, sourceOrder));

  const choices: ArtworkChoice[] = exact.map((artwork) => ({ kind: 'candidate', artwork }));
  const middle: Array<{ rank: number; choice: ArtworkChoice }> = releaseGroup.map((artwork) => ({ rank: sourceRank(artwork.source, sourceOrder), choice: { kind: 'candidate', artwork } }));
  if (album.navidromeCoverArt) middle.push({ rank: sourceRank('navidrome', sourceOrder), choice: { kind: 'navidrome' } });
  middle.sort((a, b) => a.rank - b.rank);
  choices.push(...middle.map((item) => item.choice));
  choices.push(...library.map((artwork) => ({ kind: 'candidate', artwork } as ArtworkChoice)));
  return dedupeChoices(choices);
}

function fallbackCandidateChoices(candidates: ArtworkCandidate[], sourceOrder: string[]): ArtworkChoice[] {
  return [...candidates]
    .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || candidateRank(a, sourceOrder) - candidateRank(b, sourceOrder))
    .map((artwork) => ({ kind: 'candidate', artwork }));
}

function dedupeChoices(choices: ArtworkChoice[]) {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = choice.kind === 'navidrome' ? 'navidrome' : `candidate:${choice.artwork.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateRank(candidate: ArtworkCandidate, sourceOrder: string[]) {
  return (candidate.userSelected ? -1000 : 0) + sourceRank(candidate.source, sourceOrder) * 10 + candidate.id / 100000;
}

function scopeRank(scope: ArtworkCandidate['scope']) {
  if (scope === 'exact-release') return 0;
  if (scope === 'release-group') return 1;
  if (scope === 'manual') return 2;
  return 3;
}

function sourceRank(source: string, sourceOrder: string[]) {
  const index = sourceOrder.indexOf(source);
  return index < 0 ? sourceOrder.length + 100 : index;
}
