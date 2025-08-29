#!/usr/bin/env bash
set -euo pipefail

# Chainlink OCR job generator and publisher using envsubst
# - Renders a TOML template with per-node variables
# - Logs into each node, discovers keys via API, and creates the job

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEMPLATE_PATH_DEFAULT="${SCRIPT_DIR}/templates/btc-usd.toml"

# Configuration (can be overridden by env vars)
NODES_LIST=${NODES_LIST:-"1 2 3 4 5"}
TEMPLATE_PATH=${TEMPLATE_PATH:-"${TEMPLATE_PATH_DEFAULT}"}
# If not provided, try to read from node-1 config.toml; fallback to 5611
EVM_CHAIN_ID=${EVM_CHAIN_ID:-""}

# Network / Compose assumptions
HTTP_PORT_BASE=${HTTP_PORT_BASE:-6688}
BOOTSTRAP_NODE=${BOOTSTRAP_NODE:-1}
PUBLISH=${PUBLISH:-false}

# Helper: compute compose-exposed HTTP port per node number
port_for_node() {
  local node_num="$1"
  echo $((HTTP_PORT_BASE + node_num - 1))
}

# Helper: compute container P2P IP per node number (per docker-compose-5.yml)
ip_for_node() {
  local node_num="$1"
  echo "10.5.0.$((8 + node_num))"
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Error: required dependency '$bin' not found in PATH" >&2
    exit 1
  fi
}

usage() {
  cat <<USAGE
Usage: NODES_LIST="1 2 3 4 5" BOOTSTRAP_NODE=1 TEMPLATE_PATH=... $0

Env vars:
  - NODES_LIST: space-separated node numbers to publish the job to (default: "1 2 3 4 5")
  - BOOTSTRAP_NODE: node number to use as P2P bootstrap (default: 1)
  - TEMPLATE_PATH: path to the TOML template (default: ${TEMPLATE_PATH_DEFAULT})
  - HTTP_PORT_BASE: base port for node 1 (default: 6688). Node N -> base + N - 1
  - EVM_CHAIN_ID: overrides chain id; auto-detected from node-1 config if missing
  - CONTRACT_ADDRESS: ignored (address is fixed in template)

Requirements:
  - curl, jq, envsubst, uuidgen
  - Each node directory must contain an 'apicredentials' file
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_bin curl
require_bin jq
require_bin envsubst
require_bin uuidgen

# Cross-platform sed -i helper
is_darwin=false
case "$(uname)" in
  Darwin*) is_darwin=true ;;
esac
sed_inplace() {
  if $is_darwin; then
    sed -i '' -e "$1" "$2"
  else
    sed -i -e "$1" "$2"
  fi
}

# Login and capture cookie for a node
login_node() {
  local node_num="$1"
  local port="$2"
  local cookie_file="$3"

  local creds_file="${REPO_ROOT}/chainlink-node-${node_num}-data/apicredentials"
  if [[ ! -f "${creds_file}" ]]; then
    echo "Error: credentials file not found: ${creds_file}" >&2
    return 1
  fi
  local email password
  email=$(sed -n '1p' "${creds_file}")
  password=$(sed -n '2p' "${creds_file}")

  local http_code
  http_code=$(curl -sS -o /tmp/login_resp.json -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/sessions" \
    -H 'Content-Type: application/json' \
    -c "${cookie_file}" \
    --data "{\"email\":\"${email}\",\"password\":\"${password}\"}")
  if [[ "${http_code}" != "200" && "${http_code}" != "201" ]]; then
    echo "Login failed for node ${node_num} (port ${port}), HTTP ${http_code}:" >&2
    cat /tmp/login_resp.json >&2 || true
    return 1
  fi
}

# Fetch CSRF token header value for subsequent authenticated calls
fetch_csrf_token() {
  local port="$1"
  local cookie_file="$2"
  # Capture headers only, search for X-CSRF-Token
  local header_token
  header_token=$(curl -sSI -X GET "http://127.0.0.1:${port}/v2/csrf" -b "${cookie_file}" | awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="x-csrf-token" {gsub(/\r/,"",$2); print $2}')
  if [[ -n "${header_token}" ]]; then
    echo "${header_token}"
    return 0
  fi
  # Fallback: some versions return JSON body with the token
  local body_token
  body_token=$(curl -sS -X GET "http://127.0.0.1:${port}/v2/csrf" -b "${cookie_file}" | jq -r '.data | .csrfToken // .token // empty')
  echo "${body_token}"
}

# Ensure required keys exist; if missing, create them and return ids
ensure_keys() {
  local port="$1" cookie_file="$2" csrf_token="$3"

  local peer_id ocr_key_id transmitter

  # List existing
  peer_id=$(curl -sS -X GET "http://127.0.0.1:${port}/v2/keys/p2p" -b "${cookie_file}" | jq -r '.data[0].attributes.peerId // .data[0].peerId // empty')
  ocr_key_id=$(curl -sS -X GET "http://127.0.0.1:${port}/v2/keys/ocr" -b "${cookie_file}" | jq -r '.data[0].id // .data[0].attributes.id // empty')
  transmitter=$(curl -sS -X GET "http://127.0.0.1:${port}/v2/keys/evm" -b "${cookie_file}" | jq -r '.data[0].attributes.address // .data[0].address // empty')

  # Create P2P if missing
  if [[ -z "${peer_id}" ]]; then
    local http_code
    if [[ -n "${csrf_token}" ]]; then local csrf_hdr=(-H "X-CSRF-Token: ${csrf_token}"); else local csrf_hdr=(); fi
    http_code=$(curl -sS -o /tmp/p2p_create.json -w '%{http_code}' \
      -X POST "http://127.0.0.1:${port}/v2/keys/p2p" \
      -H 'Content-Type: application/json' \
      "${csrf_hdr[@]}" \
      -b "${cookie_file}" \
      --data '{}')
    if [[ "${http_code}" == "201" || "${http_code}" == "200" ]]; then
      peer_id=$(jq -r '.data.attributes.peerId // .data.peerId // empty' /tmp/p2p_create.json)
    fi
  fi

  # Create OCR if missing
  if [[ -z "${ocr_key_id}" ]]; then
    local http_code
    if [[ -n "${csrf_token}" ]]; then local csrf_hdr2=(-H "X-CSRF-Token: ${csrf_token}"); else local csrf_hdr2=(); fi
    http_code=$(curl -sS -o /tmp/ocr_create.json -w '%{http_code}' \
      -X POST "http://127.0.0.1:${port}/v2/keys/ocr" \
      -H 'Content-Type: application/json' \
      "${csrf_hdr2[@]}" \
      -b "${cookie_file}" \
      --data '{"isBootstrap":false}')
    if [[ "${http_code}" == "201" || "${http_code}" == "200" ]]; then
      ocr_key_id=$(jq -r '.data.id // .data.attributes.id // empty' /tmp/ocr_create.json)
    fi
  fi

  echo "${peer_id}|${ocr_key_id}|${transmitter}"
}

create_or_update_job() {
  local port="$1"
  local cookie_file="$2"
  local rendered_toml="$3"
  local csrf_token="$4"

  # Try create
  local http_code json_body
  json_body=$(jq -Rs '. as $toml | {toml:$toml}' < "${rendered_toml}")
  http_code=$(curl -sS -o /tmp/resp.json -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/v2/jobs" \
    -H 'Content-Type: application/json' \
    ${csrf_token:+-H "X-CSRF-Token: ${csrf_token}"} \
    -b "${cookie_file}" \
    --data "${json_body}")
  if [[ "${http_code}" == "201" || "${http_code}" == "200" ]]; then
    echo "Created job on port ${port}"
    return 0
  fi

  # If already exists due to ExternalJobID uniqueness, bail with info
  echo "Non-2xx (${http_code}) response for create on port ${port}:" >&2
  cat /tmp/resp.json >&2 || true
  return 1
}

main() {
  if [[ ! -f "${TEMPLATE_PATH}" ]]; then
    echo "Error: template not found: ${TEMPLATE_PATH}" >&2
    exit 1
  fi

  if [[ -z "${EVM_CHAIN_ID}" ]]; then
    local node1_cfg="${REPO_ROOT}/chainlink-node-1-data/config.toml"
    if [[ -f "${node1_cfg}" ]]; then
      EVM_CHAIN_ID=$(awk -F"'" '/^\s*\[\[EVM\]\]/{f=1} f && /ChainID/{print $2; exit}' "${node1_cfg}" || true)
    fi
    if [[ -z "${EVM_CHAIN_ID}" ]]; then
      EVM_CHAIN_ID="5611"
    fi
  fi

  # Use one external job ID across all nodes unless explicitly overridden per-run
  local EXTERNAL_JOB_ID_GLOBAL
  EXTERNAL_JOB_ID_GLOBAL=${EXTERNAL_JOB_ID:-$(uuidgen)}

  # CONTRACT_ADDRESS is fixed in the template; no env required

  local bootstrap_peer_id="" bootstrap_ip=""
  # We no longer require DefaultBootstrappers to be populated offline.
  # Use compose-mapped IP for bootstrap; peer id will be injected by publisher at runtime.
  bootstrap_ip="$(ip_for_node "${BOOTSTRAP_NODE}")"
  echo "Bootstrap (offline): ip=${bootstrap_ip}; peer id will be injected at publish-time"

  for node_num in ${NODES_LIST}; do
    local port cookie_file node_ip peer_id ocr_key_id transmitter ext_job_id rendered_file
    port=$(port_for_node "${node_num}")
    node_ip=$(ip_for_node "${node_num}")
    cookie_file="$(mktemp)"

    echo "\n=== Node ${node_num} (port ${port}, ip ${node_ip}) ==="
    echo "Logging in..."
    if ! login_node "${node_num}" "${port}" "${cookie_file}"; then
      echo "Skipping node ${node_num} due to login failure" >&2
      rm -f "${cookie_file}" || true
      continue
    fi

    echo "Ensuring keys..."
    csrf_token=$(fetch_csrf_token "${port}" "${cookie_file}") || true
    IFS='|' read -r peer_id ocr_key_id transmitter < <(ensure_keys "${port}" "${cookie_file}" "${csrf_token}")

    if [[ -z "${peer_id}" || -z "${ocr_key_id}" || -z "${transmitter}" || "${peer_id}" == "null" || "${ocr_key_id}" == "null" || "${transmitter}" == "null" ]]; then
      echo "Error: missing required keys on node ${node_num}. P2P=${peer_id} OCR=${ocr_key_id} EVM=${transmitter}" >&2
      continue
    fi

    ext_job_id="${EXTERNAL_JOB_ID_GLOBAL}"
    # Save rendered TOML inside the node's config directory under a dedicated subdir
    local node_dir="${REPO_ROOT}/chainlink-node-${node_num}-data"
    local job_dir="${node_dir}/jobs"
    mkdir -p "${job_dir}"
    rendered_file="${job_dir}/btc-usd.node-${node_num}.toml"

    echo "Rendering template -> ${rendered_file}"
    # Offline: put empty peers; publisher fills actual peers at runtime
    P2P_BOOTSTRAP_PEERS="[]"
    IS_BOOTSTRAP=$([[ "${node_num}" == "${BOOTSTRAP_NODE}" ]] && echo true || echo false) \
    EXTERNAL_JOB_ID="${ext_job_id}" \
    P2P_PEER_ID="${peer_id#p2p_}" \
    P2P_BOOTSTRAP_PEERS="${P2P_BOOTSTRAP_PEERS}" \
    OCR_KEY_BUNDLE_ID="${ocr_key_id}" \
    TRANSMITTER_ADDRESS="${transmitter}" \
    EVM_CHAIN_ID="${EVM_CHAIN_ID}" \
      envsubst < "${TEMPLATE_PATH}" > "${rendered_file}"

    # For bootstrap peer jobs, remove fields not allowed: observationSource, keyBundleID, transmitterAddress
    if [[ "${node_num}" == "${BOOTSTRAP_NODE}" ]]; then
      tmpfile="$(mktemp)"
      awk '
        BEGIN{skip=0}
        /^[[:space:]]*observationSource[[:space:]]*=[[:space:]]*"""/ { skip=1; next }
        skip && /^[[:space:]]*"""[[:space:]]*$/ { skip=0; next }
        skip { next }
        { print }
      ' "${rendered_file}" > "${tmpfile}"
      mv "${tmpfile}" "${rendered_file}"
      # Drop single-line forbidden keys if present
      sed_inplace '/^[[:space:]]*keyBundleID[[:space:]]*=.*/d' "${rendered_file}"
      sed_inplace '/^[[:space:]]*transmitterAddress[[:space:]]*=.*/d' "${rendered_file}"
    fi

    if [[ "${PUBLISH}" == "true" ]]; then
      echo "Creating job via API..."
      if create_or_update_job "${port}" "${cookie_file}" "${rendered_file}" "${csrf_token}"; then
        echo "Success: job created on node ${node_num}"
      else
        echo "Failed: could not create job on node ${node_num}" >&2
      fi
    else
      echo "Rendered only (no publish). File: ${rendered_file}"
    fi

    rm -f "${cookie_file}" || true
  done
}

main "$@"
