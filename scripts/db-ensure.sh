#!/usr/bin/env bash
# Creates this checkout's database (from .env) if it doesn't exist yet.
# Prints "created database <name>" when it did; silent when it already existed.
#
# Prisma can create a missing database itself, but inside an OpenHands sandbox
# (Linux engine, DB reached via host.docker.internal) it reports P1001 "can't
# reach database server" instead. So create it explicitly, via the `postgres` DB.
set -uo pipefail
cd "$(dirname "$0")/.."
URL="$(sed -n 's/^DATABASE_URL=//p' .env)"
[[ -n "$URL" ]] || { echo "no DATABASE_URL in .env (run scripts/dev-env.sh)" >&2; exit 1; }
DB="${URL##*/}"; DB="${DB%%\?*}"
ADMIN="${URL%/*}/postgres"

out="$(echo "CREATE DATABASE \"$DB\"" | pnpm --silent --filter @mt/api exec prisma db execute --stdin --url "$ADMIN" 2>&1)"
if [[ $? -eq 0 ]]; then
  echo "created database $DB"
elif ! grep -q "already exists" <<<"$out"; then
  echo "$out" >&2; exit 1
fi
