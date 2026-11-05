#!/usr/bin/env bash
# Stops and removes the background services installed by ops/launchd/install.sh.
set -uo pipefail
for label in dev.mortgage-tracker.provisioner dev.mortgage-tracker.openhands dev.mortgage-tracker.gc; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null && echo "stopped $label"
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
# OpenHands' own supervisor can outlive its parent; make sure nothing keeps the ports.
pkill -f '@openhands/agent-canvas' 2>/dev/null || true
echo "removed (logs kept in ~/Library/Logs/mortgage-tracker)"
