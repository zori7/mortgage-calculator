#!/usr/bin/env bash
# Keeps deps, the Prisma client and the DB schema in sync after switching
# branches or merging. Called by .githooks/post-checkout and post-merge.
#
#   scripts/sync-after-checkout.sh <old-rev> <new-rev>
#
# Only does work when something relevant changed between the two revisions, and
# never fails the git command: if the DB is down it just prints a hint.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

OLD="${1:-}"; NEW="${2:-HEAD}"
[[ -z "$OLD" || "$OLD" == "$NEW" ]] && exit 0
[[ "$OLD" =~ ^0+$ ]] && exit 0   # fresh clone: setup.sh handles that

changed() { ! git diff --quiet "$OLD" "$NEW" -- "$@" 2>/dev/null; }
say() { printf '\033[36m[sync]\033[0m %s\n' "$*"; }

# Not set up yet (no deps or no .env): nothing to sync.
[[ -d node_modules && -f .env ]] || exit 0

if changed pnpm-lock.yaml; then
  say "lockfile changed → pnpm install"
  pnpm install --frozen-lockfile --silent || say "pnpm install failed — run it manually"
fi

if changed apps/api/prisma; then
  say "Prisma schema/migrations changed → prisma generate"
  pnpm --silent --filter @mt/api db:generate >/dev/null || say "prisma generate failed — run: pnpm --filter @mt/api db:generate"

  say "applying migrations → prisma migrate deploy"
  if ! pnpm --silent db:deploy >/dev/null 2>&1; then
    say "migrate deploy failed (is the DB up? pnpm infra:up). Then: pnpm db:deploy"
  fi

  # Leaving a branch that had migrations this one lacks: deploy can't roll back.
  if git diff --name-only --diff-filter=D "$OLD" "$NEW" -- apps/api/prisma/migrations | grep -q .; then
    say "note: this branch lacks migrations the DB already has. If things look off: pnpm db:reset"
  fi
fi
exit 0
