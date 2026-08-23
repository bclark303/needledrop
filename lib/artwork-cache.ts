import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { APP_VERSION } from './version';

const DATA_DIR = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA_DIR, 'artwork-cache');
const MAX_EXTERNAL_CONCURRENCY = 4;
const MAX_ARTWORK_BYTES = 25 * 1024 * 1024;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

let activeExternalFetches = 0;
const externalWaiters: Array<() => void> = [];
const failedUntil = new Map<string, number>();

type CachedMetadata = {
  contentType: string;
  source: string;
  cachedAt: string;
};

export async function fetchCachedExternalArtwork(
  value: string,
  configuredUserAgent?: string,
  discogsToken?: string,
): Promise<Response | null> {
  let url: URL;
  try { url = new URL(value); } catch { return null; }

  const allowed = ['discogs.com', 'coverartarchive.org', 'archive.org']
    .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !allowed) return null;

  const key = crypto.createHash('sha256').update(url.toString()).digest('hex');
  const cached = await readCachedArtwork(key);
  if (cached) return cachedResponse(cached.bytes, cached.meta, 'hit');

  const blockedUntil = failedUntil.get(key) || 0;
  if (blockedUntil > Date.now()) return null;
  failedUntil.delete(key);

  return withExternalSlot(async () => {
    // Another request may have populated the cache while this one waited.
    const secondLook = await readCachedArtwork(key);
    if (secondLook) return cachedResponse(secondLook.bytes, secondLook.meta, 'hit-after-wait');

    const headers: Record<string, string> = {
      'User-Agent': configuredUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
    if (url.hostname === 'api.discogs.com' && discogsToken?.trim()) {
      headers.Authorization = `Discogs token=${discogsToken.trim()}`;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, { headers, cache: 'no-store', redirect: 'follow' }).catch(() => null);
      if (response?.ok) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const acceptable = contentType.startsWith('image/') || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream';
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (!acceptable || (declaredLength && declaredLength > MAX_ARTWORK_BYTES)) break;

        const bytes = await response.arrayBuffer().catch(() => null);
        if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_BYTES) break;

        const meta: CachedMetadata = {
          contentType: contentType || 'application/octet-stream',
          source: url.hostname,
          cachedAt: new Date().toISOString(),
        };
        await writeCachedArtwork(key, bytes, meta).catch(() => {});
        failedUntil.delete(key);
        return cachedResponse(bytes, meta, 'miss');
      }

      const status = response?.status || 0;
      if (status === 429 || status >= 500 || status === 0) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      break;
    }

    failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
    return null;
  });
}

async function withExternalSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeExternalFetches >= MAX_EXTERNAL_CONCURRENCY) {
    await new Promise<void>((resolve) => externalWaiters.push(resolve));
  }
  activeExternalFetches += 1;
  try {
    return await task();
  } finally {
    activeExternalFetches -= 1;
    externalWaiters.shift()?.();
  }
}

async function readCachedArtwork(key: string) {
  try {
    const [bytes, metaText] = await Promise.all([
      fs.promises.readFile(path.join(CACHE_DIR, `${key}.bin`)),
      fs.promises.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8'),
    ]);
    const meta = JSON.parse(metaText) as CachedMetadata;
    if (!bytes.length || !meta.contentType) return null;
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { bytes: body, meta };
  } catch {
    return null;
  }
}

async function writeCachedArtwork(key: string, bytes: ArrayBuffer, meta: CachedMetadata) {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  const suffix = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const binTemp = path.join(CACHE_DIR, `${key}.${suffix}.bin.tmp`);
  const metaTemp = path.join(CACHE_DIR, `${key}.${suffix}.json.tmp`);
  const binFinal = path.join(CACHE_DIR, `${key}.bin`);
  const metaFinal = path.join(CACHE_DIR, `${key}.json`);
  await fs.promises.writeFile(binTemp, Buffer.from(bytes));
  await fs.promises.writeFile(metaTemp, JSON.stringify(meta));
  await fs.promises.rename(binTemp, binFinal);
  await fs.promises.rename(metaTemp, metaFinal);
}

function cachedResponse(bytes: ArrayBuffer, meta: CachedMetadata, cacheState: string) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': meta.contentType,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=86400',
      'x-needledrop-artwork-source': meta.source,
      'x-needledrop-artwork-cache': cacheState,
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
