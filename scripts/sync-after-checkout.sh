#!/usr/bin/env bash
# Keeps deps, the Prisma client and the database in sync after switching branches
# or merging. Called by .githooks/post-checkout and post-merge.
#
#   scripts/sync-after-checkout.sh <old-rev> <new-rev>
#
# - every branch has its own database (scripts/db-name.sh); on a branch switch
#   .env is rewritten to point at it, and a new one is created, migrated, seeded
# - pnpm-lock.yaml changed      → pnpm install
# - apps/api/prisma changed     → prisma generate + migrate deploy
#
# Never fails the git command: if the DB is down it just prints a hint.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

OLD="${1:-}"; NEW="${2:-HEAD}"
[[ "$OLD" =~ ^0+$ ]] && exit 0              # fresh clone: setup.sh handles that
[[ -d node_modules && -f .env ]] || exit 0  # not set up yet: nothing to sync

changed() { [[ -n "$OLD" && "$OLD" != "$NEW" ]] && ! git diff --quiet "$OLD" "$NEW" -- "$@" 2>/dev/null; }
say() { printf '\033[36m[sync]\033[0m %s\n' "$*"; }
db_of_env() { sed -nE 's|^DATABASE_URL=.*/([^/?]+).*|\1|p' .env; }

# --- which database does this branch use? -------------------------------------
BEFORE="$(db_of_env)"
AFTER="$(bash scripts/db-name.sh)"
SWITCHED=false
if [[ "$BEFORE" != "$AFTER" ]]; then
  bash scripts/dev-env.sh >/dev/null
  SWITCHED=true
  say "database: $BEFORE → $AFTER"
fi

# --- dependencies ---------------------------------------------------------------
if changed pnpm-lock.yaml; then
  say "lockfile changed → pnpm install"
  pnpm install --frozen-lockfile --silent || say "pnpm install failed — run it manually"
fi

# --- prisma client + schema -------------------------------------------------------
if changed apps/api/prisma; then
  say "Prisma schema changed → prisma generate"
  pnpm --silent --filter @mt/api db:generate >/dev/null || say "prisma generate failed — run: pnpm --filter @mt/api db:generate"
fi

if $SWITCHED || changed apps/api/prisma; then
  if out="$(pnpm --silent db:deploy 2>&1)"; then
    if grep -qE "created database|database .* created" <<<"$out"; then
      say "created $AFTER → migrated, seeding"
      pnpm --silent db:seed >/dev/null 2>&1 || say "seed failed — run: pnpm db:seed"
    elif grep -q "have been applied" <<<"$out"; then
      say "applied new migrations to $AFTER"
    fi
  else
    say "can't migrate $AFTER (is the DB up? pnpm infra:up). Then: pnpm db:deploy"
  fi
fi
exit 0
