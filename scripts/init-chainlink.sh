#!/usr/bin/env bash
set -euo pipefail

CHAINLINK_DIR="/chainlink"

log() { echo "[init] $*"; }

determine_node_number() {
  if [[ -n "${NODE_NUMBER:-}" ]]; then
    echo "${NODE_NUMBER}"
    return
  fi
  # Extract trailing digits from hostname (e.g., chainlink-node-3 -> 3)
  echo "${HOSTNAME}" | grep -oE '[0-9]+$' || echo "1"
}

ensure_config() {
  local node_num="$1"
  if [[ -f "${CHAINLINK_DIR}/config.toml" ]]; then
    log "config.toml exists; leaving as is"
    return
  fi
  if [[ -z "${CHAINLINK_CHAIN_ID:-}" || -z "${CHAINLINK_HTTP_URL:-}" ]]; then
    log "CHAINLINK_CHAIN_ID/CHAINLINK_HTTP_URL not set; skip config generation"
    return
  fi
  cat > "${CHAINLINK_DIR}/config.toml" <<EOF
[Log]
Level = 'info'

[WebServer]
AllowOrigins = '*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[[EVM]]
ChainID = '${CHAINLINK_CHAIN_ID}'
LogBackfillBatchSize = 500

[[EVM.Nodes]]
Name = 'primary'
HTTPURL = '${CHAINLINK_HTTP_URL}'
EOF
  log "generated config.toml"
}

ensure_secrets() {
  local node_num="$1"
  if [[ -f "${CHAINLINK_DIR}/secrets.toml" ]]; then
    log "secrets.toml exists; leaving as is"
    return
  fi
  if [[ -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" || -z "${PGDATABASE:-}" ]]; then
    log "PGUSER/PGPASSWORD/PGDATABASE not set; skip secrets generation"
    return
  fi
  cat > "${CHAINLINK_DIR}/secrets.toml" <<EOF
[Password]
Keystore = '${CHAINLINK_KEYSTORE_PASSWORD:-changeme${node_num}}'
[Database]
URL = 'postgresql://${PGUSER}:${PGPASSWORD}@db:5432/${PGDATABASE}_${node_num}?sslmode=disable'
EOF
  chmod 600 "${CHAINLINK_DIR}/secrets.toml"
  log "generated secrets.toml"
}

ensure_credentials() {
  local node_num="$1"
  if [[ -f "${CHAINLINK_DIR}/apicredentials" ]]; then
    log "apicredentials exists; leaving as is"
  else
    if [[ -z "${CHAINLINK_EMAIL:-}" || -z "${CHAINLINK_PASSWORD:-}" ]]; then
      log "CHAINLINK_EMAIL/CHAINLINK_PASSWORD not set; skip apicredentials generation"
    else
      {
        echo "${CHAINLINK_EMAIL}"
        echo "${CHAINLINK_PASSWORD}${node_num}"
      } > "${CHAINLINK_DIR}/apicredentials"
      chmod 600 "${CHAINLINK_DIR}/apicredentials"
      log "generated apicredentials"
    fi
  fi
}

ensure_admin_creds_in_config() {
  # Remove unsupported key if present (Chainlink 2.26 does not accept it)
  if [[ -f "${CHAINLINK_DIR}/config.toml" ]]; then
    if grep -qE '^\s*WebServer\.AdminCredentialsFile\s*=\s*' "${CHAINLINK_DIR}/config.toml"; then
      sed -i'' -e '/^\s*WebServer\.AdminCredentialsFile\s*=.*/d' "${CHAINLINK_DIR}/config.toml" || true
      log "removed unsupported WebServer.AdminCredentialsFile from config.toml"
    fi
  fi
}

main() {
  mkdir -p "${CHAINLINK_DIR}/jobs"
  local node_num
  node_num=$(determine_node_number)
  log "node number = ${node_num}"
  ensure_config "${node_num}"
  ensure_secrets "${node_num}"
  ensure_credentials "${node_num}"
  ensure_admin_creds_in_config
}

main "$@"


