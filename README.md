# NeedleDrop

NeedleDrop is a self-hosted virtual-vinyl front end for Navidrome. It turns a digital music library into something closer to using a physical record collection: browse jackets or a record shelf, select an exact pressing, put a record on an animated turntable, lower the needle, flip sides, and queue albums on an automatic changer spindle.

Current version: **v0.7.2**

## v0.7.2 — NZB Track Repair

NZB Track Repair is the preferred way to fill individual gaps in an otherwise playable virtual record. It is optional and intended only for material you are authorized to retrieve.

- Supports a direct **Newznab-compatible indexer**, **NZBHydra2**, or **Prowlarr** as the search layer.
- Uses **SABnzbd** as the downloader/unpacker.
- **Repair missing tracks** first searches and downloads only NZB manifests. No music payload is queued until you choose a candidate.
- Candidate ranking considers artist/album identity, lossless preference, visible audio filenames, and how many missing tracks can be recognized directly in the NZB manifest.
- If an NZB contains RARs or obfuscated names, NeedleDrop can still let SAB download/unpack it and then inspect the extracted audio.
- Extracted audio is identified using filenames plus embedded title, artist, album, track-number and duration metadata.
- Only confidently matched requested tracks are copied into the dedicated repair-import folder; the rest of the temporary album is discarded when safe cleanup is enabled.
- SAB jobs get a unique NeedleDrop repair token. Automatic cleanup only removes a completed staging directory when it is inside the configured repair root and its folder name contains that token.
- After a successful repair, NeedleDrop triggers a Navidrome/library rescan and remaps the selected physical release.
- Lidarr remains available as an optional album-level fallback.

### Track Repair storage model

NeedleDrop deliberately uses two narrow mounts instead of write access to the complete music library:

```text
SABnzbd needledrop-repair completed folder
        |
        +---- mounted in NeedleDrop as /repair
                    |
                    | identify/copy wanted track(s)
                    v
Dedicated Navidrome-scanned repair music folder
        ^
        +---- mounted in NeedleDrop as /music-repair
```

For Unraid, create a SAB category named `needledrop-repair`, give that category its own completed folder, and add that same host folder to NeedleDrop at container path `/repair`. Then create a dedicated folder inside a music tree already scanned by Navidrome and mount it into NeedleDrop at `/music-repair`.

Existing NeedleDrop containers installed before v0.7.2 need these two optional path mappings added manually in **Edit Container**; Force Update cannot add new mappings to an existing local Unraid template.

## v0.7.x — Collection Engine

- A selected Discogs/MusicBrainz physical release is authoritative even when local audio is incomplete.
- Physical A/B/C/D side layout and track order remain intact while missing tracks are shown explicitly.
- NeedleDrop searches the broader Navidrome library for each physical track, allowing another release/duplicate/compilation copy to satisfy the selected record.
- Persistent provider-track mappings prepare the collection model for future additional playback providers.
- Albums report **Fully playable**, **Partially playable**, or **Collection only**.
- Optional Lidarr integration can add/monitor an album and run an album search when tracks are missing.
- v0.7.1 adds formatting-tolerant matching so metadata differences such as `God Smack` vs `Godsmack` and `Sick Man` vs `Sickman` do not create false missing-track reports.

## v0.6.x — library management and record shelf

- **Manual library rescan** asks Navidrome to scan its music folders, then rebuilds NeedleDrop's complete album index and starts enrichment for new/unresolved records.
- **Duplicate management** detects conservative artist/title duplicate groups. Choose one Navidrome album ID to keep visible; other copies are hidden in NeedleDrop only. Merges are reversible and never delete or modify Navidrome data.
- **Artwork resolver v3** retains multiple candidates and actually tries them in sequence instead of assuming a stored URL is valid.
- Albums without embedded/Navidrome art keep Cover Art Archive and Discogs fallback candidates available at the same time, so a dead remote image can fall through to another source.
- Discogs image requests use the configured Discogs token where applicable.
- Generated "artwork not found" jackets are no longer cached, preventing an early placeholder from sticking after enrichment later succeeds.
- Each album's artwork panel includes **Resolve again** for an immediate one-record metadata/artwork retry.
- **My rating** adds a local 1–5 star rating that can be used to sort the collection.
- Collection organization includes artist/band, album title, oldest/newest chronology, rating, recently added, recently played, most played and favourites, plus optional grouping by artist/band, decade or year.
- **Record Shelf** view displays albums spine-on; hover/focus pulls a jacket out so the front cover becomes visible.
- A PNG NeedleDrop icon is included for Unraid, browser/PWA metadata and clients that do not render the SVG icon.

## v0.5.x — canonical metadata library

NeedleDrop maintains its own authoritative collection database at `/data/needledrop.db` using SQLite. Navidrome remains the source of playable audio and normal library membership, while NeedleDrop stores physical-release identity, artwork choices, external-source matches, provenance, local overrides and repair state used by the vinyl interface.

- Existing `/data/needledrop.json` and `/data/settings.json` data is migrated automatically on first use.
- Discogs remains the preferred exact physical-pressing source.
- MusicBrainz supplies canonical release/release-group identity matching.
- Cover Art Archive supplies exact-release and release-group artwork.
- Optional Last.fm integration supplies community tags, album summaries, listener/play-count context and matching identifiers.
- Artwork candidates and source provenance are retained in SQLite instead of being overwritten by later refreshes.
- Per-album artwork can be left on **Auto**, forced to raw Navidrome artwork, or pinned to a specific Discogs/Cover Art Archive candidate.
- Settings allow metadata and artwork source priority to be reordered.
- Automatic background enrichment can be enabled/disabled.
- **Enrich entire library** scans all Navidrome album pages, with live progress in Settings.

### Source authority

| Data | Primary role |
| --- | --- |
| Navidrome | playable audio and library membership |
| Discogs | exact physical pressing, sides, track positions, labels, catalogue numbers, credits and pressing artwork |
| MusicBrainz | canonical release / release-group identity |
| Cover Art Archive | exact-release and release-group artwork |
| Last.fm | community tags, descriptive/popularity metadata |
| Newznab/NZBHydra2/Prowlarr | optional repair candidate search |
| SABnzbd | optional temporary repair download/unpack |
| NeedleDrop | final selected values, local overrides, track mapping, duplicate presentation, artwork and repair authority |

A manual selection in NeedleDrop always wins over automatic source priority.

## Earlier milestones

### v0.4.1 — Unraid/appdata permission hotfix

- `/data` ownership is automatically repaired before NeedleDrop starts.
- Configurable `PUID`, `PGID` and `UMASK` values are supported.
- The Unraid template defaults to `PUID=99` and `PGID=100` (`nobody:users`).

### v0.4.0 — automatic record changer

- Changer/spindle queue inspired by classic automatic turntables.
- Add, reorder, remove, clear or immediately play queued records.
- Vinyl Mode retains manual side flips; after the final side, the next queued record drops automatically.

### v0.3.0 — animated turntable

- Animated platter, record and tonearm.
- Click/tap groove placement, cue lift/lower and motor controls.
- 33⅓ / 45 / 78 RPM plus ±8% pitch and optional real speed/pitch simulation.

### v0.2.x — Discogs, branding and settings

- Exact Discogs release selection and A/B/C/D physical-side mapping.
- Release artwork, credits, identifiers and notes.
- Browser/PWA/Unraid icon family and visible app version.
- In-app system settings and connection tests.

## Architecture

```text
Browser / installed PWA
        |
        v
   NeedleDrop :3000
        |
        +--> /data/needledrop.db  (canonical collection + settings + mappings + repair state)
        |
        +--> Navidrome /rest/*    (audio/playback/library scan)
        +--> Discogs API          (physical releases + fallback artwork)
        +--> MusicBrainz API      (identity)
        +--> Cover Art Archive    (artwork)
        +--> Last.fm API          (optional metadata)
        |
        +--> Newznab / Hydra / Prowlarr  (optional repair search)
        +--> SABnzbd                    (optional temporary repair download)
        +--> /repair                    (repair staging only)
        +--> /music-repair              (dedicated Navidrome-visible repair imports only)
```

Duplicate merges alter NeedleDrop's presentation only. NZB Track Repair is the only feature that writes audio, and it writes solely to the explicitly configured dedicated repair-import mount.

## Docker / Unraid

Image:

```text
ghcr.io/bclark303/needledrop:latest
```

Recommended base Unraid values:

- Web UI port: host `3030` → container `3000`
- Appdata: `/mnt/user/appdata/needledrop` → `/data`
- `NAVIDROME_URL`: initial Navidrome address reachable from the container
- `SESSION_SECRET`: generate with `openssl rand -hex 32`
- `DISCOGS_TOKEN`: optional initial Discogs token
- `LASTFM_API_KEY`: optional Last.fm API key; can also be entered in Settings
- `PUID=99`, `PGID=100`, `UMASK=002`: normal Unraid defaults
- `MUSICBRAINZ_USER_AGENT`: optional initial MusicBrainz User-Agent
- `NEEDLEDROP_ADMIN_USERS`: optional comma-separated Navidrome usernames allowed to change system settings/send repair requests
- `COOKIE_SECURE=false` for plain LAN/Tailscale HTTP; use `true` behind HTTPS

Optional Track Repair mappings:

- SAB dedicated completed folder → `/repair` (`rw` if automatic cleanup is enabled)
- dedicated Navidrome-scanned repair music folder → `/music-repair` (`rw`)

Search-provider/SAB URLs and API keys can be stored from **Library Manager → NZB Track Repair**; the Unraid template and `.env.example` also provide bootstrap variables.

The Unraid template is `templates/needledrop.xml` and references `public/needledrop-icon.png` for the Docker icon.

## Updating

```bash
docker pull ghcr.io/bclark303/needledrop:latest
```

Then restart the container. In Unraid, **Force Update** performs the equivalent pull/recreate operation. New volume mappings introduced by a release must still be added manually to an existing Unraid container template.

## Security notes

- Navidrome passwords are not stored. Login derives standard Subsonic token authentication and stores it in an AES-256-GCM encrypted HttpOnly cookie.
- Discogs, Last.fm, Lidarr, indexer and SAB credentials are stored server-side in NeedleDrop's appdata database and are never returned to the browser.
- With `NEEDLEDROP_ADMIN_USERS` blank, any authenticated Navidrome user can manage system settings and initiate repairs. Set it for multi-user installations.
- NZB repair candidate download URLs remain server-side and expire from NeedleDrop's candidate cache.
- Track Repair uses a dedicated staging root and a dedicated import root; cleanup is refused unless the completed job folder is inside the configured staging root and carries the request's unique token.
- The container starts with only enough privilege to repair `/data`, then drops privileges before launching Node.
- Do not expose NeedleDrop directly to the public Internet over plain HTTP.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The production Docker build uses Next.js standalone output. Pull requests validate AMD64 and releases from `main` publish an AMD64 GHCR image. The browser/PWA client itself is architecture-independent.
