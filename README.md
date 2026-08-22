# NeedleDrop

NeedleDrop is a self-hosted virtual-vinyl front end for Navidrome. It turns a digital music library into something closer to using a physical record collection: browse jackets, select an exact pressing, put a record on an animated turntable, lower the needle, flip sides, and queue albums on an automatic changer spindle.

Current version: **v0.4.0**

## Release milestones

### v0.2.1 — branding, versioning and in-app settings

- App version shown in the UI and Settings panel.
- New NeedleDrop icon family for the browser tab, PWA/phone install and Unraid Docker template.
- In-app system settings for Navidrome, Discogs and MusicBrainz.
- Connection-test buttons for all three services.
- Server-side persisted settings under `/data/settings.json`.
- Metadata and artwork source priority controls.
- Per-album artwork selection between Navidrome and individual Discogs release images.
- Optional `NEEDLEDROP_ADMIN_USERS` restriction for system settings.

### v0.3.0 — animated turntable

- Full graphical turntable playback surface.
- Animated platter and record.
- Tonearm position follows playback progress through the current side.
- Click/tap the record grooves to place the needle approximately on the side.
- Cue lift/lower control.
- Start/stop motor control.
- 33⅓ / 45 / 78 RPM selector.
- ±8% fine pitch adjustment.
- Optional real playback-rate/pitch simulation, including intentionally playing a 33⅓ RPM pressing at 45 RPM.
- Discogs pressing metadata supplies the nominal record speed when available.

### v0.4.0 — automatic record changer

- Changer/spindle queue inspired by classic automatic turntables.
- Add records from the shelf or album page.
- Reorder, remove, clear or play a queued record immediately.
- Queue persists in the browser across reloads.
- In Vinyl Mode, side flips remain manual; after the final side, the next queued record drops automatically.
- Multi-LP Discogs releases continue to use their actual A/B/C/D/etc. physical side boundaries.

## Discogs integration

When a Discogs personal access token is configured, NeedleDrop can:

- search vinyl releases for a Navidrome album;
- select and persist an exact Discogs Release ID;
- import label, catalogue number, country, date, format and vinyl description;
- import release notes, credits, identifiers, barcodes/matrix details and release images;
- use exact Discogs track positions such as `A1`, `A2`, `B1`, `B2`, `C1` and `D1`;
- map Discogs tracks to Navidrome audio files;
- warn rather than silently reorder playback when the selected pressing differs from the available audio;
- choose a specific Discogs image or Navidrome cover art per album.

## Architecture

```text
Browser / installed PWA
        |
        v
   NeedleDrop :3000
    |           |
    |           +--> /data/settings.json
    |           +--> /data/needledrop.json
    |
    +--> Navidrome /rest/*
    +--> Discogs API
    +--> MusicBrainz API
```

NeedleDrop does not mount or modify the music library. Navidrome remains the source of truth for audio files and normal library metadata. NeedleDrop stores only its own settings and virtual-record metadata.

## Docker / Unraid

Image:

```text
ghcr.io/bclark303/needledrop:latest
```

Recommended Unraid values:

- Web UI port: host `3030` -> container `3000`
- Appdata: `/mnt/user/appdata/needledrop` -> `/data`
- `NAVIDROME_URL`: initial Navidrome address reachable from the container
- `SESSION_SECRET`: random 32+ character secret; `openssl rand -hex 32` is recommended
- `DISCOGS_TOKEN`: optional initial Discogs token
- `MUSICBRAINZ_USER_AGENT`: optional initial MusicBrainz user-agent
- `NEEDLEDROP_ADMIN_USERS`: optional comma-separated Navidrome usernames allowed to change system settings
- `COOKIE_SECURE=false` for plain LAN/Tailscale HTTP; use `true` behind HTTPS

The Unraid template is in `templates/needledrop.xml` and uses `public/needledrop-icon.svg` as the Docker icon.

Connection values supplied by Docker are first-run/default values. After login, authorized users can change Navidrome, Discogs, MusicBrainz and playback defaults from the NeedleDrop Settings panel; saved values live in `/data/settings.json` and take precedence over the environment defaults.

If `/data` is not writable, ensure the host directory is writable by container UID/GID `1001:1001`.

## Updating

After a successful GitHub Actions build:

```bash
docker pull ghcr.io/bclark303/needledrop:latest
```

Then restart the container. In Unraid, **Force Update** performs the equivalent pull/recreate operation.

## Security notes

- Navidrome passwords are not stored. Login derives standard Subsonic token authentication and stores it in an AES-256-GCM encrypted HttpOnly cookie.
- Discogs tokens saved in the app are stored server-side in `/data/settings.json`; the file is created with mode `0600` where supported and the token is never returned to the browser.
- With `NEEDLEDROP_ADMIN_USERS` blank, any authenticated Navidrome user can manage system settings. For multi-user installations, set it to one or more comma-separated Navidrome usernames.
- Do not expose NeedleDrop directly to the public Internet over plain HTTP.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The production Docker build uses Next.js standalone output and GitHub Actions publishes both `linux/amd64` and `linux/arm64` images.
