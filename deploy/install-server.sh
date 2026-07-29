#!/usr/bin/env bash
# install-server.sh — one-shot bootstrap for the Cowork MCP server:
# init the agent-roster submodule, install deps, build, and launch (systemd user
# service by default, or foreground). Generates a systemd unit with THIS machine's
# real paths, so there's nothing to hand-edit.
#
# Usage:
#   deploy/install-server.sh                 # build + install & start systemd user service
#   deploy/install-server.sh --foreground    # build + run in this terminal (no service)
#   deploy/install-server.sh --build-only    # init submodule, install deps, build; don't launch
#   deploy/install-server.sh --no-build      # (with a launch mode) skip install/build, just launch
#
# Prereqs: Node.js >= 20 and npm on PATH. Config lives at ~/.cowork/config.json
# (the server seeds it from the tracked template on first run; edit it, not the template).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$REPO/server"
MODE="systemd"       # systemd | foreground | build-only
BUILD=1

while [ $# -gt 0 ]; do
  case "$1" in
    --foreground|--fg) MODE="foreground"; shift ;;
    --build-only)      MODE="build-only"; shift ;;
    --systemd)         MODE="systemd"; shift ;;
    --no-build)        BUILD=0; shift ;;
    -h|--help)         sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- prereqs -----------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH (need Node >= 20)"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm not found on PATH"; exit 1; }
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node $NODE_MAJOR detected; Cowork needs Node >= 20." >&2; exit 1
fi
echo "node: $NODE_BIN ($(node -v))"

# --- agency-agents submodule (the 285-agent roster) --------------------------
if [ ! -e "$REPO/agency-agents/.git" ] && [ -z "$(ls -A "$REPO/agency-agents" 2>/dev/null || true)" ]; then
  echo "Initializing agency-agents submodule…"
  git -C "$REPO" submodule update --init
fi

# --- build -------------------------------------------------------------------
if [ "$BUILD" = 1 ]; then
  echo "Installing server dependencies…"
  ( cd "$SERVER" && npm install )
  echo "Building (tsc)…"
  ( cd "$SERVER" && npm run build )
fi

if [ "$MODE" = "build-only" ]; then
  echo "Build complete. Launch with:  deploy/install-server.sh --foreground   (or omit for systemd)"
  exit 0
fi

# --- foreground --------------------------------------------------------------
if [ "$MODE" = "foreground" ]; then
  echo "Starting server in foreground (Ctrl-C to stop)…"
  exec node "$SERVER/dist/index.js"
fi

# --- systemd user service ----------------------------------------------------
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/cowork-mcp.service"
NODE_PATH_DIR="$(dirname "$NODE_BIN")"
mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<EOF
[Unit]
Description=Multi-Agent Cowork MCP Server (dashboard + task inbox)
After=network.target

[Service]
Type=simple
Environment=PATH=$NODE_PATH_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
WorkingDirectory=$SERVER
ExecStart=$NODE_BIN dist/index.js
Restart=always
RestartSec=5
TimeoutStopSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cowork-mcp

[Install]
WantedBy=default.target
EOF
echo "Wrote $UNIT"

systemctl --user daemon-reload
systemctl --user enable --now cowork-mcp.service
sleep 1
systemctl --user --no-pager --lines=0 status cowork-mcp.service || true

PORT="$(node -e 'try{const c=require(process.env.HOME+"/.cowork/config.json");console.log(c.server&&c.server.port||6868)}catch{console.log(6868)}')"
echo
echo "Cowork MCP server started."
echo "  Dashboard : http://localhost:$PORT/"
echo "  MCP       : http://localhost:$PORT/mcp"
echo "  Logs      : journalctl --user -u cowork-mcp -f"
echo "  Restart   : systemctl --user restart cowork-mcp"
echo
echo "Next: install the coordination skill into your agent clients →  deploy/install-skill.sh"
