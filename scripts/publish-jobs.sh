#!/usr/bin/env bash
set -euo pipefail

have_jq() { command -v jq >/dev/null 2>&1; }

install_jq() {
  if have_jq; then return 0; fi
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache jq >/dev/null 2>&1 || true
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y jq >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y jq >/dev/null 2>&1 || true
  fi
  have_jq
}

ensure_jq() { have_jq || install_jq; }

json_escape() {
  # Escapes input for safe embedding as a JSON string
  sed -e 's/\\/\\\\/g' \
      -e 's/"/\\"/g' \
      -e 's/\t/\\t/g' \
      -e 's/\r/\\r/g' \
      -e 's/\n/\\n/g'
}

API_URL="http://127.0.0.1:6688"
JOBS_DIR="/chainlink/jobs"
TEMPLATES_DIR="${TEMPLATES_DIR:-/templates}"
TEMPLATE_FILE="${TEMPLATE_FILE:-${TEMPLATES_DIR}/btc-usd.toml}"
COOKIE_FILE="/tmp/cl_cookie"
SHARED_SECRETS_DIR="/sp/secrets"
EVM_EXPORT_PASSWORD="${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}"
OCR_EXPORT_PASSWORD="${OCR_EXPORT_PASSWORD:-${EVM_EXPORT_PASSWORD}}"

# Compose IP helper
ip_for_node() {
  local n="$1"; echo "10.5.0.$((8 + n))";
}

# Read local credentials
read_creds() {
  local email password
  email=$(sed -n '1p' /chainlink/apicredentials 2>/dev/null || echo "")
  password=$(sed -n '2p' /chainlink/apicredentials 2>/dev/null || echo "")
  printf '%s|%s' "$email" "$password"
}

# Prefer reading bootstrap info from shared secrets written by bootstrap nodes
bootstrap_info_from_shared_secrets() {
  local bs_env="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bs_env"
  [[ ${#bs_nodes[@]} -gt 0 ]] || { echo "|"; return; }
  local first_bs="${bs_nodes[0]}"
  local fpeer="$SHARED_SECRETS_DIR/bootstrap-${first_bs}.peerid"
  local fip="$SHARED_SECRETS_DIR/bootstrap-${first_bs}.ip"
  if [[ -s "$fpeer" && -s "$fip" ]]; then
    local peer ip
    peer=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
    ip=$(sed -n '1p' "$fip")
    echo "${peer}|${ip}"
  else
    echo "|"
  fi
}

# Login to remote node and fetch its p2p peer id
fetch_bootstrap_peer_from_env() {
  local bs_env="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bs_env"
  [[ ${#bs_nodes[@]} -gt 0 ]] || { echo "|"; return; }
  local first_bs="${bs_nodes[0]}"
  local host; host=$(ip_for_node "$first_bs")
  local port=6688
  local cookie_file="/tmp/cl_cookie_bootstrap"
  rm -f "$cookie_file" || true
  IFS='|' read -r email password < <(read_creds)
  if [[ -z "$email" || -z "$password" ]]; then echo "|"; return; fi
  local http_code peer_id tries=0 max_tries=${WAIT_BOOTSTRAP_PEER_TRIES:-180}
  while [ $tries -lt $max_tries ]; do
    http_code=$(curl -sS -o /tmp/login_bs.json -w '%{http_code}' \
      -X POST "http://${host}:${port}/sessions" \
      -H 'Content-Type: application/json' \
      -c "$cookie_file" \
      --data "{\"email\":\"${email}\",\"password\":\"${password}\"}")
    if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
      if have_jq; then
        peer_id=$(curl -sS -X GET "http://${host}:${port}/v2/keys/p2p" -b "$cookie_file" | jq -r '.data[0] | (.attributes.peerId // .peerId // .id // empty) | sub("^p2p_";"")')
      else
        peer_id=$(curl -sS -X GET "http://${host}:${port}/v2/keys/p2p" -b "$cookie_file" | sed -n 's/.*"peerId"\s*:\s*"\([^"]*\)".*/\1/p' | sed 's/^p2p_//' | head -n1)
        [[ -z "$peer_id" ]] && peer_id=$(curl -sS -X GET "http://${host}:${port}/v2/keys/p2p" -b "$cookie_file" | sed -n 's/.*"id"\s*:\s*"\(p2p_[^"]*\)".*/\1/p' | head -n1 | sed 's/^p2p_//')
      fi
      if [[ -n "$peer_id" ]]; then break; fi
    fi
    tries=$((tries+1)); sleep 1
  done
  rm -f "$cookie_file" || true
  echo "${peer_id}|${host}"
}

# Determine node number and role
determine_node_number() {
  if [[ -n "${NODE_NUMBER:-}" ]]; then
    echo "${NODE_NUMBER}"
    return
  fi
  echo "${HOSTNAME}" | grep -oE '[0-9]+$' || echo "1"
}

is_node_bootstrap() {
  local node_num="$1"
  local bstr="${BOOTSTRAP_NODES:-1}"
  local IFS=' \t,'; read -r -a bs_nodes <<< "$bstr"
  for bn in "${bs_nodes[@]}"; do
    if [[ "$bn" == "$node_num" ]]; then
      echo true; return
    fi
  done
  echo false
}

# Parse first bootstrap entry from config.toml DefaultBootstrappers and convert to multiaddr
bootstrap_peers_multiaddr_from_config() {
  local cfg="/chainlink/config.toml"
  [[ -f "$cfg" ]] || { echo "[]"; return; }
  local entry
  entry=$(awk '
    /^\s*\[P2P\.V2\]\s*$/ {inblock=1; next}
    inblock && /^\s*\[/ {inblock=0}
    inblock && /DefaultBootstrappers/ {print; exit}
  ' "$cfg")
  local peer ip
  peer=$(printf '%s\n' "$entry" | sed -n "s/.*'\([^'@]*\)@.*/\1/p")
  if [[ -z "$peer" ]]; then peer=$(printf '%s\n' "$entry" | sed -n 's/.*"\([^"@]*\)@.*/\1/p'); fi
  ip=$(printf '%s\n' "$entry" | sed -n "s/.*@\([^:'\"]*\):.*/\1/p")
  if [[ -n "$peer" && -n "$ip" ]]; then
    echo "[\"/ip4/${ip}/tcp/9999/p2p/${peer}\"]"
  else
    echo "[]"
  fi
}

# Extract EVM ChainID from config.toml
chain_id_from_config() {
  local cfg="/chainlink/config.toml"
  [[ -f "$cfg" ]] || { echo ""; return; }
  awk -F"'" '/^\s*\[\[EVM\]\]/{f=1} f && /ChainID/{print $2; exit}' "$cfg" || true
}

email=$(sed -n '1p' /chainlink/apicredentials 2>/dev/null || echo "")
password=$(sed -n '2p' /chainlink/apicredentials 2>/dev/null || echo "")

wait_for_api() {
  for i in {1..120}; do
    if curl -sS "${API_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

login() {
  [[ -n "$email" && -n "$password" ]] || return 1
  local tries=0
  while [ $tries -lt 5 ]; do
    curl -sS -X POST "${API_URL}/sessions" \
      -H 'Content-Type: application/json' \
      -c "${COOKIE_FILE}" \
      --data "{\"email\":\"${email}\",\"password\":\"${password}\"}" >/dev/null || true
    if grep -q 'clsession' "${COOKIE_FILE}" 2>/dev/null; then
      return 0
    fi
    tries=$((tries+1))
    sleep 1
  done
  return 1
}

csrf() {
  local token
  token=$(curl -sSI -X GET "${API_URL}/v2/csrf" -b "${COOKIE_FILE}" | awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="x-csrf-token" {gsub(/\r/,"",$2); print $2}')
  if [ -n "$token" ]; then echo "$token"; return 0; fi
  # Fallback to JSON body
  if have_jq; then
    token=$(curl -sS -X GET "${API_URL}/v2/csrf" -b "${COOKIE_FILE}" | jq -r '.data.csrfToken // .token // empty')
  else
    token=$(curl -sS -X GET "${API_URL}/v2/csrf" -b "${COOKIE_FILE}" | sed -n 's/.*\"csrfToken\"\s*:\s*\"\([^\"]*\)\".*/\1/p')
  fi
  echo "$token"
}

publish_jobs() {
  [[ -d "${JOBS_DIR}" ]] || mkdir -p "${JOBS_DIR}"

  # Render a job from template into JOBS_DIR
  local node_num is_bootstrap bootstrap_peers evm_chain_id rendered_file tmpfile
  node_num=$(determine_node_number)
  is_bootstrap=$(is_node_bootstrap "$node_num")
  # Prefer discovering bootstrap peer via API of the first bootstrap node from env
  IFS='|' read -r bs_peer bs_ip < <(bootstrap_info_from_shared_secrets)
  if [[ -z "$bs_peer" || -z "$bs_ip" ]]; then
    IFS='|' read -r bs_peer bs_ip < <(fetch_bootstrap_peer_from_env)
  fi
  if [[ -n "$bs_peer" && -n "$bs_ip" ]]; then
    bootstrap_peers="[\"/ip4/${bs_ip}/tcp/9999/p2p/${bs_peer}\"]"
  else
    bootstrap_peers=$(bootstrap_peers_multiaddr_from_config)
  fi
  evm_chain_id=$(chain_id_from_config)
  rendered_file="${JOBS_DIR}/btc-usd.node-${node_num}.toml"

  if [[ -f "${TEMPLATE_FILE}" ]]; then
    cp "${TEMPLATE_FILE}" "${rendered_file}"
  fi

  # Ensure critical fields exist in the rendered file even before key discovery
  if [[ -f "${rendered_file}" ]]; then
    # p2pBootstrapPeers
    if [[ -n "$bootstrap_peers" ]]; then
      if grep -qE '^\s*p2pBootstrapPeers\s*=' "${rendered_file}"; then
        sed -i'' -E "s#^\s*p2pBootstrapPeers\s*=.*#p2pBootstrapPeers = ${bootstrap_peers}#" "${rendered_file}"
      else
        printf '\n%s\n' "p2pBootstrapPeers = ${bootstrap_peers}" >> "${rendered_file}"
      fi
    fi
    # isBootstrapPeer
    if grep -qE '^\s*isBootstrapPeer\s*=' "${rendered_file}"; then
      if [[ "$is_bootstrap" == "true" ]]; then
        sed -i'' -E "s#^\s*isBootstrapPeer\s*=.*#isBootstrapPeer = true#" "${rendered_file}"
      else
        sed -i'' -E "s#^\s*isBootstrapPeer\s*=.*#isBootstrapPeer = false#" "${rendered_file}"
      fi
    else
      printf '\n%s\n' "isBootstrapPeer = ${is_bootstrap}" >> "${rendered_file}"
    fi
    # evmChainID
    if [[ -n "$evm_chain_id" ]]; then
      if grep -qE '^\s*evmChainID\s*=' "${rendered_file}"; then
        sed -i'' -E "s#^\s*evmChainID\s*=\s*\".*\"#evmChainID = \"${evm_chain_id}\"#" "${rendered_file}" || true
      else
        printf '\n%s\n' "evmChainID = \"${evm_chain_id}\"" >> "${rendered_file}"
      fi
    fi
  fi
  local token
  token=$(csrf || true)

  # If there is a persisted EVM private key, try to import it before ensuring keys
  DID_IMPORT=false
  IMPORTED_ADDR=""
  if [[ -f "/chainlink/evm_key.json" ]]; then
    if [[ -n "${evm_chain_id}" ]]; then
      imp_code=$(curl -sS -o /tmp/evm_import.json -w '%{http_code}' \
        -X POST "${API_URL}/v2/keys/evm/import?oldpassword=${EVM_EXPORT_PASSWORD}&evmChainID=${evm_chain_id}" \
        -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
        -b "${COOKIE_FILE}" \
        --data-binary @/chainlink/evm_key.json || true)
      echo "[publish] EVM key import http=${imp_code} (200/201 OK; 409 already exists)" >&2
      if [[ "${imp_code}" == "200" || "${imp_code}" == "201" ]]; then
        # Try to read imported address from import response
        if have_jq; then
          IMPORTED_ADDR=$(jq -r '.data.attributes.address // .data.address // .attributes.address // .address // empty' /tmp/evm_import.json)
        else
          IMPORTED_ADDR=$(sed -n 's/.*"address"\s*:\s*"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' /tmp/evm_import.json | head -n1)
        fi
        DID_IMPORT=true
      elif [[ "${imp_code}" == "409" ]]; then
        # Already imported previously; attempt to extract address from file
        if have_jq; then
          IMPORTED_ADDR=$(jq -r '.address // .data.attributes.address // .attributes.address // empty' /chainlink/evm_key.json)
        else
          IMPORTED_ADDR=$(sed -n 's/.*\(0x[0-9a-fA-F]\{40\}\).*/\1/p' /chainlink/evm_key.json | head -n1)
        fi
        DID_IMPORT=true
      fi
    else
      echo "[publish] Skipping EVM key import: evm_chain_id is empty" >&2
    fi
  fi

  # If there is a persisted OCR key, try to import it before ensuring keys
  DID_IMPORT_OCR=false
  IMPORTED_OCR_ID=""
  if [[ -f "/chainlink/ocr_key.json" ]]; then
    imp_ocr_code=$(curl -sS -o /tmp/ocr_import.json -w '%{http_code}' \
      -X POST "${API_URL}/v2/keys/ocr/import?oldpassword=${OCR_EXPORT_PASSWORD}" \
      -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
      -b "${COOKIE_FILE}" \
      --data-binary @/chainlink/ocr_key.json || true)
    echo "[publish] OCR key import http=${imp_ocr_code} (200/201 OK; 409 already exists)" >&2
    if [[ "${imp_ocr_code}" == "200" || "${imp_ocr_code}" == "201" ]]; then
      if ensure_jq; then
        IMPORTED_OCR_ID=$(jq -r '.data.id // .data.attributes.id // .id // empty' /tmp/ocr_import.json)
      else
        IMPORTED_OCR_ID=$(sed -n 's/.*"id"\s*:\s*"\([0-9a-fA-F]\{64\}\)".*/\1/p' /tmp/ocr_import.json | head -n1)
      fi
      DID_IMPORT_OCR=true
    elif [[ "${imp_ocr_code}" == "409" ]]; then
      if ensure_jq; then
        IMPORTED_OCR_ID=$(jq -r '.id // .data.id // .data.attributes.id // empty' /chainlink/ocr_key.json)
      else
        IMPORTED_OCR_ID=$(sed -n 's/.*"id"\s*:\s*"\([0-9a-fA-F]\{64\}\)".*/\1/p' /chainlink/ocr_key.json | head -n1)
      fi
      DID_IMPORT_OCR=true
    fi
  fi
  # Fetch live keys to align TOML with node state
  local p2p_id ocr_id evm_addr
  if ensure_jq; then
    p2p_id=$(curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" | jq -r '.data[0].attributes.peerId // .data[0].peerId // (.data[0].id|sub("^p2p_";"")) // empty')
    ocr_id=$(curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" | jq -r '.data[0].id // .data[0].attributes.id // empty')
    evm_addr=$(curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" | jq -r '.data[0].attributes.address // .data[0].address // empty')
  else
    p2p_id=$(curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" | sed -n 's/.*"peerId"\s*:\s*"\([^"]*\)".*/\1/p' | head -n1)
    [ -z "$p2p_id" ] && p2p_id=$(curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" | sed -n 's/.*"id"\s*:\s*"\(p2p_[^"]*\)".*/\1/p' | head -n1 | sed 's/^p2p_//')
    ocr_id=$(curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" | sed -n 's/.*"id"\s*:\s*"\([0-9a-f]\{64\}\)".*/\1/p' | head -n1)
    evm_addr=$(curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" | sed -n 's/.*"address"\s*:\s*"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' | head -n1)
  fi

  # Persist exported OCR key JSON if not yet saved
  if [[ -n "${ocr_id}" && ! -f "/chainlink/ocr_key.json" ]]; then
    exp_ocr_code=$(curl -sS -o /chainlink/ocr_key.json -w '%{http_code}' \
      -X POST "${API_URL}/v2/keys/ocr/export/${ocr_id}?newpassword=${OCR_EXPORT_PASSWORD}" \
      -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
      -b "${COOKIE_FILE}" || true)
    chmod 600 /chainlink/ocr_key.json || true
    echo "[publish] OCR key export http=${exp_ocr_code} -> /chainlink/ocr_key.json" >&2
  fi

  # If this is a bootstrap node, write its peer id and IP into shared secrets for workers
  if [[ "${is_bootstrap}" == "true" && -n "${p2p_id}" ]]; then
    mkdir -p "${SHARED_SECRETS_DIR}"
    echo "${p2p_id}" | sed 's/^p2p_//' > "${SHARED_SECRETS_DIR}/bootstrap-${node_num}.peerid"
    echo "$(ip_for_node "${node_num}")" > "${SHARED_SECRETS_DIR}/bootstrap-${node_num}.ip"
  fi

  # Persist exported EVM key JSON if not yet saved
  if [[ -n "${evm_addr}" && ! -f "/chainlink/evm_key.json" ]]; then
    exp_code=$(curl -sS -o /chainlink/evm_key.json -w '%{http_code}' \
      -X POST "${API_URL}/v2/keys/evm/export/${evm_addr}?newpassword=${EVM_EXPORT_PASSWORD}" \
      -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
      -b "${COOKIE_FILE}" || true)
    chmod 600 /chainlink/evm_key.json || true
    echo "[publish] EVM key export http=${exp_code} -> /chainlink/evm_key.json" >&2
  fi

  # If we imported (or already had) an external key, delete any extra EVM keys not matching it
  if $DID_IMPORT && [[ -n "${IMPORTED_ADDR}" ]]; then
    # Fetch all EVM keys and delete those not equal to IMPORTED_ADDR
    if ensure_jq; then
      mapfile -t evm_addrs < <(curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" | jq -r '.data[] | (.attributes.address // .address)')
    else
      IFS=$'\n' read -r -d '' -a evm_addrs < <(curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" | sed -n 's/.*"address"\s*:\s*"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' && printf '\0')
    fi
    for addr in "${evm_addrs[@]}"; do
      if [[ -n "$addr" && "${addr,,}" != "${IMPORTED_ADDR,,}" ]]; then
        del_code=$(curl -sS -o /tmp/evm_delete_${addr}.json -w '%{http_code}' \
          -X DELETE "${API_URL}/v2/keys/evm/${addr}" \
          -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
          -b "${COOKIE_FILE}" || true)
        echo "[publish] Deleted extra EVM key ${addr}, http=${del_code}" >&2
      fi
    done
  fi

  # If we imported (or already had) an external OCR key, delete any extra OCR keys not matching it
  if $DID_IMPORT_OCR && [[ -n "${IMPORTED_OCR_ID}" ]]; then
    if ensure_jq; then
      mapfile -t ocr_ids < <(curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" | jq -r '.data[] | (.id // .attributes.id)')
    else
      IFS=$'\n' read -r -d '' -a ocr_ids < <(curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" | sed -n 's/.*"id"\s*:\s*"\([0-9a-f]\{64\}\)".*/\1/p' && printf '\0')
    fi
    for id in "${ocr_ids[@]}"; do
      if [[ -n "$id" && "${id,,}" != "${IMPORTED_OCR_ID,,}" ]]; then
        del_ocr_code=$(curl -sS -o /tmp/ocr_delete_${id}.json -w '%{http_code}' \
          -X DELETE "${API_URL}/v2/keys/ocr/${id}" \
          -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
          -b "${COOKIE_FILE}" || true)
        echo "[publish] Deleted extra OCR key ${id}, http=${del_ocr_code}" >&2
      fi
    done
  fi

  for f in "${rendered_file}"; do
    [[ -f "$f" ]] || continue
    # Rewrite a temp file with live keys if available
    local src="$f" tmp=""
    if [ -n "$p2p_id" ] || [ -n "$ocr_id" ] || [ -n "$evm_addr" ]; then
      tmp=$(mktemp)
      cp "$f" "$tmp"
      [ -n "$p2p_id" ] && sed -i'' -E "s/^(\s*p2pPeerID\s*=\s*)\".*\"/\1\"${p2p_id}\"/" "$tmp"
      [ -n "$ocr_id" ] && sed -i'' -E "s/^(\s*keyBundleID\s*=\s*)\".*\"/\1\"${ocr_id}\"/" "$tmp"
      [ -n "$evm_addr" ] && sed -i'' -E "s/^(\s*transmitterAddress\s*=\s*)\".*\"/\1\"${evm_addr}\"/" "$tmp"
      src="$tmp"
    fi

    # Always ensure p2pBootstrapPeers, isBootstrapPeer, evmChainID
    if [[ -z "$tmp" ]]; then tmp=$(mktemp); cp "$src" "$tmp"; src="$tmp"; fi
    if [[ -n "$bootstrap_peers" ]]; then
      if grep -qE '^\s*p2pBootstrapPeers\s*=' "$src"; then
        sed -i'' -E "s#^\s*p2pBootstrapPeers\s*=.*#p2pBootstrapPeers = ${bootstrap_peers}#" "$src"
      else
        printf '\n%s\n' "p2pBootstrapPeers = ${bootstrap_peers}" >> "$src"
      fi
    fi
    if [[ -n "$evm_chain_id" ]]; then
      sed -i'' -E "s#^\s*evmChainID\s*=\s*\".*\"#evmChainID = \"${evm_chain_id}\"#" "$src" || true
    fi
    if [[ "$is_bootstrap" == "true" ]]; then
      sed -i'' -E "s#^\s*isBootstrapPeer\s*=.*#isBootstrapPeer = true#" "$src" || true
      # Remove observationSource block and forbidden fields for bootstrap peer
      awk '
        BEGIN{skip=0}
        /^[[:space:]]*observationSource[[:space:]]*=[[:space:]]*"""/ { skip=1; next }
        skip && /^[[:space:]]*"""[[:space:]]*$/ { skip=0; next }
        skip { next }
        { print }
      ' "$src" > "${src}.clean" && mv "${src}.clean" "$src"
      sed -i'' -E '/^[[:space:]]*keyBundleID[[:space:]]*=.*/d' "$src"
      sed -i'' -E '/^[[:space:]]*transmitterAddress[[:space:]]*=.*/d' "$src"
    else
      sed -i'' -E "s#^\s*isBootstrapPeer\s*=.*#isBootstrapPeer = false#" "$src" || true
    fi

    # JSON {toml:"..."} using jq to guarantee valid JSON string
    ensure_jq || { echo "[publish] jq not available; skip publishing $f" >&2; continue; }
    local body
    body=$(jq -Rs '. as $toml | {toml:$toml}' < "$src")
    http_code=$(curl -sS -o /tmp/job_resp.json -w '%{http_code}' -X POST "${API_URL}/v2/jobs" \
      -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
      -b "${COOKIE_FILE}" --data "${body}")
    if ! echo "$http_code" | grep -qE '^(200|201)$'; then
      echo "[publish] Failed to create job from $f, http=$http_code" >&2
      cat /tmp/job_resp.json >&2 || true
    else
      echo "[publish] Created job from $f"
    fi
    [ -n "$tmp" ] && rm -f "$tmp" || true
  done
}

wait_for_api && login && publish_jobs || true

