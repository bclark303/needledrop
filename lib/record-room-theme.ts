export const RECORD_ROOM_THEME_IDS = ['audiophile', 'teen-bedroom', 'record-store'] as const;

export type RecordRoomThemeId = typeof RECORD_ROOM_THEME_IDS[number];

export function normalizeRecordRoomTheme(value: unknown): RecordRoomThemeId {
  return typeof value === 'string' && RECORD_ROOM_THEME_IDS.includes(value as RecordRoomThemeId)
    ? value as RecordRoomThemeId
    : 'audiophile';
}
