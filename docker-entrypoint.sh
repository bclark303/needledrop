#!/bin/sh
set -eu

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"
DATA_DIR="${NEEDLEDROP_DATA_DIR:-/data}"

case "$PUID" in
  ''|*[!0-9]*) echo "Invalid PUID: $PUID" >&2; exit 1 ;;
esac
case "$PGID" in
  ''|*[!0-9]*) echo "Invalid PGID: $PGID" >&2; exit 1 ;;
esac

mkdir -p "$DATA_DIR"

# Bind-mounted appdata directories are commonly created as root by Docker/Unraid.
# Repair ownership before dropping privileges so NeedleDrop can persist settings
# and release metadata without requiring a manual host-side chown.
chown -R "$PUID:$PGID" "$DATA_DIR"

umask "${UMASK:-002}"

# Next.js standalone uses HOSTNAME as its bind address. Docker normally sets
# HOSTNAME to the container ID, which prevents localhost/Tailscale Serve from
# reaching the application. Bind to all container interfaces instead.
export HOSTNAME=0.0.0.0

exec su-exec "$PUID:$PGID" "$@"
