#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const databasePath = path.resolve(
  process.argv[2]
    || path.join(process.env.NEEDLEDROP_DATA_DIR || '/data', 'needledrop.db'),
);

if (!fs.existsSync(databasePath)) {
  console.error(`NeedleDrop database not found: ${databasePath}`);
  process.exitCode = 2;
} else {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const report = buildReport(database, databasePath);
    console.log(JSON.stringify(report, null, 2));
    if (report.database.integrity !== 'ok') process.exitCode = 1;
  } finally {
    database.close();
  }
}

function buildReport(database, resolvedPath) {
  const tables = new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)),
  );
  const requiredTables = ['albums', 'artwork', 'album_meta', 'album_merges', 'system_kv'];
  const missingTables = requiredTables.filter((table) => !tables.has(table));
  if (missingTables.length) {
    throw new Error(`Database is missing required table(s): ${missingTables.join(', ')}`);
  }

  const integrityRows = database.prepare('PRAGMA integrity_check(20)').all();
  const integrity = integrityRows.map((row) => String(Object.values(row)[0] || '')).join('; ');
  const albums = database.prepare(`
    SELECT album_id, artist, title, artwork_mode, canonical_artwork_id, navidrome_cover_art, updated_at
    FROM albums
    ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE, album_id
  `).all();
  const latestScan = readSystemJson(database, 'library_scan_status');
  const indexSnapshot = readSystemJson(database, 'library_index_snapshot');
  const hasIndexSnapshot = Array.isArray(indexSnapshot?.albumIds);
  const snapshotIds = hasIndexSnapshot ? new Set(indexSnapshot.albumIds.map(String)) : null;
  const activeSince = latestScan?.state === 'complete' ? Date.parse(String(latestScan.startedAt || '')) : Number.NaN;
  const currentAlbums = snapshotIds
    ? albums.filter((album) => snapshotIds.has(String(album.album_id)))
    : Number.isFinite(activeSince)
      ? albums.filter((album) => Date.parse(String(album.updated_at || '')) >= activeSince)
      : albums;
  const currentIds = new Set(currentAlbums.map((album) => String(album.album_id)));
  const merges = database.prepare('SELECT alias_id, canonical_id, created_at FROM album_merges').all();
  const currentMerges = merges.filter((merge) => currentIds.has(String(merge.alias_id)) || currentIds.has(String(merge.canonical_id)));
  const hidden = new Set(merges.map((row) => String(row.alias_id)));
  const visibleAlbums = currentAlbums.filter((album) => !hidden.has(String(album.album_id)));
  const albumById = new Map(albums.map((album) => [String(album.album_id), album]));
  const albumMeta = database.prepare('SELECT album_id, payload FROM album_meta ORDER BY album_id').all();
  const artwork = database.prepare(`
    SELECT id, album_id, source, scope, role, remote_url, user_selected
    FROM artwork
    ORDER BY album_id, user_selected DESC, id
  `).all();
  const artworkById = new Map(artwork.map((candidate) => [Number(candidate.id), candidate]));
  const selectedPressingArtwork = albumMeta
    .map((row) => selectedPressingArtworkState(row, albumById, artworkById))
    .filter((selection) => selection && currentIds.has(selection.albumId));
  const duplicateGroups = findDuplicateGroups(visibleAlbums);
  const sgtPepperAlbums = currentAlbums.filter((album) => {
    const title = normalizeIdentity(String(album.title || ''));
    return title.includes('sgt pepper') && title.includes('lonely hearts');
  });
  const unresolvedPinnedArtwork = currentAlbums
    .filter((album) => album.artwork_mode === 'candidate')
    .filter((album) => {
      const candidate = artworkById.get(Number(album.canonical_artwork_id));
      return !candidate?.remote_url;
    })
    .map(albumSummary);
  const pinnedPressingArtwork = currentAlbums
    .filter((album) => album.artwork_mode === 'candidate')
    .map((album) => {
      const candidate = artworkById.get(Number(album.canonical_artwork_id));
      return {
        ...albumSummary(album),
        candidateId: candidate ? Number(candidate.id) : null,
        source: candidate?.source || null,
        scope: candidate?.scope || null,
        remoteUrlConfigured: Boolean(candidate?.remote_url),
        userSelected: Number(candidate?.user_selected) === 1,
      };
    });
  const noKnownArtwork = visibleAlbums
    .filter((album) => {
      const candidates = artwork.filter((candidate) => (
        String(candidate.album_id) === String(album.album_id)
        && candidate.role === 'front'
        && Boolean(candidate.remote_url)
      ));
      return !album.navidrome_cover_art && candidates.length === 0;
    })
    .map(albumSummary);

  return {
    generatedAt: new Date().toISOString(),
    database: {
      path: resolvedPath,
      integrity,
      indexedAlbums: currentAlbums.length,
      visibleAlbums: visibleAlbums.length,
      mergedAliases: currentMerges.length,
      historicalIndexedRows: albums.length,
      historicalMergeRows: merges.length,
      currentIndexSource: snapshotIds ? 'library_index_snapshot' : Number.isFinite(activeSince) ? 'latest_scan_timestamp' : 'all_rows',
      navidromeMusicFolderId: hasIndexSnapshot ? String(indexSnapshot.musicFolderId || '') || null : null,
    },
    collection: {
      latestScan,
      metadataOnlyAlbums: albumMeta
        .filter((row) => !albumById.has(String(row.album_id)))
        .map((row) => String(row.album_id)),
      unresolvedDuplicateGroups: duplicateGroups.length,
      duplicates: duplicateGroups,
      sgtPepper: {
        indexedCopies: sgtPepperAlbums.map((album) => ({
          ...albumSummary(album),
          hiddenByMerge: hidden.has(String(album.album_id)),
          canonicalId: merges.find((merge) => String(merge.alias_id) === String(album.album_id))?.canonical_id || null,
        })),
        resolved: sgtPepperAlbums.length > 0
          && sgtPepperAlbums.filter((album) => !hidden.has(String(album.album_id))).length <= 1,
      },
    },
    artwork: {
      pinnedPressingArtwork,
      unresolvedPinnedArtwork,
      selectedPressingArtwork,
      selectedPressingArtworkMismatches: selectedPressingArtwork.filter((selection) => !selection.validCanonicalSelection),
      albumsWithNoKnownArtwork: noKnownArtwork,
    },
    limits: [
      'Database state can prove indexed rows, merges, and canonical artwork selections.',
      'Current albums come from the last full-library snapshot, or from rows refreshed since the latest completed scan for databases created before snapshots were added.',
      'Completeness against the earlier missing-album list requires that list or a current Navidrome comparison.',
      'A configured remote artwork URL still requires an HTTP/UI check to prove that the image currently renders.',
    ],
  };
}

function findDuplicateGroups(albums) {
  const groups = new Map();
  for (const album of albums) {
    const key = `${normalizeIdentity(String(album.artist || ''))}\u0000${normalizeIdentity(String(album.title || ''))}`;
    const group = groups.get(key) || [];
    group.push(album);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      artist: String(group[0].artist || ''),
      title: String(group[0].title || ''),
      albumIds: group.map((album) => String(album.album_id)),
    }));
}

function normalizeIdentity(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function albumSummary(album) {
  return {
    albumId: String(album.album_id),
    artist: String(album.artist || ''),
    title: String(album.title || ''),
  };
}

function selectedPressingArtworkState(row, albumById, artworkById) {
  let meta;
  try {
    meta = JSON.parse(String(row.payload || ''));
  } catch {
    return null;
  }
  if (meta?.artworkSource !== 'discogs' || !Number.isInteger(meta.discogsImageIndex)) return null;
  const albumId = String(row.album_id);
  const album = albumById.get(albumId);
  const candidate = album ? artworkById.get(Number(album.canonical_artwork_id)) : null;
  const selectedImage = Array.isArray(meta.images) ? meta.images[meta.discogsImageIndex] : null;
  const expectedRemoteUrl = selectedImage?.uri || selectedImage?.uri150 || null;
  return {
    albumId,
    artist: album ? String(album.artist || '') : '',
    title: album ? String(album.title || '') : '',
    discogsImageIndex: meta.discogsImageIndex,
    expectedRemoteUrlConfigured: Boolean(expectedRemoteUrl),
    candidateId: candidate ? Number(candidate.id) : null,
    candidateRemoteUrlConfigured: Boolean(candidate?.remote_url),
    validCanonicalSelection: Boolean(
      album
      && album.artwork_mode === 'candidate'
      && candidate?.remote_url
      && expectedRemoteUrl
      && String(candidate.remote_url) === String(expectedRemoteUrl)
    ),
  };
}

function readSystemJson(database, key) {
  const row = database.prepare('SELECT value FROM system_kv WHERE key=?').get(key);
  if (!row?.value) return null;
  try {
    return JSON.parse(String(row.value));
  } catch {
    return { invalidJson: true };
  }
}
