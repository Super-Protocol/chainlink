#!/usr/bin/env bash
set -euo pipefail

CHAINLINK_DIR="/chainlink"

log() { echo "[init] $*"; }

# In-container sed -i helper (GNU sed)
sed_inplace() {
  sed -i -e "$1" "$2"
}

http_port_for_node() {
  # Internal container port for Chainlink HTTP API
  echo 6688
}

ip_for_node() {
  local n="$1"; echo "10.5.0.$((8 + n))";
}

login_and_get_cookie() {
  local host="$1"; local port="$2"; local cookie_file="$3";
  local email password
  email=$(sed -n '1p' "${CHAINLINK_DIR}/apicredentials" 2>/dev/null || echo "")
  password=$(sed -n '2p' "${CHAINLINK_DIR}/apicredentials" 2>/dev/null || echo "")
  [[ -n "$email" && -n "$password" ]] || return 1
  curl -sS -X POST "http://${host}:${port}/sessions" \
    -H 'Content-Type: application/json' -c "$cookie_file" \
    --data "{\"email\":\"${email}\",\"password\":\"${password}\"}" >/dev/null || true
  grep -q 'clsession' "$cookie_file" 2>/dev/null
}

fetch_peer_id() {
  local host="$1"; local port="$2"; local cookie_file="$3";
  local raw
  raw=$(curl -sS -X GET "http://${host}:${port}/v2/keys/p2p" -b "$cookie_file" || true)
  # Try to extract attributes.peerId (strip p2p_), else id (strip p2p_)
  printf '%s' "$raw" | sed -n 's/.*"peerId"\s*:\s*"\([^"]*\)".*/\1/p' | sed 's/^p2p_//' | head -n1 && return 0
  printf '%s' "$raw" | sed -n 's/.*"id"\s*:\s*"\(p2p_[^"]*\)".*/\1/p' | head -n1 | sed 's/^p2p_//' && return 0
  return 1
}

wait_for_health() {
  local host="$1"; local port="$2"; local tries=0; local max_tries="${WAIT_BOOTSTRAP_TRIES:-120}"
  while [ "$tries" -lt "$max_tries" ]; do
    if curl -sS "http://${host}:${port}/health" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries+1)); sleep 1
  done
  return 1
}

wait_for_bootstrap_nodes() {
  local node_num="$1"
  local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
  for bn in "${bs_nodes[@]}"; do
    # skip self
    if [[ "$bn" == "$node_num" ]]; then continue; fi
    local host; host=$(ip_for_node "$bn")
    local port; port=$(http_port_for_node "$bn")
    log "waiting for bootstrap node ${bn} at ${host}:${port}"
    if ! wait_for_health "$host" "$port"; then
      log "bootstrap node ${bn} ${host}:${port} not healthy in time; proceeding with current config"
    fi
  done
}

# Wait until bootstrap nodes expose a P2P peerId via /v2/keys/p2p
wait_for_bootstrap_peer_ids() {
  local node_num="$1"
  local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
  local max_tries="${WAIT_BOOTSTRAP_PEER_TRIES:-180}"
  for bn in "${bs_nodes[@]}"; do
    # skip self
    if [[ "$bn" == "$node_num" ]]; then continue; fi
    local host; host=$(ip_for_node "$bn")
    local port; port=$(http_port_for_node "$bn")
    local tries=0
    while [ "$tries" -lt "$max_tries" ]; do
      local cookie; cookie=$(mktemp)
      if login_and_get_cookie "$host" "$port" "$cookie"; then
        local peer; peer=$(fetch_peer_id "$host" "$port" "$cookie" || true)
        rm -f "$cookie" || true
        if [[ -n "$peer" ]]; then
          log "bootstrap node ${bn} peerId available: ${peer}"
          break
        fi
      else
        rm -f "$cookie" || true
      fi
      tries=$((tries+1)); sleep 1
      if [ "$tries" -eq "$max_tries" ]; then
        log "bootstrap node ${bn} ${host}:${port} peerId not available in time; proceeding"
      fi
    done
  done
}

set_default_bootstrappers() {
  local node_num="$1"; local cfg="${CHAINLINK_DIR}/config.toml";
  [[ -f "$cfg" ]] || return 0
  local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
  # Parse list into array
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
  if [[ ${#bs_nodes[@]} -eq 0 ]]; then return 0; fi

  # Helper: check if current node is in bootstrap set
  local is_bootstrap=false
  for bn in "${bs_nodes[@]}"; do
    if [[ "$bn" == "$1" ]]; then is_bootstrap=true; break; fi
  done

  # Build entries peer@ip:9999 by polling each bootstrap node API
  local entries=()
  for bn in "${bs_nodes[@]}"; do
    local host; host=$(ip_for_node "$bn"); local port; port=$(http_port_for_node "$bn"); local cookie; cookie=$(mktemp)
    if login_and_get_cookie "$host" "$port" "$cookie"; then
      local peer; peer=$(fetch_peer_id "$host" "$port" "$cookie")
      if [[ -n "$peer" ]]; then
        entries+=("${peer}@${host}:9999")
      fi
    fi
    rm -f "$cookie" || true
  done

  if $is_bootstrap; then
    # For any bootstrap node, ensure empty DefaultBootstrappers
    local list_str="[]"
    if grep -qE '^\s*DefaultBootstrappers\s*=' "$cfg"; then
      sed_inplace "s#^\\s*DefaultBootstrappers\\s*=.*#DefaultBootstrappers = ${list_str}#" "$cfg"
    else
      awk -v val="${list_str}" '
        BEGIN{inblock=0}
        /^\s*\[P2P\.V2\]\s*$/ {print; print "DefaultBootstrappers = " val; inblock=1; next}
        {print}
      ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
    fi
    log "set DefaultBootstrappers = [] (bootstrap node)"
  else
    if [[ ${#entries[@]} -gt 0 ]]; then
      # Build proper TOML array
      local list_str="["$(printf "'%s'," "${entries[@]}" | sed 's/,$//')"]"
      if grep -qE '^\s*DefaultBootstrappers\s*=' "$cfg"; then
        sed_inplace "s#^\\s*DefaultBootstrappers\\s*=.*#DefaultBootstrappers = ${list_str}#" "$cfg"
      else
        awk -v val="${list_str}" '
          BEGIN{inblock=0}
          /^\s*\[P2P\.V2\]\s*$/ {print; print "DefaultBootstrappers = " val; inblock=1; next}
          {print}
        ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
      fi
      log "set DefaultBootstrappers = ${list_str}"
    else
      log "keep existing DefaultBootstrappers (live peer IDs unavailable)"
    fi
  fi
}

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
        echo "${CHAINLINK_PASSWORD}"
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

  # Set AnnounceAddresses based on docker-compose static IP scheme
  local ip="10.5.0.$((8 + node_num))"
  local cfg="${CHAINLINK_DIR}/config.toml"
  if [[ -f "$cfg" ]]; then
    if grep -qE '^\s*AnnounceAddresses\s*=' "$cfg"; then
      sed_inplace "s#^\\s*AnnounceAddresses\\s*=.*#AnnounceAddresses = ['${ip}:9999']#" "$cfg"
    else
      awk -v ipval="${ip}:9999" '
        BEGIN{inblock=0}
        /^\s*\[P2P\.V2\]\s*$/ {print; print "AnnounceAddresses = ['"ipval"']"; inblock=1; next}
        {print}
      ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
    fi
    log "set AnnounceAddresses = ['${ip}:9999']"
  fi

  # Set DefaultBootstrappers dynamically (requires bootstrap nodes to be up)
  wait_for_bootstrap_nodes "${node_num}"
  # Additionally wait for bootstrap peerIds so we can populate entries
  wait_for_bootstrap_peer_ids "${node_num}"
  set_default_bootstrappers "${node_num}"
}

main "$@"


