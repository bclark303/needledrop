# NeedleDrop

NeedleDrop is a self-hosted, installable virtual-vinyl front end for Navidrome. It intentionally makes a digital music library feel more like a physical record collection: browse jackets, select a physical pressing, play its real sides, flip the record, and continue.

## v0.2.0 features

- Navidrome/OpenSubsonic authentication; no separate user database
- Responsive record-shelf library for desktop, Android, iOS and TV-class browsers
- PWA manifest and service worker
- Album jackets with vinyl-sleeve interaction
- Vinyl Mode (default) with mandatory physical-side transitions
- Multi-LP side support (A/B/C/D/...); B → C prompts for a record change rather than a simple flip
- Normal Mode for direct track selection
- Search, Artist A–Z, recently added, recently played, frequently played, favourites and random-record selection
- Streaming through a same-origin proxy with HTTP Range support
- Media Session metadata/controls for supported browsers
- Navidrome scrobbling after completed tracks
- MusicBrainz vinyl release lookup as a fallback metadata source
- Discogs exact-release search and selection when `DISCOGS_TOKEN` is configured
- Full selected Discogs release fetch and local caching
- Discogs pressing metadata: label, catalogue number, country, date, format, genres/styles and identifiers
- Discogs release notes and release/track-level credits
- Discogs release image gallery (front/back/labels/gatefold/booklet images when present for that release)
- Discogs track positions and physical side grouping from A1/A2/B1... metadata
- Automatic Discogs → Navidrome track mapping using title, duration, order and proximity
- Mapping warnings when the selected pressing differs from the Navidrome audio files
- Safe A/B playback fallback if the exact Discogs track layout cannot be mapped completely
- Per-album personal metadata: vinyl colour, condition, acquired date, notes and crate/shelf
- Docker/Unraid deployment

## Architecture

```text
Browser / installed PWA
        |
        v
   NeedleDrop :3000
    |           |
    |           +--> /data/needledrop.json
    |                 - selected Discogs release ID
    |                 - cached pressing metadata
    |                 - side/track mappings
    |                 - personal collection metadata
    |
    +--> Navidrome /rest/* (library, artwork, stream, favourites, scrobble)
    +--> Discogs API (exact physical release metadata)
    +--> MusicBrainz (fallback pressing candidates)
```

NeedleDrop does **not** mount or modify the music library. Navidrome remains the source of truth for the collection and audio files. Discogs becomes the source of truth for the selected physical pressing once you choose one.

## Quick start with the prebuilt Docker image

NeedleDrop publishes multi-architecture images to GitHub Container Registry:

```text
ghcr.io/bclark303/needledrop:latest
```

1. Clone/download this repository, or copy `docker-compose.yml` and `.env.example` to a directory on your server.
2. Copy `.env.example` to `.env`.
3. Set `NAVIDROME_URL` to an address reachable **from inside the NeedleDrop container**.
4. Generate a long random `SESSION_SECRET` (32+ characters).
5. Add a Discogs personal access token to `DISCOGS_TOKEN` for exact pressing integration.
6. Leave `COOKIE_SECURE=false` for direct HTTP/Tailscale access; set it to `true` after placing NeedleDrop behind HTTPS.
7. Run:

```bash
docker compose pull
docker compose up -d
```

Open `http://<unraid-ip>:3030` and sign in with your existing Navidrome username/password.

## Unraid

A native Unraid v2 template is included at:

```text
templates/needledrop.xml
```

For a manual container:

- Repository/Image: `ghcr.io/bclark303/needledrop:latest`
- Network: `bridge` (or the same custom Docker network as Navidrome)
- WebUI: `http://[IP]:[PORT:3000]/`
- Host port: `3030` -> container port `3000`
- Appdata: `/mnt/user/appdata/needledrop` -> `/data`
- Variables: `NAVIDROME_URL`, `SESSION_SECRET`, `COOKIE_SECURE`, `MUSICBRAINZ_USER_AGENT`, and `DISCOGS_TOKEN`

If Navidrome and NeedleDrop share a custom Docker network, `NAVIDROME_URL=http://navidrome:4533` is ideal. Otherwise use the Unraid server address and Navidrome's published port.

For Tailscale-only remote access, browse to `http://<unraid-tailscale-ip>:3030`. Do not publish NeedleDrop directly to the public Internet without HTTPS/reverse-proxy hardening.

## Discogs integration

Set `DISCOGS_TOKEN` to a Discogs personal access token. The token remains server-side and is never sent to the browser.

When you choose **Pressing & details**, NeedleDrop searches Discogs for vinyl release candidates. Selecting one causes NeedleDrop to fetch the full Discogs Release record and save a normalized snapshot locally. The saved physical-release metadata can include:

- Discogs Release ID and Master ID
- exact pressing title
- country and release date
- label and catalogue number
- vinyl format/quantity/descriptions
- genre/style
- barcodes, matrix/runout and other identifiers
- factual Discogs release notes
- main and track-specific credits
- release images supplied by Discogs
- exact track positions such as `A1`, `A2`, `B1`, `B2`, `C1`, `D1`

NeedleDrop maps Discogs tracks to Navidrome files using normalized title similarity, running time, order and proximity. If every Navidrome track maps exactly once, Discogs' physical side layout drives playback. If not, NeedleDrop shows the exact Discogs listing but uses its duration-based A/B fallback for safe audio playback and explains the mismatch in the details drawer.

Discogs images are referenced from Discogs; NeedleDrop does not copy them into the music library.

## Security model

The login password is used once to derive standard Subsonic token authentication (`MD5(password + salt)`). NeedleDrop stores the resulting username/salt/token in an AES-256-GCM encrypted, HttpOnly session cookie. It does not persist the Navidrome password in its local data store.

Use a unique, random `SESSION_SECRET`. Changing it signs all users out.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Roadmap

- Discogs Master-first release selection and filtering by country/year/label
- pressing confidence scoring and automatic best-match suggestion
- explicit manual track mapper for unusual editions
- explicit manual side editor
- richer gatefold/back-cover/label presentation using selected-release images
- custom crates and smart shelves
- collection statistics and "haven't spun in a while"
- TV-specific D-pad focus mode
- offline album downloads
- optional Navidrome metadata plugin once the plugin/UI integration story is mature enough

## Docker image publishing

GitHub Actions builds and publishes `ghcr.io/bclark303/needledrop` whenever `main` changes. A version tag such as `v0.2.0` also publishes corresponding semantic-version image tags. The workflow builds both `linux/amd64` and `linux/arm64`.
