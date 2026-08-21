#!/bin/sh
set -eu

umask 027

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  chmod u+rwx /app/data
  exec gosu node "$@"
fi

exec "$@"
