#!/usr/bin/env bash

cd $(dirname $0)

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

determine_node_number() {
  if [[ -n "${NODE_NUMBER:-}" ]]; then
    echo "${NODE_NUMBER}"
    return
  fi
  # Extract trailing digits from hostname (e.g., chainlink-node-3 -> 3)
  echo "${HOSTNAME}" | grep -oE '[0-9]+$' || echo "1"
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
  mkdir -p "${SHARED_SECRETS_DIR}"
  local node_num
  node_num=$(determine_node_number)
  log "node number = ${node_num}"
  ensure_credentials "${node_num}"

  # Remove any stale per-node shared config to avoid confusion
  local stale_shared_cfg="${SHARED_SECRETS_DIR}/cl-secrets/${node_num}/config.toml"
  if [[ -f "$stale_shared_cfg" ]]; then
    rm -f "$stale_shared_cfg" || true
    log "removed stale shared config ${stale_shared_cfg}"
  fi

  # Always (re)generate /chainlink/config.toml from template using current shared secrets
  local cfg="${CHAINLINK_DIR}/config.toml"
  rm -f "$cfg" || true
  local tpl="/scripts/config.toml.template"
  if [[ -s "$tpl" ]]; then
    # Compute DefaultBootstrappers from shared bootstrap secrets if available
    local bootstrap_nodes_str="${BOOTSTRAP_NODES:-1}"
    local IFS=' \t,'; read -r -a bs_nodes <<< "$bootstrap_nodes_str"
    local is_bootstrap=false; local bn; local entries=()
    for bn in "${bs_nodes[@]}"; do if [[ "$bn" == "${node_num}" ]]; then is_bootstrap=true; fi; done

    # Determine if this node is primary
    local primary_nodes_str="${PRIMARY_NODES:-}"
    local IFS=' \t,'; read -r -a pr_nodes <<< "$primary_nodes_str"
    local is_primary=false; local pn
    for pn in "${pr_nodes[@]:-}"; do if [[ "$pn" == "${node_num}" ]]; then is_primary=true; fi; done
    if [[ "$is_bootstrap" == false ]]; then
      if [[ -n "${BOOTSTRAP_NODE_ADDRESSES:-}" ]]; then
        # Build from BOOTSTRAP_NODE_ADDRESSES (host:port[,host:port]) zipped with peer IDs
        local peer_ids=()
        for bn in "${bs_nodes[@]}"; do
          local fpeer="${SHARED_SECRETS_DIR}/bootstrap-${bn}.peerid"
          if [[ -s "$fpeer" ]]; then
            local pid; pid=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
            [[ -n "$pid" ]] && peer_ids+=("$pid")
          fi
        done
        IFS=',' read -r -a addrs <<< "${BOOTSTRAP_NODE_ADDRESSES}"
        local n=${#addrs[@]}; local m=${#peer_ids[@]}; local limit=$(( n < m ? n : m ))
        for ((i=0; i<limit; i++)); do
          local a="${addrs[$i]}"; a=$(echo "$a" | xargs)
          [[ -z "$a" ]] && continue
          local host="${a%%:*}"; local port="${a##*:}"
          [[ -z "$port" || "$port" == "$host" ]] && port="9999"
          local pid="${peer_ids[$i]}"
          if [[ -n "$host" && -n "$pid" ]]; then
            entries+=("'${pid}@${host}:${port}'")
          fi
        done
      else
        for bn in "${bs_nodes[@]}"; do
          local fpeer="${SHARED_SECRETS_DIR}/bootstrap-${bn}.peerid"; local fip="${SHARED_SECRETS_DIR}/bootstrap-${bn}.ip"
          local peer=""; local ip="10.5.0.$((8 + bn))"
          # local peer=""; local ip="chainlink-node-${bn}"
          [[ -s "$fpeer" ]] && peer=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
          [[ -s "$fip" ]] && ip=$(sed -n '1p' "$fip")
          if [[ -n "$peer" ]]; then entries+=("'${peer}@${ip}:9999'"); fi
        done
      fi
    fi
    local DEFAULT_BOOTSTRAPERS OCR_KEY_BUNDLE_ID TRANSMITTER_ADDRESS
    if [[ ${#entries[@]} -eq 0 ]]; then DEFAULT_BOOTSTRAPERS="[]"; else DEFAULT_BOOTSTRAPERS="[${entries[*]}]"; fi
    local CHAINLINK_CHAIN_ID="${CHAINLINK_CHAIN_ID:-5611}"
    local CHAINLINK_NODE_NAME="${CHAINLINK_NODE_NAME:-primary}"
    local CHAINLINK_RPC_WS_URL="${CHAINLINK_RPC_WS_URL:-}"
    local CHAINLINK_RPC_HTTP_URL="${CHAINLINK_RPC_HTTP_URL:-}"
    # Try to read OCR key id to populate OCR.KeyBundleID
    local ocr_file="${SHARED_SECRETS_DIR}/cl-secrets/${node_num}/ocr_key.json"
    if [[ -s "$ocr_file" ]]; then
      OCR_KEY_BUNDLE_ID=$(jq -r '.id // empty' "$ocr_file" 2>/dev/null || true)
    fi
    # TransmitterAddress from EVM key (EIP55 enforced via ethers)
    local evm_file="${SHARED_SECRETS_DIR}/cl-secrets/${node_num}/evm_key.json"
    if [[ -s "$evm_file" ]]; then
      local addr_raw; addr_raw=$(jq -r '.address // empty' "$evm_file" 2>/dev/null || true)
      if [[ -n "$addr_raw" ]]; then
        # Compute EIP55 using helper script
        local addr_cs
        addr_cs=$(./eth-address-formatter.sh "${addr_raw}" 2>/dev/null || true)
        if [[ -n "$addr_cs" ]]; then
          TRANSMITTER_ADDRESS="$addr_cs"
        else
          TRANSMITTER_ADDRESS=""
        fi
      fi
    fi
    export DEFAULT_BOOTSTRAPERS CHAINLINK_CHAIN_ID CHAINLINK_NODE_NAME CHAINLINK_RPC_WS_URL CHAINLINK_RPC_HTTP_URL OCR_KEY_BUNDLE_ID TRANSMITTER_ADDRESS
    envsubst < "$tpl" > "$cfg"
    chmod 600 "$cfg" || true
    # Post-process Name for primary vs sendonly nodes
    if [[ "$is_primary" == true ]]; then
      sed -i'' -E "s#^([[:space:]]*Name\s*=\s*)'.*'#\1'${CHAINLINK_NODE_NAME}-${node_num}-primary'#" "$cfg" || true
    else
      sed -i'' -E "s#^([[:space:]]*Name\s*=\s*)'.*'#\1'${CHAINLINK_NODE_NAME}-${node_num}-sendonly'#" "$cfg" || true
    fi
    # Post-process EVM.Nodes according to PRIMARY_NODES policy
    if [[ "$is_primary" == true ]]; then
      # Ensure SendOnly = false
      sed -i'' -E "s#^\s*SendOnly\s*=.*#SendOnly = false#" "$cfg" || true
      # WSURL line remains from template
    else
      # Remove WSURL and set SendOnly = true
      sed -i'' -E "/^\s*WSURL\s*=/d" "$cfg" || true
      if grep -qE '^\s*SendOnly\s*=' "$cfg"; then
        sed -i'' -E "s#^\s*SendOnly\s*=.*#SendOnly = true#" "$cfg" || true
      else
        # Insert SendOnly under [[EVM.Nodes]] if missing
        awk '
          BEGIN{in=0}
          /^\s*\[\[EVM\.Nodes\]\]\s*$/ {print; print "SendOnly = true"; in=1; next}
          {print}
        ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
      fi
    fi
    log "rendered config.toml from template"
  else
    log "no template found; proceeding without config.toml"
  fi

  ensure_admin_creds_in_config

  # Set AnnounceAddresses based on docker-compose static IP scheme
  local ip="10.5.0.$((8 + node_num))"
  # local ip="chainlink-node-$node_num"
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
  fi
}

main "$@"
