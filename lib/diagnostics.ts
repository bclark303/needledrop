import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const DIAGNOSTICS_DIR = path.join(DATA_DIR, 'diagnostics');
const STATE_FILE = path.join(DIAGNOSTICS_DIR, 'state.json');
const EVENTS_FILE = path.join(DIAGNOSTICS_DIR, 'events.jsonl');
const MAX_EVENT_BYTES = 50 * 1024 * 1024;
const MAX_EXPORT_EVENTS = 50000;
const CAPTURE_VERSION = 2;

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticState = {
  active: boolean;
  sessionId?: string;
  startedAt?: string;
  stoppedAt?: string;
  eventCount: number;
  droppedEvents?: number;
  lastEventAt?: string;
  truncated?: boolean;
  truncationReason?: string;
  captureVersion?: number;
};

export type DiagnosticEvent = {
  at: string;
  sessionId?: string;
  seq: number;
  level: DiagnosticLevel;
  type: string;
  pid: number;
  uptimeMs: number;
  data: unknown;
};

let stateCache: DiagnosticState | null = null;

function defaultState(): DiagnosticState {
  return { active: false, eventCount: 0, droppedEvents: 0, captureVersion: CAPTURE_VERSION };
}

function ensureDir() {
  fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
}

function loadState(): DiagnosticState {
  if (stateCache) return stateCache;
  try {
    stateCache = { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as DiagnosticState };
  } catch {
    stateCache = defaultState();
  }
  return stateCache;
}

function saveState(state: DiagnosticState) {
  ensureDir();
  const temp = `${STATE_FILE}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, STATE_FILE);
  stateCache = state;
}

export function diagnosticsActive() {
  return loadState().active;
}

export function getDiagnosticsStatus() {
  const state = { ...loadState() };
  let logBytes = 0;
  try { logBytes = fs.statSync(EVENTS_FILE).size; } catch {}
  return {
    ...state,
    logBytes,
    maxLogBytes: MAX_EVENT_BYTES,
    diagnosticsDir: DIAGNOSTICS_DIR,
    eventsFile: EVENTS_FILE,
  };
}

export function startDiagnosticsCapture(clearExisting = true) {
  ensureDir();
  if (clearExisting) {
    try { fs.rmSync(EVENTS_FILE, { force: true }); } catch {}
  }
  const state: DiagnosticState = {
    active: true,
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    eventCount: 0,
    droppedEvents: 0,
    truncated: false,
    captureVersion: CAPTURE_VERSION,
  };
  saveState(state);
  recordDiagnostic('diagnostics-capture-started', {
    captureVersion: CAPTURE_VERSION,
    version: process.env.npm_package_version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    resourceUsage: process.resourceUsage(),
  });
  return getDiagnosticsStatus();
}

export function stopDiagnosticsCapture() {
  const current = loadState();
  if (current.active) recordDiagnostic('diagnostics-capture-stopping', {
    memory: process.memoryUsage(),
    resourceUsage: process.resourceUsage(),
  });
  const state = { ...loadState(), active: false, stoppedAt: new Date().toISOString() };
  saveState(state);
  return getDiagnosticsStatus();
}

export function clearDiagnosticsCapture() {
  ensureDir();
  try { fs.rmSync(EVENTS_FILE, { force: true }); } catch {}
  const state = defaultState();
  saveState(state);
  return getDiagnosticsStatus();
}

export function recordDiagnostic(type: string, data: unknown = {}, level: DiagnosticLevel = 'info') {
  const state = loadState();
  if (!state.active) return false;

  ensureDir();
  let currentBytes = 0;
  try { currentBytes = fs.statSync(EVENTS_FILE).size; } catch {}
  if (currentBytes >= MAX_EVENT_BYTES) {
    saveState({
      ...state,
      active: false,
      truncated: true,
      truncationReason: `Reached ${MAX_EVENT_BYTES} byte diagnostics safety limit`,
      stoppedAt: new Date().toISOString(),
    });
    return false;
  }

  const event: DiagnosticEvent = {
    at: new Date().toISOString(),
    sessionId: state.sessionId,
    seq: state.eventCount + 1,
    level,
    type: String(type || 'unknown').replace(/[^a-z0-9-_.]/gi, '-').slice(0, 120),
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    data: sanitizeDiagnosticValue(data),
  };

  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`, 'utf8');
    saveState({
      ...state,
      eventCount: state.eventCount + 1,
      lastEventAt: event.at,
    });
    return true;
  } catch {
    try {
      saveState({ ...state, droppedEvents: (state.droppedEvents || 0) + 1 });
    } catch {}
    return false;
  }
}

export function serializeDiagnosticError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const value = error as Error & { code?: unknown; cause?: unknown; status?: unknown };
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
      status: value.status,
      cause: value.cause && value.cause !== error ? serializeDiagnosticError(value.cause) : undefined,
    };
  }
  if (error && typeof error === 'object') return { value: sanitizeDiagnosticValue(error) };
  return { message: String(error) };
}

export function recordDiagnosticError(
  type: string,
  error: unknown,
  data: Record<string, unknown> = {},
  level: DiagnosticLevel = 'error',
) {
  return recordDiagnostic(type, { ...data, error: serializeDiagnosticError(error) }, level);
}

export function readDiagnosticEvents(limit = MAX_EXPORT_EVENTS): DiagnosticEvent[] {
  let text = '';
  try { text = fs.readFileSync(EVENTS_FILE, 'utf8'); } catch { return []; }
  const lines = text.split('\n').filter(Boolean);
  const selected = lines.length > limit ? lines.slice(lines.length - limit) : lines;
  const events: DiagnosticEvent[] = [];
  for (const line of selected) {
    try {
      const parsed = JSON.parse(line) as Partial<DiagnosticEvent>;
      events.push({
        at: parsed.at || new Date(0).toISOString(),
        sessionId: parsed.sessionId,
        seq: Number(parsed.seq || events.length + 1),
        level: parsed.level || 'info',
        type: parsed.type || 'unknown',
        pid: Number(parsed.pid || 0),
        uptimeMs: Number(parsed.uptimeMs || 0),
        data: parsed.data,
      });
    } catch {}
  }
  return events;
}

type Aggregate = {
  count: number;
  failures: number;
  totalDurationMs: number;
  maxDurationMs: number;
  statuses: Record<string, number>;
};

function addAggregate(target: Record<string, Aggregate>, key: string, durationMs: number, failed: boolean, status?: unknown) {
  const item = target[key] || { count: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0, statuses: {} };
  item.count += 1;
  if (failed) item.failures += 1;
  if (Number.isFinite(durationMs)) {
    item.totalDurationMs += Math.max(0, durationMs);
    item.maxDurationMs = Math.max(item.maxDurationMs, Math.max(0, durationMs));
  }
  if (status != null) {
    const value = String(status);
    item.statuses[value] = (item.statuses[value] || 0) + 1;
  }
  target[key] = item;
}

function finalizeAggregates(values: Record<string, Aggregate>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
    count: value.count,
    failures: value.failures,
    averageDurationMs: value.count ? Math.round((value.totalDurationMs / value.count) * 100) / 100 : 0,
    maxDurationMs: Math.round(value.maxDurationMs * 100) / 100,
    statuses: value.statuses,
  }]));
}

export function summarizeDiagnosticEvents(events = readDiagnosticEvents()) {
  const byType: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  const artworkServed: Record<string, number> = {};
  const cacheStates: Record<string, number> = {};
  const clientRoutes: Record<string, Aggregate> = {};
  const providers: Record<string, Aggregate> = {};
  const placeholderAlbums = new Set<string>();
  const failedAlbums = new Set<string>();
  let clientImageLoads = 0;
  let clientImageErrors = 0;
  let clientApiRequests = 0;
  let clientApiFailures = 0;
  let browserErrors = 0;
  let providerRequests = 0;
  let providerFailures = 0;
  let mediaEvents = 0;
  let mediaErrors = 0;
  let longTasks = 0;

  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    byLevel[event.level] = (byLevel[event.level] || 0) + 1;
    const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};

    if (event.type === 'artwork-request-served') {
      const source = String(data.source || 'unknown');
      const cache = String(data.cache || 'unknown');
      artworkServed[source] = (artworkServed[source] || 0) + 1;
      cacheStates[cache] = (cacheStates[cache] || 0) + 1;
    }
    if (event.type === 'artwork-request-placeholder' && data.albumId) placeholderAlbums.add(String(data.albumId));
    if ((event.level === 'warn' || event.level === 'error') && data.albumId) failedAlbums.add(String(data.albumId));
    if (event.type === 'client-image-load') clientImageLoads += 1;
    if (event.type === 'client-image-error') clientImageErrors += 1;

    if (event.type === 'client-api-request' || event.type === 'client-api-error') {
      clientApiRequests += 1;
      const status = Number(data.status || 0);
      const failed = event.type === 'client-api-error' || status >= 400 || status === 0;
      if (failed) clientApiFailures += 1;
      addAggregate(
        clientRoutes,
        `${String(data.method || 'GET').toUpperCase()} ${String(data.pathname || 'unknown')}`,
        Number(data.durationMs || 0),
        failed,
        status || undefined,
      );
    }

    if (event.type === 'provider-request-complete' || event.type === 'provider-request-error') {
      providerRequests += 1;
      const status = Number(data.status || 0);
      const failed = event.type === 'provider-request-error' || status >= 400 || status === 0;
      if (failed) providerFailures += 1;
      addAggregate(
        providers,
        String(data.provider || 'unknown'),
        Number(data.durationMs || 0),
        failed,
        status || undefined,
      );
    }

    if (event.type === 'client-browser-error' || event.type === 'client-unhandled-rejection') browserErrors += 1;
    if (event.type === 'client-media-event') {
      mediaEvents += 1;
      if (String(data.event || '') === 'error' || Number(data.errorCode || 0) > 0) mediaErrors += 1;
    }
    if (event.type === 'client-long-task') longTasks += 1;
  }

  return {
    totalEvents: events.length,
    byType,
    byLevel,
    warnings: byLevel.warn || 0,
    errors: byLevel.error || 0,
    artworkServed,
    cacheStates,
    placeholderAlbums: [...placeholderAlbums],
    failedAlbums: [...failedAlbums],
    clientImageLoads,
    clientImageErrors,
    clientApiRequests,
    clientApiFailures,
    clientRoutes: finalizeAggregates(clientRoutes),
    browserErrors,
    providerRequests,
    providerFailures,
    providers: finalizeAggregates(providers),
    mediaEvents,
    mediaErrors,
    longTasks,
  };
}

export function sanitizeUrlForDiagnostics(value: string) {
  try {
    const url = new URL(value);
    const fullHash = crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 16);
    const queryKeys = [...url.searchParams.keys()].filter((key, index, all) => all.indexOf(key) === index).sort();
    return {
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
      queryKeys,
      hash: fullHash,
    };
  } catch {
    return redactDiagnosticString(value.length > 1000 ? `${value.slice(0, 1000)}…` : value);
  }
}

function redactDiagnosticString(value: string) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret|password|authorization|auth)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(authorization|cookie|set-cookie|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

export function sanitizeDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 10) return '[max-depth]';
  if (/token|secret|password|authorization|cookie|api[_-]?key|credential/i.test(key)) return '[redacted]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    const redacted = redactDiagnosticString(value);
    if (/^https?:\/\//i.test(redacted) && key !== 'origin') return sanitizeUrlForDiagnostics(redacted);
    return redacted.length > 8000 ? `${redacted.slice(0, 8000)}…` : redacted;
  }
  if (value instanceof Error) return sanitizeDiagnosticValue(serializeDiagnosticError(value), key, depth + 1);
  if (Array.isArray(value)) return value.slice(0, 2000).map((item) => sanitizeDiagnosticValue(item, key, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 2000)) {
      output[childKey] = sanitizeDiagnosticValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return redactDiagnosticString(String(value));
}

export function diagnosticsPaths() {
  return { dataDir: DATA_DIR, diagnosticsDir: DIAGNOSTICS_DIR, eventsFile: EVENTS_FILE, stateFile: STATE_FILE };
}
