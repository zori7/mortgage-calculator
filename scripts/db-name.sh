#!/usr/bin/env bash
# Prints the Postgres database name for a git branch (default: the current one).
# One database per branch, all inside this slot's Postgres, so switching branches
# also switches databases and a branch's migrations never leak into another's.
#
#   scripts/db-name.sh [branch]
#
#   main / master          → mortgage                (the original DB, unchanged)
#   task/05-csv            → mortgage_task_05_csv
#   detached HEAD          → keeps the DB currently in .env (or mortgage)
#   very long branch names → truncated + checksum, to fit Postgres' 63-char limit
set -euo pipefail
cd "$(dirname "$0")/.."

BASE=mortgage
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)}"

if [[ "$BRANCH" == "HEAD" ]]; then
  current="$(sed -nE 's|^DATABASE_URL=.*/([^/?]+).*|\1|p' .env 2>/dev/null)"
  echo "${current:-$BASE}"
  exit 0
fi

case "$BRANCH" in
  main|master) echo "$BASE"; exit 0 ;;
esac

slug="$(printf '%s' "$BRANCH" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')"
max=$((63 - ${#BASE} - 1))
if (( ${#slug} > max )); then
  sum="$(printf '%s' "$BRANCH" | cksum | cut -d' ' -f1)"
  slug="${slug:0:$((max - ${#sum} - 1))}_$sum"
fi
echo "${BASE}_${slug}"
