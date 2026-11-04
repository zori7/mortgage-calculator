#!/usr/bin/env bash
# Tears down an agent workspace: its containers + volumes, then the worktree.
# The branch is kept so you can still review/merge it.
#
#   pnpm agent:rm <branch>
set -euo pipefail

BRANCH="${1:?usage: pnpm agent:rm <branch>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(dirname "$ROOT")/$(basename "$ROOT")-$BRANCH"

[[ -d "$DIR" ]] || { echo "no worktree at $DIR" >&2; exit 1; }

if [[ -f "$DIR/.env" ]]; then
  docker compose -f "$DIR/infra/compose.yml" --env-file "$DIR/.env" down -v || true
fi
git -C "$ROOT" worktree remove --force "$DIR"
echo "removed $DIR (branch $BRANCH kept)"
