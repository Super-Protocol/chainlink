#!/usr/bin/env bash
set -euo pipefail

# 1. Setup and Variables
# ------------------------------------
log() { echo "[chainlink-starter] (Node ${NODE_NUMBER}) $*"; }

if [ -z "${NODE_NUMBER:-}" ]; then
  log "NODE_NUMBER env var is required" >&2
  exit 1
fi

# Each node must operate in its own root directory for isolation
NODE_ROOT_DIR="/chainlink/node_${NODE_NUMBER}"
mkdir -p "$NODE_ROOT_DIR"

# Shared secrets dir remains the same for all nodes
SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
CL_SHARED_DIR="$SP_SECRETS_DIR/cl-secrets"


# 2. Leader/Worker Synchronization
# ------------------------------------
LEADER_FLAG_FILE="/tmp/leader_ready"
bs_nodes_str="${BOOTSTRAP_NODES:-1}"
IFS=' ,' read -r -a bs_nodes <<< "$bs_nodes_str"
leader="${bs_nodes[0]:-1}"

if [ "$NODE_NUMBER" = "$leader" ]; then
  # As the leader, remove any stale flag from previous runs
  rm -f "$LEADER_FLAG_FILE"
  log "LEADER: running scripts to generate shared secrets and configs..."

  # Run one-time setup scripts for all nodes
  TOTAL_NODES="${TOTAL_NODES:-5}" bash /scripts/bash/generate-secrets.sh || log "generate-secrets failed (continuing)"
  node /scripts/secrets/register-admin.js
  /scripts/bash/set-config-for-all-feeds.sh

  # Create the flag file to signal that setup is complete
  touch "$LEADER_FLAG_FILE"
  log "LEADER: has finished setup. Signaling workers."
else
  log "WORKER: waiting for leader to finish setup..."
  # As a worker, wait until the leader creates the flag file
  local tries=0; local max_tries=300 # Wait for up to 5 minutes
  while [ ! -f "$LEADER_FLAG_FILE" ]; do
    if [ "$tries" -ge "$max_tries" ]; then
      log "FATAL: Timed out waiting for leader flag file at ${LEADER_FLAG_FILE}" >&2
      exit 1
    fi
    tries=$((tries+1)); sleep 1
  done
  log "WORKER: leader is ready, proceeding with init."
fi


# 3. Main boot sequence for EACH node
# (This section will now only run after the leader is finished)
# ------------------------------------
FIRST_START="false"
if [ -x "/scripts/bash/init-chainlink.sh" ]; then
  # The first_start flag must be unique for each node
  if [ ! -f "/tmp/first_start_done_${NODE_NUMBER}" ]; then
    log "Running one-time init-chainlink.sh"
    # Pass NODE_ROOT_DIR so the script knows where to place files for THIS node
    NODE_ROOT_DIR="$NODE_ROOT_DIR" /scripts/bash/init-chainlink.sh || true
    touch "/tmp/first_start_done_${NODE_NUMBER}" || true
    FIRST_START="true"
  fi
fi


# 4. Waiter functions and credentials setup
# ------------------------------------
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

if ! wait_for_config_file; then
  log "FATAL: config.toml not found in ${NODE_ROOT_DIR} after waiting." >&2
  exit 1
fi

API_CREDENTIALS_FILE="${NODE_ROOT_DIR}/apicredentials"
if [ -f "/chainlink/apicredentials" ]; then
  cp /chainlink/apicredentials "$API_CREDENTIALS_FILE"
  chmod 600 "$API_CREDENTIALS_FILE" || true
fi
export CL_ADMIN_CREDENTIALS_FILE="$API_CREDENTIALS_FILE"


# 5. Background process for key import and job publishing
# ------------------------------------
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
wait_for_node_payload $NODE_NUMBER

nohup bash -c "
  # Export necessary vars to the background process
  export NODE_NUMBER=\"${NODE_NUMBER}\"
  export NODE_ROOT_DIR=\"${NODE_ROOT_DIR}\"
  export CL_ADMIN_CREDENTIALS_FILE=\"${API_CREDENTIALS_FILE}\"
  export FIRST_START=\"${FIRST_START}\"

  /scripts/bash/wait-node.sh
  if [ \"\${FIRST_START}\" = \"true\" ]; then
    /scripts/bash/import-keys.sh
    sleep 5
    /scripts/bash/wait-node.sh
  fi
  /scripts/bash/publish-jobs.sh
" >/proc/1/fd/1 2>/proc/1/fd/2 &


# 6. FINAL CHAINLINK NODE EXECUTION
# ------------------------------------
log "Starting Chainlink node process..."
chainlink node start --root "$NODE_ROOT_DIR" &
