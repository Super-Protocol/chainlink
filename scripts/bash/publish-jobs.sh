#!/usr/bin/env bash
set -euo pipefail

cd $(dirname $0)

json_escape() {
  # Escapes input for safe embedding as a JSON string
  sed -e 's/\\/\\\\/g' \
      -e 's/"/\\"/g' \
      -e 's/\t/\\t/g' \
      -e 's/\r/\\r/g' \
      -e 's/\n/\\n/g'
}
API_PORT="${API_PORT:-6688}"
API_URL="http://127.0.0.1:${API_PORT}"
CL_FEED_TEMPLATES_DIR="${CL_FEED_TEMPLATES_DIR:-/templates}"
COOKIE_FILE="$(cd /tmp && mktemp -t cl_cookie_import.XXXXXX)"
SP_SECRETS_DIR="/sp/secrets"
EVM_EXPORT_PASSWORD="${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}"
OCR_EXPORT_PASSWORD="${OCR_EXPORT_PASSWORD:-${EVM_EXPORT_PASSWORD}}"
P2P_EXPORT_PASSWORD="${P2P_EXPORT_PASSWORD:-${EVM_EXPORT_PASSWORD}}"
mkdir -p "${JOB_RENDERS_DIR}"

# Compose IP helper
ip_for_node() {
  if [[ "${ALL_IN_ONE:-}" == "true" ]]; then
    local n="$1"; echo "127.0.0.1";
  else
    local n="$1"; echo "10.5.0.$((8 + n))";
  fi
}

# Read local credentials
read_creds() {
  local email password
  email=$(sed -n '1p' $NODE_ROOT_DIR/apicredentials 2>/dev/null || echo "")
  password=$(sed -n '2p' $NODE_ROOT_DIR/apicredentials 2>/dev/null || echo "")
  printf '%s|%s' "$email" "$password"
}

# Prefer reading bootstrap info from shared secrets written by bootstrap nodes
bootstrap_info_from_shared_secrets() {
  local bs_env="${BOOTSTRAP_NODES:-1}"
  local IFS=' '; read -r -a bs_nodes <<< "$bs_env"
  [[ ${#bs_nodes[@]} -gt 0 ]] || { echo "|"; return; }
  local first_bs="${bs_nodes[0]}"
  local fpeer="$SP_SECRETS_DIR/bootstrap-${first_bs}.peerid"
  local fip="$SP_SECRETS_DIR/bootstrap-${first_bs}.ip"
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
  local IFS=' '; read -r -a bs_nodes <<< "$bs_env"
  [[ ${#bs_nodes[@]} -gt 0 ]] || { echo "|"; return; }
  local first_bs="${bs_nodes[0]}"
  local host; host=$(ip_for_node "$first_bs")
  local port="${API_PORT:-6688}"
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
      peer_id=$(curl -sS -X GET "http://${host}:${port}/v2/keys/p2p" -b "$cookie_file" | jq -r '.data[0] | (.attributes.peerId // .peerId // .id // empty) | sub("^p2p_";"")')
      if [[ -n "$peer_id" ]]; then break; fi
    fi
    tries=$((tries+1)); sleep 1
  done
  rm -f "$cookie_file" || true
  echo "${peer_id}|${host}"
}

is_node_bootstrap() {
  local node_num="$1"
  local bstr="${BOOTSTRAP_NODES:-1}"
  local IFS=' '; read -r -a bs_nodes <<< "$bstr"
  for bn in "${bs_nodes[@]}"; do
    if [[ "$bn" == "$node_num" ]]; then
      echo true; return
    fi
  done
  echo false
}

# Parse first bootstrap entry from config.toml DefaultBootstrappers and convert to multiaddr
bootstrap_peers_multiaddr_from_config() {
  local cfg="${NODE_ROOT_DIR}/config.toml"
  # Prefer explicit env BOOTSTRAP_NODE_ADDRESSES
  if [[ -n "${BOOTSTRAP_NODE_ADDRESSES:-}" ]]; then
    local bs_env="${BOOTSTRAP_NODES:-1}"; local IFS=' '; read -r -a bs_nodes <<< "$bs_env"
    local peer_ids=()
    for bn in "${bs_nodes[@]}"; do
      local fpeer="${SP_SECRETS_DIR}/bootstrap-${bn}.peerid"
      if [[ -s "$fpeer" ]]; then
        local pid; pid=$(sed -n '1p' "$fpeer" | sed 's/^p2p_//')
        [[ -n "$pid" ]] && peer_ids+=("$pid")
      fi
    done
    IFS=',' read -r -a addrs <<< "${BOOTSTRAP_NODE_ADDRESSES}"
    local out="["; local first=true
    local n=${#addrs[@]}; local m=${#peer_ids[@]}; local limit=$(( n < m ? n : m ))
    for ((i=0; i<limit; i++)); do
      local a="${addrs[$i]}"; a=$(echo "$a" | xargs)
      [[ -z "$a" ]] && continue
      local host="${a%%:*}"; local port="${a##*:}"
      [[ -z "$port" || "$port" == "$host" ]] && port="9999"
      local pid="${peer_ids[$i]}"
      if [[ -n "$host" && -n "$pid" ]]; then
        if [[ "$first" == true ]]; then
          first=false
        else
          out+=", "
        fi
        if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          out+="\"/ip4/${host}/tcp/${port}/tls/ws/p2p/${pid}\""
        else
          out+="\"/dns4/${host}/tcp/${port}/tls/ws/p2p/${pid}\""
        fi
      fi
    done
    out+="]"; echo "$out"; return
  fi
  # Fallback to config DefaultBootstrappers (first entry)
  [[ -f "$cfg" ]] || { echo "[]"; return; }
  local entry
  entry=$(awk '
    /^\s*\[P2P\.V2\]\s*$/ {inblock=1; next}
    inblock && /^\s*\[/ {inblock=0}
    inblock && /DefaultBootstrappers/ {print; exit}
  ' "$cfg")
  local peer host
  peer=$(printf '%s\n' "$entry" | sed -n "s/.*'\([^'@]*\)@.*/\1/p")
  if [[ -z "$peer" ]]; then peer=$(printf '%s\n' "$entry" | sed -n 's/.*"\([^"@]*\)@.*/\1/p'); fi
  host=$(printf '%s\n' "$entry" | sed -n "s/.*@\([^:'\"]*\):.*/\1/p")
  if [[ -n "$peer" && -n "$host" ]]; then
    if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "[\"/ip4/${host}/tcp/9999/tls/ws/p2p/${peer}\"]"
    else
      echo "[\"/dns4/${host}/tcp/9999/tls/ws/p2p/${peer}\"]"
    fi
  else
    echo "[]"
  fi
}

# Extract EVM ChainID from config.toml
chain_id_from_config() {
  local cfg="${NODE_ROOT_DIR}/config.toml"
  [[ -f "$cfg" ]] || { echo ""; return; }
  awk -F"'" '/^\s*\[\[EVM\]\]/{f=1} f && /ChainID/{print $2; exit}' "$cfg" || true
}

email=$(sed -n '1p' $NODE_ROOT_DIR/apicredentials 2>/dev/null || echo "")
password=$(sed -n '2p' $NODE_ROOT_DIR/apicredentials 2>/dev/null || echo "")

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
  token=$(curl -sS -X GET "${API_URL}/v2/csrf" -b "${COOKIE_FILE}" | jq -r '.data.csrfToken // .token // empty')
  echo "$token"
}

render_jobs() {
  mkdir -p "${JOB_RENDERS_DIR}"
  local is_bootstrap bootstrap_peers evm_chain_id
  is_bootstrap=$(is_node_bootstrap "$NODE_NUMBER")

  # Resolve bootstrap peers from config
  bootstrap_peers=$(bootstrap_peers_multiaddr_from_config)
  # Resolve chain id from config or env
  evm_chain_id=${CHAINLINK_CHAIN_ID:-$(chain_id_from_config)}

  # Try to resolve IDs; prefer API for EVM address to keep EIP55 checksum
  local secrets_dir="${SP_SECRETS_DIR}/cl-secrets/${NODE_NUMBER}"
  local p2p_id ocr_id evm_addr
  # P2P
  p2p_id=$(curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" | jq -r '.data[0].attributes.peerId // .data[0].id // empty' | sed 's/^p2p_//')
  if [[ -z "$p2p_id" && -f "${secrets_dir}/p2p_key.json" ]]; then
    p2p_id=$(jq -r '(.peerID // .peerId // empty)' "${secrets_dir}/p2p_key.json" | sed 's/^p2p_//')
  fi
  # OCR
  ocr_id=$(curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" | jq -r '.data[0].id // empty')
  if [[ -z "$ocr_id" && -f "${secrets_dir}/ocr_key.json" ]]; then
    ocr_id=$(jq -r '.id // empty' "${secrets_dir}/ocr_key.json")
  fi
  # EVM (prefer API to keep EIP55 checksum)
  evm_addr=$(curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" | jq -r '.data[0].attributes.address // empty')
  if [[ -z "$evm_addr" && -f "${secrets_dir}/evm_key.json" ]]; then
    evm_addr_raw=$(jq -r '.address // empty' "${secrets_dir}/evm_key.json")
    [[ -n "$evm_addr_raw" ]] && evm_addr="0x${evm_addr_raw}"
  fi

  # Export variables for envsubst
  export EVM_CHAIN_ID="${evm_chain_id:-}"
  export IS_BOOTSTRAP=$([[ "$is_bootstrap" == "true" ]] && echo true || echo false)
  export P2P_PEER_ID="${p2p_id:-}"
  export P2P_BOOTSTRAP_PEERS="${bootstrap_peers:-[] }"
  export OCR_KEY_BUNDLE_ID="${ocr_id:-}"
  export TRANSMITTER_ADDRESS="${evm_addr:-}"

  # Render all templates
  shopt -s nullglob
  # Load feed-cas.json once (relative path from this script)
  local feed_cas_path
  feed_cas_path="./data/feed-cas.chainid-${evm_chain_id}.json"
  if [[ ! -f "${feed_cas_path}" ]]; then
    echo "[error] feed-cas.json not found at ${feed_cas_path}" >&2
    return 1
  fi
  local FEED_CAS_JSON_CONTENT
  FEED_CAS_JSON_CONTENT="$(cat "${feed_cas_path}")"

  for tpl in "${CL_FEED_TEMPLATES_DIR}"/*.toml; do
    local base out
    base=$(basename "$tpl" .toml)
    out="${JOB_RENDERS_DIR}/${base}.toml"
    # Determine job name: prefer explicit name="..." in template, else filename
    local job_name job_ca
    job_name=$(sed -n 's/^name\s*=\s*"\(.*\)".*/\1/p' "$tpl" | head -n1 || true)
    [[ -n "$job_name" ]] || job_name="$base"
    # Lookup contract address by exact key match (job_name) in JSON
    job_ca=$(printf '%s' "$FEED_CAS_JSON_CONTENT" | jq -r --arg k "$job_name" '.[$k] // empty') || job_ca=""
    export JOB_CA="$job_ca"
    envsubst < "$tpl" > "$out"
    # For bootstrap node, mirror generate.sh behavior: drop fields not allowed
    if [[ "$IS_BOOTSTRAP" == "true" ]]; then
      # Remove observationSource multiline block
      awk '
        BEGIN{skip=0}
        /^[[:space:]]*observationSource[[:space:]]*=[[:space:]]*"""/ { skip=1; next }
        skip && /^[[:space:]]*"""[[:space:]]*$/ { skip=0; next }
        skip { next }
        { print }
      ' "$out" > "${out}.clean" && mv "${out}.clean" "$out"
      # Remove single-line forbidden keys
      sed -i'' -E '/^[[:space:]]*keyBundleID[[:space:]]*=.*/d' "$out"
      sed -i'' -E '/^[[:space:]]*transmitterAddress[[:space:]]*=.*/d' "$out"
      # Ensure flag is true
      sed -i'' -E "s#^\s*isBootstrapPeer\s*=.*#isBootstrapPeer = true#" "$out" || true
    fi
    echo "[render] Wrote $out"
  done
}

# Only render into /job-renders as requested
login || true
render_jobs || true

publish_rendered_jobs() {
  [[ "${PUBLISH:-true}" == "true" ]] || return 0
  local token http_code
  token=$(csrf || true)
  shopt -s nullglob
  for f in "${JOB_RENDERS_DIR}"/*.toml; do
    [[ -f "$f" ]] || continue
    local body
    body=$(jq -Rs '. as $toml | {toml:$toml}' < "$f")
    http_code=$(curl -sS -o /tmp/job_resp.json -w '%{http_code}' -X POST "${API_URL}/v2/jobs" \
      -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
      -b "${COOKIE_FILE}" --data "${body}")
    if ! echo "$http_code" | grep -qE '^(200|201)$'; then
      echo "[publish] Failed to create job from $f, http=$http_code" >&2
      if [[ -f /tmp/job_resp.json ]]; then cat /tmp/job_resp.json >&2 || true; fi
      echo ''
      # Try to update existing job (match by contractAddress + evmChainID)
      # Extract from rendered TOML
      contract_addr=$(sed -n 's/^\s*contractAddress\s*=\s*"\([^"]\+\)".*$/\1/p' "$f" | head -n1)
      chain_id=$(sed -n 's/^\s*evmChainID\s*=\s*"\([0-9]\+\)".*$/\1/p' "$f" | head -n1)
      if [[ -n "$contract_addr" && -n "$chain_id" ]]; then
        addr_lc=$(printf '%s' "$contract_addr" | tr '[:upper:]' '[:lower:]')
        job_id=$(curl -sS -X GET "${API_URL}/v2/jobs" -b "${COOKIE_FILE}" \
          | jq -r --arg addr "$addr_lc" --arg chain "$chain_id" '
              .data[]
              | select(.attributes.offChainReportingOracleSpec != null)
              | select(((.attributes.offChainReportingOracleSpec.contractAddress // "") | ascii_downcase) == $addr)
              | select((.attributes.offChainReportingOracleSpec.evmChainID | tostring) == $chain)
              | .id' | head -n1)
        if [[ -n "$job_id" && "$job_id" != "null" ]]; then
          http_code_put=$(curl -sS -o /tmp/job_resp_put.json -w '%{http_code}' -X PUT "${API_URL}/v2/jobs/${job_id}" \
            -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} \
            -b "${COOKIE_FILE}" --data "${body}")
          if echo "$http_code_put" | grep -qE '^(200|201)$'; then
            echo "[publish] Updated existing job ${job_id} from $f"
          else
            echo "[publish] Failed to update job ${job_id} from $f, http=$http_code_put" >&2
            if [[ -f /tmp/job_resp_put.json ]]; then cat /tmp/job_resp_put.json >&2 || true; fi
          fi
        else
          echo "[publish] No existing job matched contract ${contract_addr} chain ${chain_id}; skip update" >&2
        fi
      fi
    else
      echo "[publish] Created job from $f"
    fi
  done
}

publish_rendered_jobs || true
