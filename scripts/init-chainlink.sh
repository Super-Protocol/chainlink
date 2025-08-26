#!/usr/bin/env bash
set -euo pipefail

CHAINLINK_DIR="/chainlink"
SHARED_SECRETS_DIR="/sp/secrets"

log() { echo "[init] $*"; }

# In-container sed -i helper (GNU sed)
sed_inplace() {
  sed -i -e "$1" "$2"
}


# Wait until bootstrap nodes expose a P2P peerId via /v2/keys/p2p
wait_for_bootstrap_peer_ids() {
  local node_num="$1"
  local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
  local max_tries="${WAIT_BOOTSTRAP_PEER_TRIES:-300}"
  mkdir -p "$SHARED_SECRETS_DIR"
  for bn in "${bs_nodes[@]}"; do
    if [[ "$bn" == "$node_num" ]]; then continue; fi
    local fpeer="$SHARED_SECRETS_DIR/bootstrap-${bn}.peerid"
    local fip="$SHARED_SECRETS_DIR/bootstrap-${bn}.ip"
    local tries=0
    log "waiting for shared secrets of bootstrap node ${bn} in ${SHARED_SECRETS_DIR}"
    while [ "$tries" -lt "$max_tries" ]; do
      if [[ -s "$fpeer" && -s "$fip" ]]; then
        local peer; peer=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
        local ip; ip=$(sed -n '1p' "$fip")
        if [[ -n "$peer" && -n "$ip" ]]; then
          log "bootstrap node ${bn} peerId available: ${peer}"
          break
        fi
      fi
      tries=$((tries+1)); sleep 1
      if [ "$tries" -eq "$max_tries" ]; then
        log "shared secrets for bootstrap ${bn} not available in time; proceeding"
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

  # Build entries peer@ip:9999 by reading from shared secrets
  local entries=()
  for bn in "${bs_nodes[@]}"; do
    local fpeer="$SHARED_SECRETS_DIR/bootstrap-${bn}.peerid"
    local fip="$SHARED_SECRETS_DIR/bootstrap-${bn}.ip"
    if [[ -s "$fpeer" && -s "$fip" ]]; then
      local peer; peer=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
      local host; host=$(sed -n '1p' "$fip")
      entries+=("${peer}@${host}:9999")
    fi
  done

  if [[ "$is_bootstrap" == true ]]; then
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
  if [[ -z "${CHAINLINK_CHAIN_ID:-}" || -z "${CHAINLINK_RPC_HTTP_URL:-}" ]]; then
    log "CHAINLINK_CHAIN_ID/CHAINLINK_RPC_HTTP_URL not set; skip config generation"
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
HTTPURL = '${CHAINLINK_RPC_HTTP_URL}'
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
  mkdir -p "${SHARED_SECRETS_DIR}"
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

  # Produce or consume shared secrets
  local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
  local is_bootstrap=false
  for bn in "${bs_nodes[@]}"; do if [[ "$bn" == "${node_num}" ]]; then is_bootstrap=true; fi; done

  if [[ "$is_bootstrap" == true ]]; then
    # Defer writing bootstrap peer secrets to post-start scripts (import-keys/publish-jobs)
    :
  else
    # Workers wait for bootstrap secrets and set DefaultBootstrappers
    wait_for_bootstrap_peer_ids "${node_num}"
    set_default_bootstrappers "${node_num}"
  fi
}

main "$@"
