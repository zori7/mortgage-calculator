#!/usr/bin/env bash
# OpenHands runs this at the start of each session in the sandbox.
#
# The sandbox has no Docker, so Postgres/Redis run on the HOST, one stack per
# slot. Before starting the session, on the host:
#   scripts/dev-env.sh <slot> && pnpm infra:up
# and pass the same slot to the sandbox as env var SLOT (default 1).
set -euo pipefail

corepack enable >/dev/null 2>&1 || npm i -g pnpm
DB_HOST=host.docker.internal bash scripts/dev-env.sh "${SLOT:-1}"
pnpm install --frozen-lockfile
pnpm db:migrate
