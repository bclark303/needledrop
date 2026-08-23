import type {
  CollectionGroupMode,
  CollectionSort,
  CollectionViewMode,
  RecordRoomConfig,
  RecordRoomShelf,
  RecordRoomShelfPresentation,
  RecordRoomSmartRule,
  RecordRoomTheme,
} from '@/components/types';
import { getSystemJson, setSystemJson } from './db';

const THEMES = new Set<RecordRoomTheme>(['audiophile', 'teen-bedroom', 'record-store']);
const SORTS = new Set<CollectionSort>(['artist', 'album', 'yearAsc', 'yearDesc', 'rating', 'newest', 'recent', 'frequent', 'starred']);
const VIEWS = new Set<CollectionViewMode>(['grid', 'shelf', 'flip']);
const GROUPS = new Set<CollectionGroupMode>(['none', 'artist', 'decade', 'year']);
const PRESENTATIONS = new Set<RecordRoomShelfPresentation>(['shelf', 'crate']);

export const DEFAULT_RECORD_ROOM: RecordRoomConfig = {
  theme: 'audiophile',
  sort: 'artist',
  viewMode: 'grid',
  groupMode: 'none',
  featuredAlbumIds: [],
  shelves: [
    { id: 'smart-favourites', name: 'Favourites', kind: 'smart', presentation: 'shelf', rule: { type: 'starred' } },
    { id: 'smart-five-star', name: 'Five-star records', kind: 'smart', presentation: 'shelf', rule: { type: 'rating', minimum: 5 } },
    { id: 'smart-new-arrivals', name: 'New arrivals', kind: 'smart', presentation: 'crate', rule: { type: 'recent', days: 60 } },
  ],
};

function roomKey(username: string) {
  return `record_room_v1:${username.trim().toLocaleLowerCase()}`;
}

export function getRecordRoom(username: string): RecordRoomConfig {
  const stored = getSystemJson<unknown>(roomKey(username));
  return normalizeRecordRoom(stored);
}

export function saveRecordRoom(username: string, value: unknown) {
  const room = normalizeRecordRoom(value);
  setSystemJson(roomKey(username), room);
  return room;
}

export function normalizeRecordRoom(value: unknown): RecordRoomConfig {
  const input = asObject(value);
  const shelves = Array.isArray(input.shelves)
    ? input.shelves.slice(0, 30).map(normalizeShelf).filter((shelf): shelf is RecordRoomShelf => Boolean(shelf))
    : DEFAULT_RECORD_ROOM.shelves.map((shelf) => ({ ...shelf }));
  const ids = new Set(shelves.map((shelf) => shelf.id));
  const activeShelfId = typeof input.activeShelfId === 'string' && ids.has(input.activeShelfId) ? input.activeShelfId : undefined;

  return {
    theme: THEMES.has(input.theme as RecordRoomTheme) ? input.theme as RecordRoomTheme : DEFAULT_RECORD_ROOM.theme,
    sort: SORTS.has(input.sort as CollectionSort) ? input.sort as CollectionSort : DEFAULT_RECORD_ROOM.sort,
    viewMode: VIEWS.has(input.viewMode as CollectionViewMode) ? input.viewMode as CollectionViewMode : DEFAULT_RECORD_ROOM.viewMode,
    groupMode: GROUPS.has(input.groupMode as CollectionGroupMode) ? input.groupMode as CollectionGroupMode : DEFAULT_RECORD_ROOM.groupMode,
    activeShelfId,
    featuredAlbumIds: uniqueStrings(input.featuredAlbumIds, 12),
    shelves,
  };
}

function normalizeShelf(value: unknown): RecordRoomShelf | null {
  const input = asObject(value);
  const id = safeText(input.id, 80);
  const name = safeText(input.name, 80);
  if (!id || !name) return null;
  const kind = input.kind === 'smart' ? 'smart' : 'manual';
  const presentation = PRESENTATIONS.has(input.presentation as RecordRoomShelfPresentation)
    ? input.presentation as RecordRoomShelfPresentation
    : 'shelf';

  if (kind === 'manual') {
    return { id, name, kind, presentation, albumIds: uniqueStrings(input.albumIds, 1000) };
  }
  const rule = normalizeRule(input.rule);
  if (!rule) return null;
  return { id, name, kind, presentation, rule };
}

function normalizeRule(value: unknown): RecordRoomSmartRule | null {
  const input = asObject(value);
  if (input.type === 'starred') return { type: 'starred' };
  if (input.type === 'rating') {
    const minimum = clampNumber(input.minimum, 1, 5, 4);
    return { type: 'rating', minimum };
  }
  if (input.type === 'decade') {
    const decade = Math.floor(clampNumber(input.decade, 1900, 2100, 1970) / 10) * 10;
    return { type: 'decade', decade };
  }
  if (input.type === 'genre') {
    const genre = safeText(input.value, 80);
    return genre ? { type: 'genre', value: genre } : null;
  }
  if (input.type === 'recent') {
    return { type: 'recent', days: clampNumber(input.days, 1, 3650, 60) };
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function uniqueStrings(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, max);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
