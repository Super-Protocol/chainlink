#!/usr/bin/env bash

cd $(dirname $0)

set -euo pipefail

log() { echo "[init] $*"; }

ROOT_DIR="${CHAINLINK_ROOT:-/chainlink}"

if [ -z "${NODE_NUMBER:-}" ]; then
  log "NODE_NUMBER env var is required" >&2
  exit 1
fi

if [ -z "${BOOTSTRAP_NODES:-}" ]; then
  log "BOOTSTRAP_NODES env var is required" >&2
  exit 1
fi

if [ -z "${SP_SECRETS_DIR:-}" ]; then
  log "SP_SECRETS_DIR env var is required" >&2
  exit 1
fi

NODE_ROOT_DIR="${CHAINLINK_ROOT:-/chainlink}/node-${NODE_NUMBER}"

# In-container sed -i helper (GNU sed)
sed_inplace() {
  sed -i -e "$1" "$2"
}

# Wait until bootstrap nodes expose a P2P peerId via /v2/keys/p2p
wait_for_bootstrap_peer_ids() {
  local node_num="$1"
  local IFS=' '; read -r -a bs_nodes <<< "$BOOTSTRAP_NODES"
  local max_tries="${WAIT_BOOTSTRAP_PEER_TRIES:-300}"
  mkdir -p "$SP_SECRETS_DIR"
  for bn in "${bs_nodes[@]}"; do
    if [[ "$bn" == "$node_num" ]]; then continue; fi
    local fpeer="$SP_SECRETS_DIR/bootstrap-${bn}.peerid"
    local fip="$SP_SECRETS_DIR/bootstrap-${bn}.ip"
    local tries=0
    log "waiting for shared secrets of bootstrap node ${bn} in ${SP_SECRETS_DIR}"
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

ensure_credentials() {
  if [[ -f "${NODE_ROOT_DIR}/apicredentials" ]]; then
    log "apicredentials exists; leaving as is"
  else
    if [[ -z "${CHAINLINK_EMAIL:-}" || -z "${CHAINLINK_PASSWORD:-}" ]]; then
      log "CHAINLINK_EMAIL/CHAINLINK_PASSWORD not set; skip apicredentials generation"
    else
      {
        echo "${CHAINLINK_EMAIL}"
        echo "${CHAINLINK_PASSWORD}"
      } > "${NODE_ROOT_DIR}/apicredentials"
      chmod 600 "${NODE_ROOT_DIR}/apicredentials"
      log "generated apicredentials"
    fi
  fi
}

main() {
  mkdir -p "${SP_SECRETS_DIR}"
  log "node number = ${NODE_NUMBER}"
  ensure_credentials

  # Remove any stale per-node shared config to avoid confusion
  local stale_shared_cfg="${NODE_ROOT_DIR}/config.toml"
  if [[ -f "$stale_shared_cfg" ]]; then
    rm -f "$stale_shared_cfg" || true
    log "removed stale shared config ${stale_shared_cfg}"
  fi

  # Always (re)generate /chainlink/config.toml from template using current shared secrets
  local cfg="${NODE_ROOT_DIR}/config.toml"
  rm -f "$cfg" || true
  local tpl="/scripts/bash/config.toml.template"
  if [[ -s "$tpl" ]]; then
    # Compute DefaultBootstrappers from shared bootstrap secrets if available
    local IFS=' '; read -r -a bs_nodes <<< "$BOOTSTRAP_NODES"
    local is_bootstrap=false; local bn; local entries=()
    for bn in "${bs_nodes[@]}"; do if [[ "$bn" == "${NODE_NUMBER}" ]]; then is_bootstrap=true; break; fi; done

    # Determine if this node is primary
    local primary_nodes_str="${PRIMARY_NODES:-${NODES_LIST:-}}"
    local IFS=' '; read -r -a pr_nodes <<< "$primary_nodes_str"
    local is_primary=false; local pn
    for pn in "${pr_nodes[@]:-}"; do if [[ "$pn" == "${NODE_NUMBER}" ]]; then is_primary=true; break; fi; done
    if [[ "$is_bootstrap" == false ]]; then
      if [[ -n "${BOOTSTRAP_NODE_ADDRESSES:-}" ]]; then
        # Build from BOOTSTRAP_NODE_ADDRESSES (host:port[,host:port]) zipped with peer IDs
        local peer_ids=()
        for bn in "${bs_nodes[@]}"; do
          local fpeer="${SP_SECRETS_DIR}/bootstrap-${bn}.peerid"
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
          if [[ "${ALL_IN_ONE:-}" == "true" ]]; then
            local host="127.0.0.1"; local port_base="${BOOTSTRAP_P2P_PORT_BASE:-9901}"
            local port=$((port_base + i))
          else
            local host="${a%%:*}"; local port="${a##*:}"
            [[ -z "$port" || "$port" == "$host" ]] && port="9999"
          fi
          local pid="${peer_ids[$i]}"
          if [[ -n "$host" && -n "$pid" ]]; then
            entries+=("'${pid}@${host}:${port}'")
          fi
        done
      fi
    fi
    local DEFAULT_BOOTSTRAPPERS OCR_KEY_BUNDLE_ID TRANSMITTER_ADDRESS
    if [[ ${#entries[@]} -eq 0 ]]; then DEFAULT_BOOTSTRAPPERS="[]"; else DEFAULT_BOOTSTRAPPERS="[${entries[*]}]"; fi
    # Try to read OCR key id to populate OCR.KeyBundleID
    local ocr_file="${SP_SECRETS_DIR}/cl-secrets/${NODE_NUMBER}/ocr_key.json"
    if [[ -s "$ocr_file" ]]; then
      OCR_KEY_BUNDLE_ID=$(jq -r '.id // empty' "$ocr_file" 2>/dev/null || true)
    fi
    # TransmitterAddress from EVM key (EIP55 enforced via ethers)
    local evm_file="${SP_SECRETS_DIR}/cl-secrets/${NODE_NUMBER}/evm_key.json"
    if [[ -s "$evm_file" ]]; then
      local addr_raw; addr_raw=$(jq -r '.address // empty' "$evm_file" 2>/dev/null || true)
      if [[ -n "$addr_raw" ]]; then
        # Compute EIP55 using helper script
        local addr_cs
        addr_cs=$(./eth-address-formatter.sh "${addr_raw}" 2>/dev/null || true)
        if [[ -n "$addr_cs" ]]; then
          TRANSMITTER_ADDRESS="$addr_cs"
        else
          log "failed to compute the transmitter's address" >&2
          exit 1
        fi
      fi
    fi

    # Build AnnounceAddresses TOML array
    local p2p_port="${P2P_PORT:-9999}"
    local ANNOUNCE_ADDRESSES_STR=""
    if [[ -n "${ANNOUNCE_ADDRESSES:-}" ]]; then
      ANNOUNCE_ADDRESSES_STR="${ANNOUNCE_ADDRESSES}"
    elif [[ -n "${ANNOUNCE_NODE_ADDRESSES:-}" ]]; then
      IFS=',' read -r -a ann_addrs <<< "${ANNOUNCE_NODE_ADDRESSES}"
      local items=()
      for a in "${ann_addrs[@]}"; do
        a=$(echo "$a" | xargs)
        [[ -z "$a" ]] && continue
        items+=("'${a}'")
      done
      if [[ ${#items[@]} -eq 0 ]]; then
        if [[ "${ALL_IN_ONE:-}" == "true" ]]; then
          local ip="127.0.0.1:${p2p_port}"
        else
          local ip="10.5.0.$((8 + NODE_NUMBER)):${p2p_port}"
        fi
        ANNOUNCE_ADDRESSES_STR="['${ip}']"
      else
        ANNOUNCE_ADDRESSES_STR="[${items[*]}]"
      fi
    else
      if [[ "${ALL_IN_ONE:-}" == "true" ]]; then
        local ip="127.0.0.1:${p2p_port}"
      else
        local ip="10.5.0.$((8 + NODE_NUMBER)):${p2p_port}"
      fi
      ANNOUNCE_ADDRESSES_STR="['${ip}']"
    fi

    export DEFAULT_BOOTSTRAPPERS OCR_KEY_BUNDLE_ID TRANSMITTER_ADDRESS ANNOUNCE_ADDRESSES="${ANNOUNCE_ADDRESSES_STR}"
    envsubst < "$tpl" > "$cfg"
    chmod 600 "$cfg" || true
    # Post-process Name for primary vs sendonly nodes
    if [[ "$is_primary" == true ]]; then
      sed -i'' -E "s#^([[:space:]]*Name[[:space:]]*=[[:space:]]*)'.*'#\1'${CHAINLINK_NODE_NAME}-${NODE_NUMBER}-primary'#" "$cfg" || true
    else
      sed -i'' -E "s#^([[:space:]]*Name[[:space:]]*=[[:space:]]*)'.*'#\1'${CHAINLINK_NODE_NAME}-${NODE_NUMBER}-sendonly'#" "$cfg" || true
    fi
    # Post-process EVM.Nodes according to PRIMARY_NODES policy
    if [[ "$is_primary" == true ]]; then
      # Ensure SendOnly = false
      sed -i'' -E "s#^[[:space:]]*SendOnly[[:space:]]*=.*#SendOnly = false#" "$cfg" || true
      # WSURL line remains from template
    else
      # Remove WSURL and set SendOnly = true
      sed -i'' -E "/^[[:space:]]*WSURL[[:space:]]*=/d" "$cfg" || true
      if grep -qE '^[[:space:]]*SendOnly[[:space:]]*=' "$cfg"; then
        sed -i'' -E "s#^[[:space:]]*SendOnly[[:space:]]*=.*#SendOnly = true#" "$cfg" || true
      else
        # Insert SendOnly under [[EVM.Nodes]] if missing
        awk '
          BEGIN{in=0}
          /^[[:space:]]*\[\[EVM\.Nodes\]\][[:space:]]*$/ {print; print "SendOnly = true"; in=1; next}
          {print}
        ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
      fi
    fi
    log "rendered config.toml from template"
  else
    log "no template found; proceeding without config.toml"
  fi

  # Set AnnounceAddresses based on docker-compose static IP scheme
  if [[ "${ALL_IN_ONE:-}" == "true" ]]; then
    local ip="127.0.0.1"
  else
    local ip="10.5.0.$((8 + NODE_NUMBER))"
  fi
  local p2p_port="${P2P_PORT:-9999}"
  # local ip="chainlink-node-$NODE_NUMBER"
  local cfg="${NODE_ROOT_DIR}/config.toml"
  if [[ -f "$cfg" ]]; then
    if grep -qE '^[[:space:]]*AnnounceAddresses[[:space:]]*=' "$cfg"; then
      sed_inplace "s#^[[:space:]]*AnnounceAddresses[[:space:]]*=.*#AnnounceAddresses = ['${ip}:${p2p_port}']#" "$cfg"
    else
      awk -v ipval="${ip}:${p2p_port}" '
        BEGIN{inblock=0}
        /^[[:space:]]*\[P2P\.V2\][[:space:]]*$/ {print; print "AnnounceAddresses = ['"ipval"']"; inblock=1; next}
        {print}
      ' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
    fi
    log "set AnnounceAddresses = ['${ip}:${p2p_port}']"
  fi

  # Produce or consume shared secrets
  local IFS=' '; read -r -a bs_nodes <<< "$BOOTSTRAP_NODES"
  local is_bootstrap=false
  for bn in "${bs_nodes[@]}"; do if [[ "$bn" == "${NODE_NUMBER}" ]]; then is_bootstrap=true; fi; done

  if [[ "$is_bootstrap" == true ]]; then
    # Defer writing bootstrap peer secrets to post-start scripts (import-keys/publish-jobs)
    :
  else
    # Workers wait for bootstrap secrets and set DefaultBootstrappers
    wait_for_bootstrap_peer_ids "${NODE_NUMBER}"
  fi
}

main "$@"
