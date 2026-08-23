import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { recordDiagnostic, sanitizeUrlForDiagnostics } from './diagnostics';
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

export type ArtworkFetchContext = {
  requestId?: string;
  albumId?: string;
  route?: 'collection' | 'album' | 'metadata' | string;
  candidateSource?: string;
  candidateId?: string | number;
  candidateScope?: string;
};

function keyForUrl(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function fetchCachedExternalArtwork(
  value: string,
  configuredUserAgent?: string,
  discogsToken?: string,
  context: ArtworkFetchContext = {},
): Promise<Response | null> {
  const started = Date.now();
  let url: URL;
  try { url = new URL(value); } catch {
    recordDiagnostic('artwork-external-invalid-url', { ...context, value: String(value).slice(0, 200) }, 'warn');
    return null;
  }

  const allowed = ['discogs.com', 'coverartarchive.org', 'archive.org']
    .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !allowed) {
    recordDiagnostic('artwork-external-blocked-url', { ...context, url: sanitizeUrlForDiagnostics(value) }, 'warn');
    return null;
  }

  const key = keyForUrl(url.toString());
  const diagnosticUrl = sanitizeUrlForDiagnostics(url.toString());
  const cached = await readCachedArtwork(key);
  if (cached) {
    recordDiagnostic('artwork-cache-hit', {
      ...context,
      key: key.slice(0, 16),
      url: diagnosticUrl,
      bytes: cached.bytes.byteLength,
      contentType: cached.meta.contentType,
      cachedAt: cached.meta.cachedAt,
      durationMs: Date.now() - started,
    });
    return cachedResponse(cached.bytes, cached.meta, 'hit');
  }

  const blockedUntil = failedUntil.get(key) || 0;
  if (blockedUntil > Date.now()) {
    recordDiagnostic('artwork-cache-backoff', {
      ...context,
      key: key.slice(0, 16),
      url: diagnosticUrl,
      blockedForMs: blockedUntil - Date.now(),
      durationMs: Date.now() - started,
    }, 'warn');
    return null;
  }
  failedUntil.delete(key);

  recordDiagnostic('artwork-cache-miss', {
    ...context,
    key: key.slice(0, 16),
    url: diagnosticUrl,
    activeExternalFetches,
    queuedExternalFetches: externalWaiters.length,
  });

  return withExternalSlot(async () => {
    const secondLook = await readCachedArtwork(key);
    if (secondLook) {
      recordDiagnostic('artwork-cache-hit-after-wait', {
        ...context,
        key: key.slice(0, 16),
        url: diagnosticUrl,
        bytes: secondLook.bytes.byteLength,
        contentType: secondLook.meta.contentType,
        durationMs: Date.now() - started,
      });
      return cachedResponse(secondLook.bytes, secondLook.meta, 'hit-after-wait');
    }

    const headers: Record<string, string> = {
      'User-Agent': configuredUserAgent || `NeedleDrop/${APP_VERSION} (https://github.com/bclark303/needledrop)`,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
    if (url.hostname === 'api.discogs.com' && discogsToken?.trim()) {
      headers.Authorization = `Discogs token=${discogsToken.trim()}`;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attemptStarted = Date.now();
      recordDiagnostic('artwork-external-fetch-start', {
        ...context,
        key: key.slice(0, 16),
        url: diagnosticUrl,
        attempt: attempt + 1,
        activeExternalFetches,
        queuedExternalFetches: externalWaiters.length,
      });

      let networkError = '';
      const response = await fetch(url, { headers, cache: 'no-store', redirect: 'follow' }).catch((error) => {
        networkError = error instanceof Error ? error.message : String(error);
        return null;
      });
      const status = response?.status || 0;
      const contentType = (response?.headers.get('content-type') || '').toLowerCase();
      const declaredLength = Number(response?.headers.get('content-length') || 0);

      recordDiagnostic('artwork-external-fetch-result', {
        ...context,
        key: key.slice(0, 16),
        url: diagnosticUrl,
        attempt: attempt + 1,
        status,
        ok: Boolean(response?.ok),
        redirected: Boolean(response?.redirected),
        finalUrl: response?.url ? sanitizeUrlForDiagnostics(response.url) : undefined,
        contentType,
        declaredLength,
        networkError: networkError || undefined,
        durationMs: Date.now() - attemptStarted,
      }, response?.ok ? 'info' : 'warn');

      if (response?.ok) {
        const acceptable = contentType.startsWith('image/') || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream';
        if (!acceptable) {
          recordDiagnostic('artwork-external-rejected-content-type', { ...context, key: key.slice(0, 16), url: diagnosticUrl, contentType }, 'warn');
          break;
        }
        if (declaredLength && declaredLength > MAX_ARTWORK_BYTES) {
          recordDiagnostic('artwork-external-rejected-size', { ...context, key: key.slice(0, 16), url: diagnosticUrl, declaredLength, maxBytes: MAX_ARTWORK_BYTES }, 'warn');
          break;
        }

        const bytes = await response.arrayBuffer().catch((error) => {
          recordDiagnostic('artwork-external-read-failed', { ...context, key: key.slice(0, 16), url: diagnosticUrl, error: error instanceof Error ? error.message : String(error) }, 'warn');
          return null;
        });
        if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_BYTES) {
          recordDiagnostic('artwork-external-invalid-body', { ...context, key: key.slice(0, 16), url: diagnosticUrl, bytes: bytes?.byteLength || 0 }, 'warn');
          break;
        }

        const meta: CachedMetadata = {
          contentType: contentType || 'application/octet-stream',
          source: url.hostname,
          cachedAt: new Date().toISOString(),
        };
        try {
          await writeCachedArtwork(key, bytes, meta);
          recordDiagnostic('artwork-cache-write', {
            ...context,
            key: key.slice(0, 16),
            url: diagnosticUrl,
            bytes: bytes.byteLength,
            contentType: meta.contentType,
            cacheDir: CACHE_DIR,
            durationMs: Date.now() - started,
          });
        } catch (error) {
          recordDiagnostic('artwork-cache-write-failed', {
            ...context,
            key: key.slice(0, 16),
            url: diagnosticUrl,
            bytes: bytes.byteLength,
            cacheDir: CACHE_DIR,
            error: error instanceof Error ? error.message : String(error),
          }, 'error');
        }
        failedUntil.delete(key);
        return cachedResponse(bytes, meta, 'miss');
      }

      if (status === 429 || status >= 500 || status === 0) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      break;
    }

    failedUntil.set(key, Date.now() + FAILURE_BACKOFF_MS);
    recordDiagnostic('artwork-external-fetch-failed', {
      ...context,
      key: key.slice(0, 16),
      url: diagnosticUrl,
      backoffMs: FAILURE_BACKOFF_MS,
      durationMs: Date.now() - started,
    }, 'warn');
    return null;
  });
}

async function withExternalSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeExternalFetches >= MAX_EXTERNAL_CONCURRENCY) {
    const queuedAt = Date.now();
    await new Promise<void>((resolve) => externalWaiters.push(resolve));
    recordDiagnostic('artwork-external-slot-acquired', { waitedMs: Date.now() - queuedAt, activeExternalFetches, queuedExternalFetches: externalWaiters.length });
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

export async function getArtworkCacheEntryStatus(value: string) {
  const key = keyForUrl(value);
  const binPath = path.join(CACHE_DIR, `${key}.bin`);
  const metaPath = path.join(CACHE_DIR, `${key}.json`);
  let bytes = 0;
  let meta: CachedMetadata | null = null;
  try { bytes = (await fs.promises.stat(binPath)).size; } catch {}
  try { meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8')) as CachedMetadata; } catch {}
  return {
    key: key.slice(0, 16),
    cached: bytes > 0 && Boolean(meta),
    bytes,
    contentType: meta?.contentType,
    source: meta?.source,
    cachedAt: meta?.cachedAt,
    backoffUntil: failedUntil.get(key) ? new Date(failedUntil.get(key)!).toISOString() : undefined,
  };
}

export async function getArtworkCacheStats() {
  let files: string[] = [];
  try { files = await fs.promises.readdir(CACHE_DIR); } catch {}
  const bins = files.filter((file) => file.endsWith('.bin'));
  const metas = files.filter((file) => file.endsWith('.json'));
  let bytes = 0;
  const sources: Record<string, number> = {};
  let oldestCachedAt: string | undefined;
  let newestCachedAt: string | undefined;

  for (const file of bins) {
    try { bytes += (await fs.promises.stat(path.join(CACHE_DIR, file))).size; } catch {}
  }
  for (const file of metas) {
    try {
      const meta = JSON.parse(await fs.promises.readFile(path.join(CACHE_DIR, file), 'utf8')) as CachedMetadata;
      sources[meta.source || 'unknown'] = (sources[meta.source || 'unknown'] || 0) + 1;
      if (meta.cachedAt && (!oldestCachedAt || meta.cachedAt < oldestCachedAt)) oldestCachedAt = meta.cachedAt;
      if (meta.cachedAt && (!newestCachedAt || meta.cachedAt > newestCachedAt)) newestCachedAt = meta.cachedAt;
    } catch {}
  }

  const binKeys = new Set(bins.map((file) => file.slice(0, -4)));
  const metaKeys = new Set(metas.map((file) => file.slice(0, -5)));
  const orphanBins = [...binKeys].filter((key) => !metaKeys.has(key)).length;
  const orphanMetadata = [...metaKeys].filter((key) => !binKeys.has(key)).length;

  return {
    cacheDir: CACHE_DIR,
    entries: [...binKeys].filter((key) => metaKeys.has(key)).length,
    binFiles: bins.length,
    metadataFiles: metas.length,
    bytes,
    sources,
    orphanBins,
    orphanMetadata,
    oldestCachedAt,
    newestCachedAt,
    activeExternalFetches,
    queuedExternalFetches: externalWaiters.length,
    backoffEntries: failedUntil.size,
    maxExternalConcurrency: MAX_EXTERNAL_CONCURRENCY,
    maxArtworkBytes: MAX_ARTWORK_BYTES,
  };
}

export function getArtworkFetchRuntimeState() {
  return {
    activeExternalFetches,
    queuedExternalFetches: externalWaiters.length,
    backoffEntries: failedUntil.size,
    maxExternalConcurrency: MAX_EXTERNAL_CONCURRENCY,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
