#!/usr/bin/env bash
set -euo pipefail

# Logger should be defined before any usage
log() { echo "[entrypoint] $*"; }

# Helpers for auxiliary process management
is_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

kill_if_alive() {
  local pid="$1"
  if is_pid_alive "$pid"; then
    kill "$pid" || true
  fi
}

shutdown_all() {
  kill_if_alive "${PUBLISH_JOBS_PID:-}"
}

# Required environment
if [ -z "${TOTAL_NODES:-}" ]; then
  log "TOTAL_NODES env var is required" >&2
  exit 1
fi
if [ -z "${NODE_NUMBER:-}" ]; then
  log "NODE_NUMBER env var is required" >&2
  exit 1
fi

if [ -z "${PRICE_AGGREGATOR_PORT:-}" ]; then
  log "PRICE_AGGREGATOR_PORT env var is required" >&2
  exit 1
fi

# Wait for price-aggregator readiness
wait_for_price_aggregator() {
  local tries=0; local max_tries="${WAIT_PRICE_AGGREGATOR_TRIES:-300}"; local url="http://127.0.0.1:${PRICE_AGGREGATOR_PORT}/"
  while [ "$tries" -lt "$max_tries" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

log "waiting for price-aggregator at http://127.0.0.1:${PRICE_AGGREGATOR_PORT}/ ..."
if ! wait_for_price_aggregator; then
  log "price-aggregator did not become ready in time"
  exit 1
fi

ROOT_DIR="${CHAINLINK_ROOT:-/chainlink}/node-${NODE_NUMBER}"
SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
CL_SHARED_DIR="$SP_SECRETS_DIR/cl-secrets"
TMP_DIR="/tmp/node-${NODE_NUMBER}"
PUBLISH_JOBS_PID=

mkdir -p "$TMP_DIR"

wait_for_node_payload() {
  local n="$1"; local d="$CL_SHARED_DIR/$n"; local tries=0; local max_tries="${WAIT_SHARED_TRIES:-600}"
  while [ "$tries" -lt "$max_tries" ]; do
    if [ -s "$d/evm_key.json" ] && [ -s "$d/p2p_key.json" ] && [ -s "$d/ocr_key.json" ]; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

# Wait until /chainlink/config.toml exists and is non-empty
wait_for_config_file() {
  local tries=0; local max_tries="${WAIT_CONFIG_TRIES:-600}"
  while [ "$tries" -lt "$max_tries" ]; do
    if [ -s "${NODE_ROOT_DIR}/config.toml" ]; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

# First bootstrap node in BOOTSTRAP_NODES generates shared payload for all nodes
bs_nodes_str="${BOOTSTRAP_NODES:-1}"
IFS=' ' read -r -a bs_nodes <<< "$bs_nodes_str"
leader="${bs_nodes[0]:-1}"
if [ "$NODE_NUMBER" = "$leader" ]; then
  log "running /scripts/bash/generate-secrets.sh for all nodes (leader=${leader}, TOTAL_NODES=${TOTAL_NODES:-5})"
  TOTAL_NODES="${TOTAL_NODES:-5}" bash /scripts/bash/generate-secrets.sh || log "generate-secrets failed (continuing)"
  # After secrets are generated, publish peerId and IP for all bootstrap nodes
  for b in "${bs_nodes[@]}"; do
    # Write IP
    if [ "${ALL_IN_ONE:-}" = "true" ]; then
      host="127.0.0.1"
    else
      host="10.5.0.$((8 + b))"
    fi
    printf '%s\n' "$host" > "${SP_SECRETS_DIR}/bootstrap-${b}.ip"
    # Write peerId from generated p2p_key.json
    p2p_json="${CL_SHARED_DIR}/${b}/p2p_key.json"
    if [ -s "$p2p_json" ]; then
      pid=$(jq -r '(.peerID // .peerId // .peerId // empty)' "$p2p_json" 2>/dev/null || true)
      if [ -n "$pid" ]; then printf '%s\n' "$pid" > "${SP_SECRETS_DIR}/bootstrap-${b}.peerid"; fi
    fi
  done
else
  log "skip generate-secrets: node=$NODE_NUMBER, leader=$leader"
fi

# Workers: wait until ALL bootstrap nodes are ready (API /readyz responds)
is_bootstrap=false
for b in "${bs_nodes[@]}"; do
  if [ "$NODE_NUMBER" = "$b" ]; then is_bootstrap=true; break; fi
done

if [ "$is_bootstrap" = "false" ]; then
  BASE_API_PORT="${BASE_API_PORT:-6600}"
  old_api_port="${API_PORT:-}"
  for b in "${bs_nodes[@]}"; do
    export API_PORT=$((BASE_API_PORT + b))
    log "waiting for bootstrap node ${b} (API_PORT=${API_PORT}) to become ready..."
    /scripts/bash/wait-node.sh || true
  done
  # restore API_PORT for this node if it was set
  if [ -n "${old_api_port}" ]; then export API_PORT="${old_api_port}"; fi
fi

# Ensure Chainlink node stays PID 1. If present, run publisher in background.
# Bootstrap nodes write their P2P details to shared secrets for workers
FIRST_START="false"
if [ -x "/scripts/bash/init-chainlink.sh" ]; then
  if [ ! -f "${ROOT_DIR}/first_start_done" ]; then
    /scripts/bash/init-chainlink.sh || true
    touch "${ROOT_DIR}/first_start_done" || true
    FIRST_START="true"
  fi
fi

# Ensure /chainlink/config.toml is present before starting Chainlink
if ! wait_for_config_file; then
  log "config.toml not found after initial wait; rerunning init and waiting"
  if ! wait_for_config_file; then
    log "config.toml still not present; blocking until it appears"
    while [ ! -s "${NODE_ROOT_DIR}/config.toml" ]; do sleep 1; done
  fi
fi

if [ -f "${NODE_ROOT_DIR}/apicredentials" ]; then
  chmod 600 "${NODE_ROOT_DIR}/apicredentials" || true
  export CL_ADMIN_CREDENTIALS_FILE="${NODE_ROOT_DIR}/apicredentials"
fi

wait_for_node_payload $NODE_NUMBER

bash -c '
  export JOB_RENDERS_DIR="'"${JOB_RENDERS_DIR:-/tmp/node-${NODE_NUMBER}/job-renders}"'"
  /scripts/bash/wait-node.sh
  node /scripts/secrets/balance-top-up.js
  if [ "'"${FIRST_START}"'" = "'"true"'" ]; then
    /scripts/bash/import-keys.sh
    # Signal supervisor to restart chainlink after first import
    touch "'"${TMP_DIR}"'"/restart-chainlink || true
    sleep 5
    /scripts/bash/wait-node.sh
  else
    /scripts/bash/publish-jobs.sh
  fi

  if [ "'"${NODE_NUMBER}"'" = "'"${leader}"'" ]; then
    node /scripts/secrets/register-admin.js
    /scripts/bash/set-config-for-all-feeds.sh
  fi
' 2>&1 &
PUBLISH_JOBS_PID=$!

log "Changing working directory to ${ROOT_DIR} for node ${NODE_NUMBER}"
cd "$ROOT_DIR" || exit 1

trap 'shutdown_all' INT TERM QUIT HUP EXIT

log "Executing chainlink node for node ${NODE_NUMBER} from within ${ROOT_DIR}"
cat "${NODE_ROOT_DIR}/config.toml"
exec chainlink node -config "${NODE_ROOT_DIR}/config.toml" -secrets "${ROOT_DIR}/secrets.toml" start -a "${ROOT_DIR}/apicredentials"
