#!/usr/bin/env bash
# Runs the agent factory as macOS background services (launchd): they start when
# you log in, restart if they crash, and need no open terminal.
#
#   bash ops/launchd/install.sh      # install or update, and (re)start      (pnpm services:install)
#   bash ops/launchd/uninstall.sh    # stop and remove                        (pnpm services:uninstall)
#   pnpm services:status | pnpm services:logs
#   MT_LAUNCHD_DRY=<dir> bash ops/launchd/install.sh   # only write + lint the plists into <dir>
#
# Services:
#   dev.mortgage-tracker.provisioner   ops/provisioner/server.mjs   (port 7070)
#   dev.mortgage-tracker.openhands     OpenHands Agent Canvas       (port 8000), wrapped in
#                                      `caffeinate -i` so the Mac doesn't idle-sleep while it runs
#   dev.mortgage-tracker.gc            pnpm sandbox:gc --apply, every hour
#
# Docker Desktop must be running too: enable its "Start when you sign in" setting.
# Don't also run `pnpm factory` / `pnpm prov` / `pnpm oh` while these are loaded:
# they would fight over the same ports.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DRY="${MT_LAUNCHD_DRY:-}"
AGENTS="${DRY:-$HOME/Library/LaunchAgents}"
LOGS="$HOME/Library/Logs/mortgage-tracker"
OPENHANDS_VERSION="1.35.0"
mkdir -p "$AGENTS" "$LOGS"

NODE="$(command -v node)" || { echo "node not found in PATH" >&2; exit 1; }
dirs=("$(dirname "$NODE")")
for tool in pnpm docker git curl gh; do
  p="$(command -v "$tool" || true)"; [[ -n "$p" ]] && dirs+=("$(dirname "$p")")
done
dirs+=("$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin)
SVC_PATH="$(printf '%s\n' "${dirs[@]}" | awk '!seen[$0]++' | paste -sd: -)"

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# write_plist <label> <keepalive true|false> <interval seconds or ""> <arg>...
write_plist() {
  local label="$1" keep="$2" interval="$3"; shift 3
  local file="$AGENTS/$label.plist" args=""
  for a in "$@"; do args+="    <string>$(printf '%s' "$a" | xml)</string>"$'\n'; done
  cat > "$file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>WorkingDirectory</key><string>$(printf '%s' "$REPO" | xml)</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(printf '%s' "$SVC_PATH" | xml)</string>
    <key>HOME</key><string>$(printf '%s' "$HOME" | xml)</string>
  </dict>
  <key>StandardOutPath</key><string>$LOGS/${label##*.}.log</string>
  <key>StandardErrorPath</key><string>$LOGS/${label##*.}.log</string>
  <key>RunAtLoad</key><true/>
$( [[ "$keep" == true ]] && printf '  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>10</integer>\n' )
$( [[ -n "$interval" ]] && printf '  <key>StartInterval</key><integer>%s</integer>\n' "$interval" )
</dict>
</plist>
EOF
  plutil -lint "$file" >/dev/null
  if [[ -n "$DRY" ]]; then echo "✔ $file (lint ok, not loaded)"; return; fi
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$file"
  echo "✔ $label"
}

write_plist dev.mortgage-tracker.provisioner true "" \
  "$NODE" "$REPO/ops/provisioner/server.mjs"
write_plist dev.mortgage-tracker.openhands true "" \
  /usr/bin/caffeinate -i /usr/bin/env OH_CONVERSATION_RUNTIME=docker \
  "$(dirname "$NODE")/npx" -y "@openhands/agent-canvas@$OPENHANDS_VERSION"
write_plist dev.mortgage-tracker.gc false 3600 \
  "$NODE" "$REPO/ops/gc.mjs" --apply

echo "logs: $LOGS   (pnpm services:logs)"
