export type Album = { id:string; name:string; artist:string; artistId?:string; coverArt?:string; year?:number; genre?:string; songCount?:number; duration?:number; created?:string; starred?:string };
export type Song = { id:string; title:string; artist:string; album:string; track?:number; discNumber?:number; duration?:number; coverArt?:string; suffix?:string; bitRate?:number; bitDepth?:number; samplingRate?:number };
export type AlbumDetail = Album & { song:Song[] };
export type VinylMeta = { pressingId?:string;pressingLabel?:string;catalogNumber?:string;country?:string;releaseYear?:number;vinylColor?:string;condition?:string;acquiredAt?:string;notes?:string;crate?:string;sideBreakAfterTrack?:number };
