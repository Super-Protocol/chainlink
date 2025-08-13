#!/usr/bin/env bash
set -euo pipefail

have_jq() { command -v jq >/dev/null 2>&1; }

ensure_jq() {
  if have_jq; then return 0; fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq || true
    apt-get install -y -qq jq || true
  fi
  have_jq
}

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
COOKIE_FILE="/tmp/cl_cookie"

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
  [[ -d "${JOBS_DIR}" ]] || return 0
  local token
  token=$(csrf || true)
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

  for f in "${JOBS_DIR}"/*.toml; do
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

    # JSON {toml:"..."} using jq to guarantee valid JSON string
    ensure_jq || { echo "[publish] jq not available; cannot safely encode JSON" >&2; continue; }
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

