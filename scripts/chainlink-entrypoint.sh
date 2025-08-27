#!/usr/bin/env bash
set -euo pipefail

SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
CL_SHARED_DIR="$SP_SECRETS_DIR/cl-secrets"
log() { echo "[entrypoint] $*"; }

node_number() { echo "${NODE_NUMBER:-${HOSTNAME##*-}}"; }

wait_for_node_payload() {
  local n="$1"; local d="$CL_SHARED_DIR/$n"; local tries=0; local max_tries="${WAIT_SHARED_TRIES:-600}"
  while [ "$tries" -lt "$max_tries" ]; do
    if [ -s "$d/evm_key.json" ] && [ -s "$d/p2p_key.json" ] && [ -s "$d/ocr_key.json" ] && [ -s "$d/config.toml" ]; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

# Node 1 generates shared payload for all nodes; others wait and copy
n=$(node_number)
if [ "$n" = "1" ]; then
  log "running /scripts/generate-secrets.sh for all nodes (TOTAL_NODES=${TOTAL_NODES:-5})"
  TOTAL_NODES="${TOTAL_NODES:-5}" bash /scripts/generate-secrets.sh || log "generate-secrets failed (continuing)"
else
  log "skip generate-secrets: node=$n or script missing"
fi

# Ensure Chainlink node stays PID 1. If present, run publisher in background.
# Bootstrap nodes write their P2P details to shared secrets for workers
if [ -x "/scripts/init-chainlink.sh" ]; then
  /scripts/init-chainlink.sh || true
fi

if [ -f "/chainlink/apicredentials" ]; then
  chmod 600 /chainlink/apicredentials || true
  export CL_ADMIN_CREDENTIALS_FILE="/chainlink/apicredentials"
fi

nohup bash -c "
  if [ -x "/scripts/wait-node.sh" ]; then
    /scripts/wait-node.sh
  fi
  if [ -x \"/scripts/import-keys.sh\" ]; then
    /scripts/import-keys.sh
  fi
  if [ -x \"/scripts/publish-jobs.sh\" ]; then
    /scripts/publish-jobs.sh
  fi
" >/proc/1/fd/1 2>/proc/1/fd/2 &

cd /chainlink || exit 1
exec chainlink node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start -a /chainlink/apicredentials
