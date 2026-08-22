export type LastFmAlbumInfo = {
  mbid?: string;
  url?: string;
  listeners?: number;
  playcount?: number;
  tags: string[];
  summary?: string;
  content?: string;
};

export async function getLastFmAlbumInfo(artist: string, album: string, apiKey: string): Promise<LastFmAlbumInfo> {
  if (!apiKey.trim()) throw new Error('Last.fm API key is not configured');
  const query = new URLSearchParams({
    method: 'album.getInfo',
    api_key: apiKey,
    artist,
    album,
    autocorrect: '1',
    format: 'json',
  });
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`, {
    headers: { 'User-Agent': 'NeedleDrop/0.5.0 (https://github.com/bclark303/needledrop)' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Last.fm HTTP ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  if (data.error) throw new Error(String(data.message || `Last.fm error ${data.error}`));
  const info = (data.album || {}) as Record<string, unknown>;
  const tagsBlock = info.tags as { tag?: Array<{ name?: string }> } | undefined;
  const wiki = info.wiki as { summary?: string; content?: string } | undefined;
  return {
    mbid: info.mbid ? String(info.mbid) : undefined,
    url: info.url ? String(info.url) : undefined,
    listeners: info.listeners == null ? undefined : Number(info.listeners),
    playcount: info.playcount == null ? undefined : Number(info.playcount),
    tags: (tagsBlock?.tag || []).map((tag) => tag.name?.trim()).filter((tag): tag is string => Boolean(tag)),
    summary: plainText(wiki?.summary),
    content: plainText(wiki?.content),
  };
}

export async function testLastFm(apiKey: string) {
  const info = await getLastFmAlbumInfo('Pink Floyd', 'The Dark Side of the Moon', apiKey);
  return { tags: info.tags.length, url: info.url };
}

function plainText(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
