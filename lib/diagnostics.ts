import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.NEEDLEDROP_DATA_DIR || path.join(process.cwd(), 'data');
const DIAGNOSTICS_DIR = path.join(DATA_DIR, 'diagnostics');
const STATE_FILE = path.join(DIAGNOSTICS_DIR, 'state.json');
const EVENTS_FILE = path.join(DIAGNOSTICS_DIR, 'events.jsonl');
const MAX_EVENT_BYTES = 25 * 1024 * 1024;
const MAX_EXPORT_EVENTS = 25000;

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticState = {
  active: boolean;
  sessionId?: string;
  startedAt?: string;
  stoppedAt?: string;
  eventCount: number;
  lastEventAt?: string;
  truncated?: boolean;
};

export type DiagnosticEvent = {
  at: string;
  sessionId?: string;
  level: DiagnosticLevel;
  type: string;
  pid: number;
  data: unknown;
};

let stateCache: DiagnosticState | null = null;

function defaultState(): DiagnosticState {
  return { active: false, eventCount: 0 };
}

function ensureDir() {
  fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
}

function loadState(): DiagnosticState {
  if (stateCache) return stateCache;
  try {
    stateCache = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as DiagnosticState;
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
    truncated: false,
  };
  saveState(state);
  recordDiagnostic('diagnostics-capture-started', {
    version: process.env.npm_package_version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
  });
  return getDiagnosticsStatus();
}

export function stopDiagnosticsCapture() {
  const current = loadState();
  if (current.active) recordDiagnostic('diagnostics-capture-stopping', {});
  const state = { ...current, active: false, stoppedAt: new Date().toISOString() };
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
    saveState({ ...state, active: false, truncated: true, stoppedAt: new Date().toISOString() });
    return false;
  }

  const event: DiagnosticEvent = {
    at: new Date().toISOString(),
    sessionId: state.sessionId,
    level,
    type: String(type || 'unknown').slice(0, 120),
    pid: process.pid,
    data: sanitizeDiagnosticValue(data),
  };

  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`, 'utf8');
    const next = {
      ...state,
      eventCount: state.eventCount + 1,
      lastEventAt: event.at,
    };
    saveState(next);
    return true;
  } catch {
    return false;
  }
}

export function readDiagnosticEvents(limit = MAX_EXPORT_EVENTS): DiagnosticEvent[] {
  let text = '';
  try { text = fs.readFileSync(EVENTS_FILE, 'utf8'); } catch { return []; }
  const lines = text.split('\n').filter(Boolean);
  const selected = lines.length > limit ? lines.slice(lines.length - limit) : lines;
  const events: DiagnosticEvent[] = [];
  for (const line of selected) {
    try { events.push(JSON.parse(line) as DiagnosticEvent); } catch {}
  }
  return events;
}

export function summarizeDiagnosticEvents(events = readDiagnosticEvents()) {
  const byType: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  const artworkServed: Record<string, number> = {};
  const cacheStates: Record<string, number> = {};
  const placeholderAlbums = new Set<string>();
  const failedAlbums = new Set<string>();
  let clientImageLoads = 0;
  let clientImageErrors = 0;

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
  }

  return {
    totalEvents: events.length,
    byType,
    byLevel,
    artworkServed,
    cacheStates,
    placeholderAlbums: [...placeholderAlbums],
    failedAlbums: [...failedAlbums],
    clientImageLoads,
    clientImageErrors,
  };
}

export function sanitizeUrlForDiagnostics(value: string) {
  try {
    const url = new URL(value);
    const fullHash = crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 16);
    const queryKeys = [...url.searchParams.keys()].filter((key, index, all) => all.indexOf(key) === index).sort();
    return {
      origin: `${url.protocol}//${url.host}`,
      pathname: url.pathname,
      queryKeys,
      hash: fullHash,
    };
  } catch {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
}

export function sanitizeDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(key)) return '[redacted]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return sanitizeUrlForDiagnostics(value);
    return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeDiagnosticValue(item, key, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 1000)) {
      output[childKey] = sanitizeDiagnosticValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function diagnosticsPaths() {
  return { dataDir: DATA_DIR, diagnosticsDir: DIAGNOSTICS_DIR, eventsFile: EVENTS_FILE };
}
