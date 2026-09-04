# NeedleDrop

NeedleDrop is a self-hosted virtual-vinyl front end for Navidrome. It turns a digital music library into something closer to using a physical record collection: browse jackets or physical-style shelves and crates, choose an exact pressing, interact with an animated turntable, lower the needle, flip sides, queue albums on an automatic changer spindle, and browse your collection from an interactive Record Room.

Current version: **v0.9.0**

## v0.9.0 — Three interactive Record Rooms

- The Bedroom Listening Nook and Record Collector Room are now available alongside the Audiophile Listening Room.
- Each room is built from live NeedleDrop components with its own furniture layout, lighting, materials and decorative details—not a background photograph or simple colour swap.
- The Bedroom Listening Nook adds a warm personal setup with posters, string lights, a bed, compact hi-fi furniture and a floor crate.
- The Record Collector Room adds a record-shop display wall, hanging lights, timber browsing furniture, new-arrivals bins and a dedicated listening counter.
- All three designs preserve the four mapped collection slots, clickable furniture, turntable, loaded album jacket and working amplifier controls.
- The selected room is stored in the existing per-user Record Room configuration and survives reloads and container updates.
- Package, in-app/API version reporting, PWA cache and deployment MusicBrainz User-Agent defaults are synchronized at v0.9.0.

## v0.8.6 — Navidrome library selection and maintenance closeout

- Settings now discovers the Navidrome libraries available to the signed-in user and can pin NeedleDrop to one named library.
- Album browsing, search, random selection, full enrichment, diagnostics, track matching and NeedleDrop index refreshes consistently send the selected Navidrome `musicFolderId`.
- Because Navidrome's Subsonic scan request is server-wide, NeedleDrop skips that request when a specific library is selected and refreshes only the selected library's visible inventory.
- Changing libraries stops current playback, clears the record changer and invalidates the old current-library snapshot so records from different libraries cannot remain mixed in the active UI.
- Full rescans persist an authoritative album-ID snapshot for the selected library; Duplicate Manager and live verification ignore historical cache rows from other or previously indexed libraries.
- ESLint 9 flat configuration, focused Node tests, a package lockfile, reproducible Docker `npm ci`, consolidated application CSS and a clean Next.js build complete the v0.8 maintenance work.
- Package, in-app/API version reporting, PWA cache and deployment MusicBrainz User-Agent defaults are synchronized at v0.8.6.

## v0.8.5 — Turntable track listing

- The Turntable view now shows the selected physical release's complete track listing grouped by record side.
- The currently playing track is highlighted with a live **Now playing** indicator.
- **Vinyl Mode** keeps the track list display-only so playback still follows needle placement and physical side changes.
- **Normal Mode** makes locally playable tracks selectable directly from the Turntable view, including tracks on another physical side.
- Tracks present on the selected pressing but unavailable in the local library remain visible and are explicitly marked unavailable.
- The compact mobile playback-mode label now correctly switches between Vinyl and Normal.
- Package, in-app/API version reporting, PWA cache, and deployment MusicBrainz User-Agent defaults are synchronized at v0.8.5.

## v0.8.4 — Post-release cleanup

- Refresh documentation through the complete v0.8 Record Room milestone and the v0.7.8–v0.7.10 diagnostics/artwork fixes.
- Synchronize MusicBrainz User-Agent defaults in `.env.example`, Docker Compose, and the Unraid template with the current release.
- Remove the retired v0.8.1 photograph/hotspot Record Room CSS and its obsolete mobile override while retaining the collection/navigation styles still used by the component-built room.
- Bump the PWA cache so clients do not retain the removed room CSS.
- No collection, metadata, playback, repair, or hi-fi behavior changes are intended.

## v0.8.3 — Record Room polish and functional hi-fi

The component-built Audiophile Listening Room is the current Record Room prototype and the primary v0.8 interaction model.

- LP spine browsing now uses tall, narrow record proportions and contained physical shelf sections instead of an unbounded horizontal row.
- Pull-out jackets render as overlays so opening a record does not stretch or reflow the shelf.
- Room collection plaques stay attached to their furniture and avoid covering record content.
- VU-meter needles are constrained inside their meter frames.
- The integrated amplifier is interactive and provides working **Volume**, **Balance**, **Bass**, **Mid**, and **Treble** controls plus reset.
- Volume uses the normal browser audio element. Balance and EQ activate a Web Audio processing chain only after the listener changes a tone/balance control, preserving normal playback behavior otherwise.
- Hi-fi settings are stored locally in the browser.

## v0.8.2 — Component-built Audiophile Listening Room

The original photograph/hotspot Record Room experiment was retired in favour of a room built entirely from live NeedleDrop UI components.

- Left and right vinyl libraries, a low record cabinet, and a front flip crate display records from the collections mapped to them.
- Record furniture is itself clickable and opens the associated NeedleDrop collection.
- The turntable is an interactive room component linked to the existing player.
- The currently loaded album jacket is displayed beside the turntable and opens the album.
- Room / Collection / Turntable navigation is available directly inside the room experience.
- This release established the shared component-room model later expanded to all three room designs in v0.9.0.

## v0.8.0–v0.8.1 — Record Room and collection organization

- Per-user Record Room configuration is persisted in NeedleDrop's SQLite database.
- Collection sort, grouping, and view mode persist across devices for each Navidrome user.
- Manual shelves/crates and live smart shelves support favourites, rating, decade, genre, and recent additions.
- Featured records and physical-style flip-bin browsing complement the grid and spine-shelf collection views.
- Four room furniture slots can be mapped to All Records or any saved shelf/crate.
- Clicking room furniture opens the real filtered collection rather than maintaining a duplicate room-only library.

## v0.7.10 — Canonical pressing artwork

- Every image from the selected Discogs pressing can be explicitly chosen with **Use for collection**.
- The chosen image is promoted into NeedleDrop's canonical artwork table and pinned for the album.
- Album, Collection, and Turntable artwork therefore use the same persisted choice.
- Mutable canonical artwork responses are revalidated and versioned to avoid stale browser/Navidrome cache results.

## v0.7.9 — Artwork and multi-disc fixes

- Repeated generic Navidrome artwork is detected by persistent content fingerprint and rejected after it is observed across multiple distinct albums.
- Metadata lookup normalization handles common CD/disc suffixes and trailing edition/region qualifiers.
- Cover Art Archive HTTP image URLs are upgraded to HTTPS when imported.
- Strict `CD/Disc/Disk N` album splits are automatically combined into one logical multi-disc release when artist/title/year/disc-number checks prove they belong together.

## v0.7.8 — App-wide diagnostics

NeedleDrop's diagnostics subsystem can capture a sanitized, structured reproduction of intermittent issues without requiring a separate volume mount.

- Browser errors, internal API timing/status, route/lifecycle/network state, failed resources, long tasks, storage/service-worker state, and playback media events.
- Navidrome, Discogs, MusicBrainz, and Last.fm provider request traces with latency/status and safe retry/rate-limit headers.
- Runtime/container/process health, SQLite integrity/pragmas/WAL status, filesystem capacity/permissions, data/cache inventory, and server resource snapshots.
- Detailed artwork candidate, fallback, cache, enrichment, and browser-load telemetry.
- Admin controls in Library Manager for clean capture, stop, timeline markers, snapshots, clear, and sanitized JSON export.

## v0.7.2–v0.7.3 — NZB Track Repair

NZB Track Repair is the preferred way to fill individual gaps in an otherwise playable virtual record. It is optional and intended only for material you are authorized to retrieve.

- Supports a direct **Newznab-compatible indexer**, **NZBHydra2**, or **Prowlarr** as the search layer.
- Uses **SABnzbd** as the downloader/unpacker.
- **Repair missing tracks** first searches and downloads only NZB manifests. No music payload is queued until you choose a candidate.
- Candidate ranking considers artist/album identity, lossless preference, visible audio filenames, and how many missing tracks can be recognized directly in the NZB manifest.
- If an NZB contains RARs or obfuscated names, NeedleDrop can still let SAB download/unpack it and then inspect the extracted audio.
- Extracted audio is identified using filenames plus embedded title, artist, album, track-number, and duration metadata.
- Only confidently matched requested tracks are copied into the dedicated repair-import folder; the rest of the temporary album is discarded when safe cleanup is enabled.
- SAB jobs get a unique NeedleDrop repair token. Automatic cleanup only removes a completed staging directory when it is inside the configured repair root and its folder name contains that token.
- After a successful repair, NeedleDrop triggers a Navidrome/library rescan and remaps the selected physical release.
- **Verified direct album repair** is an advanced opt-in mode. A repaired track is still retained in the isolated repair library first, then a second stricter verification pass can promote it into the album's existing Navidrome folder. Existing files are never overwritten; tracks that do not pass the stricter check remain isolated.
- v0.7.3 adds persistent per-album **Search album title** and **Repair folder name** overrides for libraries/releases containing edition, year, region, remaster, or similar naming noise.
- Lidarr remains available as an optional album-level fallback.

### Track Repair storage model

The default model deliberately uses two narrow mounts instead of write access to the complete music library:

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

### Advanced verified direct album repair

If you intentionally want NeedleDrop to write repaired tracks into existing album folders, add a third mount containing the same host music root Navidrome scans and expose it to NeedleDrop at `/music` with write access. Then open **Library Manager → Verified direct album repair**, test the mount, and enable the feature.

Direct mode is transactional rather than a straight SAB-to-library copy:

```text
SAB /repair
   |
   v
isolated /music-repair copy
   |
   +--> second strict verification fails --> keep isolated
   |
   +--> second strict verification passes
             |
             v
       existing album folder under /music
```

NeedleDrop resolves the destination from song paths reported by Navidrome, refuses any path outside the configured `/music` root, requires the destination album folder to be writable, and uses no-clobber file copies so an existing file is never replaced.

## v0.7.x — Collection Engine

- A selected Discogs/MusicBrainz physical release is authoritative even when local audio is incomplete.
- Physical A/B/C/D side layout and track order remain intact while missing tracks are shown explicitly.
- NeedleDrop searches the broader Navidrome library for each physical track, allowing another release/duplicate/compilation copy to satisfy the selected record.
- Persistent provider-track mappings prepare the collection model for future additional playback providers.
- Albums report **Fully playable**, **Partially playable**, or **Collection only**.
- Optional Lidarr integration can add/monitor an album and run an album search when tracks are missing.
- v0.7.1 adds formatting-tolerant matching so metadata differences such as `God Smack` vs `Godsmack` and `Sick Man` vs `Sickman` do not create false missing-track reports.

## v0.6.x — Library management and physical collection views

- **Manual library rescan** asks Navidrome to scan its folders, then rebuilds NeedleDrop's complete album index and starts enrichment for new/unresolved records.
- **Duplicate management** detects conservative artist/title duplicate groups. Choose one Navidrome album ID to keep visible; other copies are hidden in NeedleDrop only. Merges are reversible and never delete or modify Navidrome data.
- **Artwork resolver** retains multiple candidates and tries actual image responses in priority order instead of assuming a stored URL is valid.
- Albums without embedded/Navidrome art keep Cover Art Archive and Discogs fallback candidates available together, so a dead remote image can fall through to another source.
- Each album's artwork panel includes **Resolve again** for an immediate one-record metadata/artwork retry.
- **My rating** adds a local 1–5 star rating that can be used to sort the collection.
- Collection organization includes artist/band, album title, oldest/newest chronology, rating, recently added, recently played, most played, and favourites, plus optional grouping by artist/band, decade, or year.
- Grid, spine-shelf, and flip-bin collection views are available.
- A PNG NeedleDrop icon is included for Unraid, browser/PWA metadata, and clients that do not render the SVG icon.

## v0.5.x — Canonical metadata library

NeedleDrop maintains its own authoritative collection database at `/data/needledrop.db` using SQLite. Navidrome remains the source of playable audio and normal library membership, while NeedleDrop stores physical-release identity, artwork choices, external-source matches, provenance, local overrides, collection organization, and repair state used by the vinyl interface.

- Existing `/data/needledrop.json` and `/data/settings.json` data is migrated automatically on first use.
- Discogs remains the preferred exact physical-pressing source.
- MusicBrainz supplies canonical release/release-group identity matching.
- Cover Art Archive supplies exact-release and release-group artwork.
- Optional Last.fm integration supplies community tags, album summaries, listener/play-count context, and matching identifiers.
- Artwork candidates and source provenance are retained in SQLite instead of being overwritten by later refreshes.
- Per-album artwork can be left on **Auto**, forced to raw Navidrome artwork, or pinned to a specific Discogs/Cover Art Archive candidate.
- Settings allow metadata and artwork source priority to be reordered.
- Automatic background enrichment can be enabled/disabled.
- **Enrich entire library** scans all Navidrome album pages, with live progress in Settings.

### Source authority

| Data | Primary role |
| --- | --- |
| Navidrome | playable audio and library membership |
| Discogs | exact physical pressing, sides, track positions, labels, catalogue numbers, credits, and pressing artwork |
| MusicBrainz | canonical release / release-group identity |
| Cover Art Archive | exact-release and release-group artwork |
| Last.fm | community tags, descriptive/popularity metadata |
| Newznab/NZBHydra2/Prowlarr | optional repair candidate search |
| SABnzbd | optional temporary repair download/unpack |
| NeedleDrop | final selected values, local overrides, track mapping, duplicate presentation, artwork, collection organization, and repair authority |

A manual selection in NeedleDrop always wins over automatic source priority.

## Earlier milestones

### v0.4.1 — Unraid/appdata permission hotfix

- `/data` ownership is automatically repaired before NeedleDrop starts.
- Configurable `PUID`, `PGID`, and `UMASK` values are supported.
- The Unraid template defaults to `PUID=99` and `PGID=100` (`nobody:users`).

### v0.4.0 — Automatic record changer

- Changer/spindle queue inspired by classic automatic turntables.
- Add, reorder, remove, clear, or immediately play queued records.
- Vinyl Mode retains manual side flips; after the final side, the next queued record drops automatically.

### v0.3.0 — Animated turntable

- Animated platter, record, and tonearm.
- Click/tap groove placement, cue lift/lower, and motor controls.
- 33⅓ / 45 / 78 RPM plus ±8% pitch and optional real speed/pitch simulation.

### v0.2.x — Discogs, branding, and settings

- Exact Discogs release selection and A/B/C/D physical-side mapping.
- Release artwork, credits, identifiers, and notes.
- Browser/PWA/Unraid icon family and visible app version.
- In-app system settings and connection tests.

## Architecture

```text
Browser / installed PWA
        |
        v
   NeedleDrop :3000
        |
        +--> /data/needledrop.db  (canonical collection + settings + mappings + room config + repair state)
        +--> /data/artwork-cache  (persistent upstream artwork cache)
        +--> /data/diagnostics    (bounded, admin-controlled diagnostic captures)
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
        +--> /music-repair              (default isolated repair imports)
        +--> /music                     (advanced opt-in verified direct album writes)
```

Duplicate merges alter NeedleDrop's presentation only. NZB Track Repair writes audio only to the explicitly configured repair mount by default. The main music library is untouched unless the separate verified direct-write feature is enabled, a writable `/music` mount is supplied, and direct album repair is explicitly selected for that repair.

## Docker / Unraid

Image:

```text
ghcr.io/bclark303/needledrop:latest
```

Recommended base Unraid values:

- Web UI port: host `3030` → container `3000`
- Appdata: `/mnt/user/appdata/needledrop` → `/data`
- `NAVIDROME_URL`: initial Navidrome address reachable from the container
- `NAVIDROME_MUSIC_FOLDER_ID`: optional initial library ID; the named library can be selected later in NeedleDrop Settings
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
- advanced only: main Navidrome music root → `/music` (`rw`) for verified direct album repair

Search-provider/SAB URLs and API keys can be stored from **Library Manager → NZB Track Repair**. Direct-write permission is configured separately under **Library Manager → Verified direct album repair**. The Unraid template and `.env.example` also provide bootstrap variables.

The Unraid template is `templates/needledrop.xml` and references `public/needledrop-icon.png` for the Docker icon.

## Updating

```bash
docker pull ghcr.io/bclark303/needledrop:latest
```

Then restart the container. In Unraid, **Force Update** performs the equivalent pull/recreate operation. New volume mappings introduced by a release must still be added manually to an existing Unraid container template.

## Security notes

- Navidrome passwords are not stored. Login derives standard Subsonic token authentication and stores it in an AES-256-GCM encrypted HttpOnly cookie.
- Discogs, Last.fm, Lidarr, indexer, and SAB credentials are stored server-side in NeedleDrop's appdata database and are never returned to the browser.
- With `NEEDLEDROP_ADMIN_USERS` blank, any authenticated Navidrome user can manage system settings and initiate repairs. Set it for multi-user installations.
- NZB repair candidate download URLs remain server-side and expire from NeedleDrop's candidate cache.
- Track Repair uses a dedicated staging root and a dedicated import root; cleanup is refused unless the completed job folder is inside the configured staging root and carries the request's unique token.
- Verified direct album repair is disabled by default, must be selected per repair, requires a second strict verification pass, refuses destination paths outside the configured library root, and never overwrites an existing file.
- Diagnostic exports are sanitized before download and the capture subsystem has bounded storage/event limits.
- The container starts with only enough privilege to repair `/data`, then drops privileges before launching Node.
- Do not expose NeedleDrop directly to the public Internet over plain HTTP.

## Development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Before opening a pull request:

```bash
npm run lint
npm test
npm run build
```

The production Docker build uses the committed lockfile with `npm ci` and Next.js standalone output. Pull requests validate AMD64 and releases from `main` publish an AMD64 GHCR image. The browser/PWA client itself is architecture-independent.

### Collection closeout report

The container includes a read-only collection verifier for the current SQLite database:

```bash
docker exec needledrop npm run verify:collection -- /data/needledrop.db
```

The JSON report checks database integrity, current album/merge counts, unresolved duplicate groups, Sgt. Pepper merge state, pinned pressing-artwork records, broken pinned selections, and albums with no known artwork. It does not modify the database. Proving that every previously missing album has returned still requires either the earlier missing-album list or a comparison with the current Navidrome library; proving that remote artwork renders requires an HTTP/UI check.
