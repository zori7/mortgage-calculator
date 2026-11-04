#!/usr/bin/env bash
# One-shot setup for a checkout whose Postgres/Redis are already running
# (pnpm infra:up, or scripts/task-new.sh for agents). Works the same on your Mac
# and inside an OpenHands sandbox:
#
#   bash scripts/setup.sh
#
# Installs the pinned Node (.node-version) and pnpm (package.json#packageManager)
# if missing, writes .env, installs deps, migrates and seeds.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_MAJOR="$(cut -d. -f1 .node-version)"
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]' 2>/dev/null || sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' package.json)"

# --- Node -------------------------------------------------------------------
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  echo "installing Node $NODE_MAJOR..."
  ARCH="$(uname -m)"; [[ "$ARCH" == "x86_64" ]] && ARCH=x64; [[ "$ARCH" == "aarch64" ]] && ARCH=arm64
  OS="$(uname -s | tr 'A-Z' 'a-z')"
  VER="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" | grep -oE "node-v[0-9.]+-${OS}-${ARCH}\.tar\.gz" | head -1)"
  mkdir -p "$HOME/.local/node"
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$VER" | tar -xz -C "$HOME/.local/node" --strip-components=1
  export PATH="$HOME/.local/node/bin:$PATH"
  grep -qs '.local/node/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> "$HOME/.bashrc"
fi

# --- pnpm -------------------------------------------------------------------
if ! command -v pnpm >/dev/null || [[ "$(pnpm -v)" != "$PNPM_VERSION" ]]; then
  echo "installing pnpm $PNPM_VERSION..."
  npm install -g "pnpm@$PNPM_VERSION" >/dev/null
fi

# --- app --------------------------------------------------------------------
bash scripts/dev-env.sh
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm db:seed

echo
echo "setup done. node $(node -v), pnpm $(pnpm -v). Next: pnpm check / pnpm dev"
