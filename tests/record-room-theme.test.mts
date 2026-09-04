import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRecordRoomTheme, RECORD_ROOM_THEME_IDS } from '../lib/record-room-theme.ts';

test('accepts every component-based Record Room theme', () => {
  assert.deepEqual(RECORD_ROOM_THEME_IDS, ['audiophile', 'teen-bedroom', 'record-store']);
  for (const theme of RECORD_ROOM_THEME_IDS) assert.equal(normalizeRecordRoomTheme(theme), theme);
});

test('falls back to the Audiophile room for unknown or legacy values', () => {
  assert.equal(normalizeRecordRoomTheme('retired-photo-room'), 'audiophile');
  assert.equal(normalizeRecordRoomTheme(null), 'audiophile');
});
