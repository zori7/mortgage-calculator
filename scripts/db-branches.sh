#!/usr/bin/env bash
# Lists or prunes the per-branch databases in this slot's Postgres (host only).
#
#   scripts/db-branches.sh          # list: database, branch, status
#   scripts/db-branches.sh prune    # drop databases whose branch no longer exists
#
# Never touches `mortgage` (main) or the database of the current branch.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "no .env — run scripts/dev-env.sh first" >&2; exit 1; }
SLOT="$(sed -n 's/^SLOT=//p' .env)"
psql() { docker compose -p "mt-s$SLOT" -f infra/compose.yml exec -T postgres psql -U postgres -tAc "$1"; }

# "db<TAB>branch" for every local branch (no associative arrays: macOS ships bash 3.2)
owners="$(git for-each-ref --format='%(refname:short)' refs/heads | while read -r b; do
  printf '%s\t%s\n' "$(bash scripts/db-name.sh "$b")" "$b"; done)"
current="$(sed -nE 's|^DATABASE_URL=.*/([^/?]+).*|\1|p' .env)"

mode="${1:-list}"
gone=()
printf "%-40s %-30s %s\n" DATABASE BRANCH STATUS
while read -r db; do
  [[ -z "$db" ]] && continue
  b="$(printf '%s\n' "$owners" | awk -F'\t' -v d="$db" '$1==d {print $2; exit}')"
  if [[ -n "$b" ]]; then status=active; else status="branch gone"; gone+=("$db"); fi
  [[ "$db" == "$current" ]] && status="$status (current)"
  printf "%-40s %-30s %s\n" "$db" "${b:--}" "$status"
done < <(psql "select datname from pg_database where datname like 'mortgage%' order by 1")

if [[ "$mode" == "prune" ]]; then
  for db in "${gone[@]}"; do
    [[ "$db" == "mortgage" || "$db" == "$current" ]] && continue
    psql "DROP DATABASE \"$db\" WITH (FORCE)" >/dev/null && echo "dropped $db"
  done
  (( ${#gone[@]} )) || echo "nothing to prune"
fi
