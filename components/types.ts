export type Album = {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverArt?: string;
  year?: number;
  genre?: string;
  songCount?: number;
  duration?: number;
  created?: string;
  starred?: string;
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

export type ArtworkSource = 'discogs' | 'navidrome';
export type MetadataSource = 'discogs' | 'musicbrainz';
export type PlaybackMode = 'vinyl' | 'normal';
export type TurntableSpeed = 33.333 | 45 | 78;

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
  artworkSource?: ArtworkSource;
  discogsImageIndex?: number;
};

export type AppSettings = {
  navidromeUrl: string;
  discogsEnabled: boolean;
  discogsTokenConfigured: boolean;
  musicbrainzEnabled: boolean;
  musicbrainzUserAgent: string;
  metadataSourceOrder: MetadataSource[];
  artworkSourceOrder: ArtworkSource[];
  defaultPlaybackMode: PlaybackMode;
  defaultTurntableSpeed: TurntableSpeed;
  simulateSpeed: boolean;
  changerEnabled: boolean;
  canManage: boolean;
};

export type AppSettingsPatch = Partial<Omit<AppSettings, 'discogsTokenConfigured' | 'canManage'>> & {
  discogsToken?: string;
  clearDiscogsToken?: boolean;
};
