# NeedleDrop

NeedleDrop is a self-hosted, installable virtual-vinyl front end for Navidrome. It intentionally makes a digital music library feel more like a physical record collection: browse jackets, play Side A, flip the record, and continue with Side B.

## v0.1.0 features

- Navidrome/OpenSubsonic authentication; no separate user database
- Responsive record-shelf library for desktop, Android, iOS and TV-class browsers
- PWA manifest and service worker
- Album jackets with vinyl-sleeve interaction
- Vinyl Mode (default) with a mandatory Side A → Side B flip
- Normal Mode for direct track selection
- Automatic side split estimation by running time, with local override support
- Search, Artist A–Z, recently added, recently played, frequently played, favourites and random-record selection
- Streaming through a same-origin proxy with HTTP Range support
- Media Session metadata/controls for supported browsers
- Navidrome scrobbling after completed tracks
- MusicBrainz vinyl release lookup
- Optional Discogs release lookup when `DISCOGS_TOKEN` is configured
- Per-album local metadata: pressing selection, catalogue number, country, year, vinyl colour, condition, acquired date, notes and crate/shelf
- Docker/Unraid deployment

## Architecture

```text
Browser / installed PWA
        |
        v
   NeedleDrop :3000
    |           |
    |           +--> /data/needledrop.json (NeedleDrop-only metadata)
    |
    +--> Navidrome /rest/* (library, artwork, stream, favourites, scrobble)
    +--> MusicBrainz (pressing candidates)
    +--> Discogs (optional pressing candidates)
```

NeedleDrop does **not** mount or modify the music library. Navidrome remains the source of truth for the collection and audio files.

## Quick start with the prebuilt Docker image

NeedleDrop publishes multi-architecture images to GitHub Container Registry:

```text
ghcr.io/bclark303/needledrop:latest
```

1. Clone/download this repository, or copy `docker-compose.yml` and `.env.example` to a directory on your server.
2. Copy `.env.example` to `.env`.
3. Set `NAVIDROME_URL` to an address reachable **from inside the NeedleDrop container**.
4. Generate a long random `SESSION_SECRET` (32+ characters).
5. Optionally add a Discogs personal access token to `DISCOGS_TOKEN`.
6. Leave `COOKIE_SECURE=false` for direct HTTP/Tailscale access; set it to `true` after placing NeedleDrop behind HTTPS.
7. Run:

```bash
docker compose pull
docker compose up -d
```

To update later:

```bash
docker compose pull
docker compose up -d
```

Open `http://<unraid-ip>:3030` and sign in with your existing Navidrome username/password.

## Unraid notes

For a manual Unraid container, use:

- Repository/Image: `ghcr.io/bclark303/needledrop:latest`
- Network: `bridge` (or the same custom Docker network as Navidrome)
- WebUI: `http://[IP]:[PORT:3000]/`
- Host port: `3030` -> container port `3000`
- Appdata: `/mnt/user/appdata/needledrop` -> `/data`
- Variables: `NAVIDROME_URL`, `SESSION_SECRET`, `COOKIE_SECURE`, `MUSICBRAINZ_USER_AGENT`, and optionally `DISCOGS_TOKEN`

Recommended paths:

- Appdata: `/mnt/user/appdata/needledrop` -> `/data`
- WebUI port: host `3030` -> container `3000`
- No music-library mount is required.

If Navidrome and NeedleDrop share a custom Docker network, `NAVIDROME_URL=http://navidrome:4533` is ideal. Otherwise use the Unraid server address and Navidrome's published port, e.g. `http://192.168.1.20:4533`.

For Tailscale-only remote access, expose port 3030 on the Unraid host and browse to `http://<unraid-tailscale-ip>:3030`. Do not publish NeedleDrop directly to the public Internet without HTTPS/reverse-proxy hardening.

## Discogs

MusicBrainz enrichment works without a token. Discogs lookup is enabled only if `DISCOGS_TOKEN` is populated. The token is kept server-side and is never sent to the browser.

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

- richer Discogs master/release matching and pressing confidence scoring
- explicit manual Side A/B editor in the UI
- gatefold/back-cover/label artwork
- multi-LP sets (A/B/C/D...)
- custom crates and smart shelves
- collection statistics and "haven't spun in a while"
- TV-specific D-pad focus mode
- offline album downloads
- optional Navidrome metadata plugin once the plugin/UI integration story is mature enough

## Docker image publishing

GitHub Actions builds and publishes `ghcr.io/bclark303/needledrop` whenever `main` changes. A version tag such as `v0.1.0` also publishes corresponding semantic-version image tags. The workflow builds both `linux/amd64` and `linux/arm64`.
