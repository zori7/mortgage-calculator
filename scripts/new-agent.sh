#!/usr/bin/env bash
# Creates an isolated workspace for one agent: git worktree + .env + own
# Postgres/Redis + migrated and seeded DB.
#
#   pnpm agent:new <branch> <slot 1-9>
#   e.g. pnpm agent:new task-03-yearly-summary 3
#
# Result: ../mortgage-tracker-<branch>/ ready for `pnpm dev`.
set -euo pipefail

BRANCH="${1:?usage: pnpm agent:new <branch> <slot 1-9>}"
SLOT="${2:?usage: pnpm agent:new <branch> <slot 1-9>}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(dirname "$ROOT")/$(basename "$ROOT")-$BRANCH"

git -C "$ROOT" worktree add "$DIR" -b "$BRANCH"
cd "$DIR"

bash scripts/dev-env.sh "$SLOT"
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed

echo
echo "ready: $DIR"
echo "  cd $DIR && pnpm dev"
