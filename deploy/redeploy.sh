#!/usr/bin/env bash
# redeploy.sh — make the CURRENTLY COMMITTED source actually go live.
#
# WHY THIS EXISTS: the server runs from `server/dist/` (compiled output), and
# `dist/` is .gitignored. The systemd unit's ExecStart is `node dist/index.js`,
# so a plain `systemctl --user restart cowork-mcp` re-launches the SAME stale
# build — pushing to `main` changes nothing until someone rebuilds. This has
# repeatedly made shipped fixes look "not working" on the live host (e.g. the
# codex --skip-git-repo-check fix and the brain rate-limit meters). Run this
# after pulling to close that gap in one step:
#
#   git pull && deploy/redeploy.sh
#
# It rebuilds (tsc) and restarts the service. Safe to run repeatedly; if the
# build fails it stops BEFORE restarting, so the running server is never
# replaced by a broken build.
#
# Usage:
#   deploy/redeploy.sh              # npm run build, then restart systemd user service
#   deploy/redeploy.sh --no-restart # rebuild only (e.g. foreground/manual launch)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$REPO/server"
SERVICE="${COWORK_SERVICE:-cowork-mcp}"
RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0

command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not found on PATH (need Node >= 20)"; exit 1; }

echo "Building $SERVER (tsc)…"
( cd "$SERVER" && npm run build )
echo "Build OK → $SERVER/dist"

if [ "$RESTART" = "0" ]; then
  echo "Skipping restart (--no-restart). Relaunch your foreground process to pick up the new build."
  exit 0
fi

if command -v systemctl >/dev/null 2>&1 && systemctl --user status "$SERVICE" >/dev/null 2>&1; then
  echo "Restarting systemd user service: $SERVICE"
  systemctl --user restart "$SERVICE"
  sleep 2
  systemctl --user --no-pager --lines=5 status "$SERVICE" || true
  echo "Redeploy complete — live server now runs the committed source."
else
  echo "systemd user service '$SERVICE' not found."
  echo "Rebuild is done; restart your server process manually to go live"
  echo "(or set COWORK_SERVICE=<name> if the unit has a different name)."
fi
