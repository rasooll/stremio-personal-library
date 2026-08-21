#!/bin/sh
set -eu

umask 027

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID" in
  *[!0-9]*|0)
    echo "PUID and PGID must be non-zero numeric IDs" >&2
    exit 1
    ;;
esac

case "$PGID" in
  *[!0-9]*|0)
    echo "PUID and PGID must be non-zero numeric IDs" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R "$PUID:$PGID" /app/data
  chmod u+rwx /app/data
  export HOME=/tmp
  exec gosu "$PUID:$PGID" "$@"
fi

exec "$@"
