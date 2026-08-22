# NeedleDrop

NeedleDrop is a self-hosted virtual-vinyl front end for Navidrome. It turns a digital music library into something closer to using a physical record collection: browse jackets or a record shelf, select an exact pressing, put a record on an animated turntable, lower the needle, flip sides, and queue albums on an automatic changer spindle.

Current version: **v0.6.0**

## v0.6.0 — library management and record shelf

- **Manual library rescan** asks Navidrome to scan its music folders, then rebuilds NeedleDrop's complete album index and starts enrichment for new/unresolved records.
- **Duplicate management** detects conservative artist/title duplicate groups. Choose one Navidrome album ID to keep visible; other copies are hidden in NeedleDrop only. Merges are reversible and never delete or modify Navidrome data.
- **Artwork resolver v3** retains multiple candidates and actually tries them in sequence instead of assuming a stored URL is valid.
- Albums without embedded/Navidrome art keep Cover Art Archive and Discogs fallback candidates available at the same time, so a dead remote image can fall through to another source.
- Discogs image requests use the configured Discogs token where applicable.
- Generated "artwork not found" jackets are no longer cached, preventing an early placeholder from sticking after enrichment later succeeds.
- Each album's artwork panel includes **Resolve again** for an immediate one-record metadata/artwork retry.
- **My rating** adds a local 1–5 star rating that can be used to sort the collection.
- New collection organization options: artist/band, album title, oldest/newest chronology, rating, recently added, recently played, most played and favourites.
- Optional grouping by artist/band, decade or year.
- New **Record Shelf** view displays albums spine-on; hover/focus pulls a jacket out so the front cover becomes visible.
- A real PNG NeedleDrop icon is included for Unraid, browser/PWA metadata and other clients that do not render the previous SVG template icon.

## v0.5.x — canonical metadata library

NeedleDrop maintains its own authoritative collection database at `/data/needledrop.db` using SQLite. Navidrome remains the source of playable audio, while NeedleDrop stores the physical-release identity, artwork choices, external-source matches, provenance and local overrides used by the vinyl interface.

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
| NeedleDrop | final selected values, local overrides, duplicate presentation and artwork authority |

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
        +--> /data/needledrop.db  (canonical collection + settings + merges)
        |
        +--> Navidrome /rest/*    (audio/library scan)
        +--> Discogs API          (physical releases + fallback artwork)
        +--> MusicBrainz API      (identity)
        +--> Cover Art Archive    (artwork)
        +--> Last.fm API          (optional metadata)
```

NeedleDrop does not mount or modify the music library. Duplicate merges alter NeedleDrop's presentation only.

## Docker / Unraid

Image:

```text
ghcr.io/bclark303/needledrop:latest
```

Recommended Unraid values:

- Web UI port: host `3030` → container `3000`
- Appdata: `/mnt/user/appdata/needledrop` → `/data`
- `NAVIDROME_URL`: initial Navidrome address reachable from the container
- `SESSION_SECRET`: generate with `openssl rand -hex 32`
- `DISCOGS_TOKEN`: optional initial Discogs token
- `LASTFM_API_KEY`: optional Last.fm API key; can also be entered in Settings
- `PUID=99`, `PGID=100`, `UMASK=002`: normal Unraid defaults
- `MUSICBRAINZ_USER_AGENT`: optional initial MusicBrainz User-Agent
- `NEEDLEDROP_ADMIN_USERS`: optional comma-separated Navidrome usernames allowed to change system settings
- `COOKIE_SECURE=false` for plain LAN/Tailscale HTTP; use `true` behind HTTPS

The Unraid template is `templates/needledrop.xml` and references `public/needledrop-icon.png` for the Docker icon.

Docker environment values seed first-run configuration. Authorized users can then manage Navidrome, Discogs, MusicBrainz, Cover Art Archive, Last.fm, source priority, enrichment and playback defaults from NeedleDrop Settings. Library rescan and duplicate controls live in the Library Manager button in the top bar.

## Updating

```bash
docker pull ghcr.io/bclark303/needledrop:latest
```

Then restart the container. In Unraid, **Force Update** performs the equivalent pull/recreate operation.

## Security notes

- Navidrome passwords are not stored. Login derives standard Subsonic token authentication and stores it in an AES-256-GCM encrypted HttpOnly cookie.
- Discogs and Last.fm credentials are stored server-side in NeedleDrop's appdata database and are never returned to the browser.
- With `NEEDLEDROP_ADMIN_USERS` blank, any authenticated Navidrome user can manage system settings. Set it for multi-user installations.
- The container starts with only enough privilege to repair `/data`, then drops privileges before launching Node.
- Do not expose NeedleDrop directly to the public Internet over plain HTTP.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The production Docker build uses Next.js standalone output. Pull requests validate AMD64 and releases from `main` publish an AMD64 GHCR image. The browser/PWA client itself is architecture-independent.
