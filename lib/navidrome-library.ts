const MUSIC_FOLDER_SCOPED_ENDPOINTS = new Set([
  'getAlbumList',
  'getAlbumList2',
  'getArtists',
  'getGenres',
  'getIndexes',
  'getRandomSongs',
  'getSongsByGenre',
  'getStarred',
  'getStarred2',
  'search2',
  'search3',
]);

export function scopeNavidromeParams(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  selectedMusicFolderId: string,
) {
  if (!selectedMusicFolderId || !MUSIC_FOLDER_SCOPED_ENDPOINTS.has(endpoint) || params.musicFolderId !== undefined) return params;
  return { ...params, musicFolderId: selectedMusicFolderId };
}

export function navidromeEndpointSupportsLibraryScope(endpoint: string) {
  return MUSIC_FOLDER_SCOPED_ENDPOINTS.has(endpoint);
}
