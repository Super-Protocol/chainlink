#!/usr/bin/env bash
set -euo pipefail

# Waits for Chainlink node API to be ready, then for health checks to be passing
# Configurable via env:
#   API_PORT            - API port (default: 6688)
#   WAIT_API_URL        - readiness URL (default: http://127.0.0.1:{API_PORT}/readyz)
#   WAIT_API_TRIES      - number of seconds/attempts to wait for readiness (default: 300)
#   WAIT_HEALTH_URL     - health URL returning checks (default: http://127.0.0.1:{API_PORT}/health)
#   WAIT_HEALTH_TRIES   - number of seconds/attempts to wait for health passing (default: 300)

API_PORT="${API_PORT:-6688}"
WAIT_API_URL="${WAIT_API_URL:-http://127.0.0.1:${API_PORT}/readyz}"
WAIT_API_TRIES="${WAIT_API_TRIES:-300}"
WAIT_HEALTH_URL="${WAIT_HEALTH_URL:-http://127.0.0.1:${API_PORT}/health}"
WAIT_HEALTH_TRIES="${WAIT_HEALTH_TRIES:-300}"

log() { echo "[wait-node] $*"; }

# Phase 1: readiness
tries=0
while [ "$tries" -lt "$WAIT_API_TRIES" ]; do
  if curl -sS "$WAIT_API_URL" >/dev/null 2>&1; then
    log "API is ready at ${WAIT_API_URL}"
    break
  fi
  tries=$((tries+1))
  sleep 1
done
if [ "$tries" -ge "$WAIT_API_TRIES" ]; then
  log "API not ready after ${WAIT_API_TRIES}s at ${WAIT_API_URL}" >&2
  exit 1
fi

# Phase 2: health checks passing
tries=0
while [ "$tries" -lt "$WAIT_HEALTH_TRIES" ]; do
  resp=$(curl -sS "$WAIT_HEALTH_URL" || true)
  statuses=$(printf "%s" "$resp" | jq -r '.data[]? .attributes.status' 2>/dev/null || true)
  if [ -n "${statuses}" ]; then
    all_passing=true
    while IFS= read -r s; do
      [ -z "$s" ] && continue
      if [ "$s" != "passing" ]; then
        all_passing=false
        break
      fi
    done <<EOF
${statuses}
EOF
    if $all_passing; then
      log "health: all checks passing at ${WAIT_HEALTH_URL}"
      exit 0
    fi
  fi
  tries=$((tries+1))
  sleep 1
done

log "health not passing after ${WAIT_HEALTH_TRIES}s at ${WAIT_HEALTH_URL}" >&2
exit 1
