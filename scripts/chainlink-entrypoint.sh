#!/usr/bin/env bash
set -euo pipefail

# Logger should be defined before any usage
log() { echo "[entrypoint] $*"; }

# Required environment
if [ -z "${TOTAL_NODES:-}" ]; then
  log "TOTAL_NODES env var is required" >&2
  exit 1
fi
if [ -z "${NODE_NUMBER:-}" ]; then
  log "NODE_NUMBER env var is required" >&2
  exit 1
fi

SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
CL_SHARED_DIR="$SP_SECRETS_DIR/cl-secrets"

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
    if [ -s "/chainlink/config.toml" ]; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

# First bootstrap node in BOOTSTRAP_NODES generates shared payload for all nodes
bs_nodes_str="${BOOTSTRAP_NODES:-1}"
IFS=' \t,' read -r -a bs_nodes <<< "$bs_nodes_str"
leader="${bs_nodes[0]:-1}"
if [ "$NODE_NUMBER" = "$leader" ]; then
  log "running /scripts/generate-secrets.sh for all nodes (leader=${leader}, TOTAL_NODES=${TOTAL_NODES:-5})"
  TOTAL_NODES="${TOTAL_NODES:-5}" bash /scripts/generate-secrets.sh || log "generate-secrets failed (continuing)"
else
  log "skip generate-secrets: node=$NODE_NUMBER, leader=$leader"
fi

# Ensure Chainlink node stays PID 1. If present, run publisher in background.
# Bootstrap nodes write their P2P details to shared secrets for workers
FIRST_START="false"
if [ -x "/scripts/init-chainlink.sh" ]; then
  if [ ! -f "/tmp/first_start_done" ]; then
    /scripts/init-chainlink.sh || true
    touch /tmp/first_start_done || true
    FIRST_START="true"
  fi
fi

# Ensure /chainlink/config.toml is present before starting Chainlink
if ! wait_for_config_file; then
  log "config.toml not found after initial wait; rerunning init and waiting"
  /scripts/init-chainlink.sh || true
  if ! wait_for_config_file; then
    log "config.toml still not present; blocking until it appears"
    while [ ! -s "/chainlink/config.toml" ]; do sleep 1; done
  fi
fi

if [ -f "/chainlink/apicredentials" ]; then
  chmod 600 /chainlink/apicredentials || true
  export CL_ADMIN_CREDENTIALS_FILE="/chainlink/apicredentials"
fi

wait_for_node_payload $NODE_NUMBER

nohup bash -c "
  /scripts/wait-node.sh
  if [ \"${FIRST_START}\" = \"true\" ]; then
    /scripts/import-keys.sh
    # Signal supervisor to restart chainlink after first import
    touch /tmp/restart-chainlink || true
    sleep 1
    /scripts/wait-node.sh
  fi
  /scripts/publish-jobs.sh
" >/proc/1/fd/1 2>/proc/1/fd/2 &

cd /chainlink || exit 1
exec chainlink node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start -a /chainlink/apicredentials
