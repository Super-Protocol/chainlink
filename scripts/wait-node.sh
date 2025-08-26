#!/usr/bin/env bash
set -euo pipefail

# Waits for Chainlink node API to be ready
# Configurable via env:
#   WAIT_API_URL   - full URL to health endpoint (default: http://127.0.0.1:6688/health)
#   WAIT_API_TRIES - number of seconds/attempts to wait (default: 300)

WAIT_API_URL="${WAIT_API_URL:-http://127.0.0.1:6688/health}"
WAIT_API_TRIES="${WAIT_API_TRIES:-300}"

log() { echo "[wait-node] $*"; }

tries=0
while [ "$tries" -lt "$WAIT_API_TRIES" ]; do
  if curl -sS "$WAIT_API_URL" >/dev/null 2>&1; then
    log "API is healthy at ${WAIT_API_URL}"
    exit 0
  fi
  tries=$((tries+1))
  sleep 1
done

log "API not healthy after ${WAIT_API_TRIES}s at ${WAIT_API_URL}" >&2
exit 1
