export type Album = {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverArt?: string;
  navidromeCoverArt?: string;
  year?: number;
  genre?: string;
  songCount?: number;
  duration?: number;
  created?: string;
  starred?: string;
  rating?: number;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string;
  track?: number;
  discNumber?: number;
  duration?: number;
  coverArt?: string;
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
};

export type AlbumDetail = Album & { song: Song[] };

export type DiscogsTrack = {
  position: string;
  title: string;
  duration?: string;
  type?: string;
  navidromeSongId?: string;
  navidromeIndex?: number;
};

export type DiscogsSide = {
  label: string;
  tracks: DiscogsTrack[];
};

export type DiscogsImage = {
  type?: string;
  uri?: string;
  uri150?: string;
  width?: number;
  height?: number;
};

export type DiscogsCredit = {
  name: string;
  role?: string;
  tracks?: string;
};

export type DiscogsIdentifier = {
  type?: string;
  value?: string;
  description?: string;
};

export type ArtworkSource = 'discogs' | 'coverartarchive' | 'navidrome';
export type MetadataSource = 'discogs' | 'musicbrainz' | 'lastfm';
export type PlaybackMode = 'vinyl' | 'normal';
export type TurntableSpeed = 33.333 | 45 | 78;

export type CollectionSort = 'artist' | 'album' | 'yearAsc' | 'yearDesc' | 'rating' | 'newest' | 'recent' | 'frequent' | 'starred';
export type CollectionViewMode = 'grid' | 'shelf' | 'flip';
export type CollectionGroupMode = 'none' | 'artist' | 'decade' | 'year';
export type RecordRoomTheme = 'audiophile' | 'teen-bedroom' | 'record-store';
export type RecordRoomShelfPresentation = 'shelf' | 'crate';
export type RecordRoomSmartRule =
  | { type: 'starred' }
  | { type: 'rating'; minimum: number }
  | { type: 'decade'; decade: number }
  | { type: 'genre'; value: string }
  | { type: 'recent'; days: number };

export type RecordRoomShelf = {
  id: string;
  name: string;
  kind: 'manual' | 'smart';
  presentation: RecordRoomShelfPresentation;
  albumIds?: string[];
  rule?: RecordRoomSmartRule;
};

export type RecordRoomConfig = {
  theme: RecordRoomTheme;
  sort: CollectionSort;
  viewMode: CollectionViewMode;
  groupMode: CollectionGroupMode;
  activeShelfId?: string;
  featuredAlbumIds: string[];
  shelves: RecordRoomShelf[];
};

export type CanonicalArtworkCandidate = {
  id: number;
  albumId: string;
  source: ArtworkSource | 'manual';
  scope: 'exact-release' | 'release-group' | 'library' | 'manual';
  role: string;
  sourceKey: string;
  sourceId?: string;
  remoteUrl?: string;
  width?: number;
  height?: number;
  userSelected: boolean;
};

export type AlbumLibraryRecord = {
  albumId: string;
  artist: string;
  title: string;
  year?: number;
  navidromeCoverArt?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  lastfmMbid?: string;
  lastfmUrl?: string;
  lastfmListeners?: number;
  lastfmPlaycount?: number;
  lastfmSummary?: string;
  lastfmTags?: string[];
  artworkMode: 'auto' | 'navidrome' | 'candidate';
  canonicalArtworkId?: number;
  enrichmentStatus?: string;
  enrichmentError?: string;
  enrichedAt?: string;
};

export type EnrichmentStatus = {
  state: 'idle' | 'running' | 'complete' | 'error';
  total: number;
  completed: number;
  matched: number;
  artworkResolved: number;
  failed: number;
  currentAlbum?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
};

export type VinylMeta = {
  pressingId?: string;
  source?: 'discogs' | 'musicbrainz' | 'manual';
  pressingLabel?: string;
  pressingTitle?: string;
  catalogNumber?: string;
  country?: string;
  releaseYear?: number;
  released?: string;
  formatDescription?: string;
  formatQuantity?: number;
  vinylColor?: string;
  condition?: string;
  acquiredAt?: string;
  notes?: string;
  crate?: string;
  rating?: number;
  sideBreakAfterTrack?: number;
  discogsReleaseId?: number;
  discogsMasterId?: number;
  discogsUri?: string;
  genres?: string[];
  styles?: string[];
  releaseNotes?: string;
  identifiers?: DiscogsIdentifier[];
  credits?: DiscogsCredit[];
  images?: DiscogsImage[];
  sides?: DiscogsSide[];
  trackMappingWarnings?: string[];
  discogsFetchedAt?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  lastfmTags?: string[];
  lastfmSummary?: string;
  lastfmUrl?: string;
  enrichedAt?: string;
  artworkSource?: ArtworkSource;
  discogsImageIndex?: number;
};

export type AppSettings = {
  navidromeUrl: string;
  discogsEnabled: boolean;
  discogsTokenConfigured: boolean;
  musicbrainzEnabled: boolean;
  musicbrainzUserAgent: string;
  coverArtArchiveEnabled: boolean;
  lastfmEnabled: boolean;
  lastfmApiKeyConfigured: boolean;
  autoEnrich: boolean;
  metadataSourceOrder: MetadataSource[];
  artworkSourceOrder: ArtworkSource[];
  defaultPlaybackMode: PlaybackMode;
  defaultTurntableSpeed: TurntableSpeed;
  simulateSpeed: boolean;
  changerEnabled: boolean;
  canManage: boolean;
};

export type AppSettingsPatch = Partial<Omit<AppSettings, 'discogsTokenConfigured' | 'lastfmApiKeyConfigured' | 'canManage'>> & {
  discogsToken?: string;
  clearDiscogsToken?: boolean;
  lastfmApiKey?: string;
  clearLastfmApiKey?: boolean;
};
