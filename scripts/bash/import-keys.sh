#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-6688}"
API_URL="http://127.0.0.1:${API_PORT}"
COOKIE_FILE="$(cd /tmp && mktemp -t cl_cookie_import.XXXXXX)"
SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"

email=$(sed -n '1p' /chainlink/apicredentials 2>/dev/null || echo "")
password=$(sed -n '2p' /chainlink/apicredentials 2>/dev/null || echo "")

http_ok() {
  # success codes: 200 OK, 201 Created, 204 No Content, 409 Conflict (already exists)
  case "$1" in
    200|201|204|409) return 0 ;;
    *) return 1 ;;
  esac
}

login() {
  [[ -n "$email" && -n "$password" ]] || return 1
  local tries=0 max_tries=${LOGIN_MAX_RETRIES:-20} delay=${LOGIN_RETRY_DELAY_SECS:-1}
  rm -f "${COOKIE_FILE}" || true
  while [ $tries -lt $max_tries ]; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API_URL}/sessions" \
      -H 'Content-Type: application/json' -c "${COOKIE_FILE}" \
      --data "{\"email\":\"${email}\",\"password\":\"${password}\"}" || echo "000")
    if [ "$code" = "200" ] && grep -q 'clsession' "${COOKIE_FILE}" 2>/dev/null; then
      return 0
    fi
    tries=$((tries+1)); sleep "$delay"
  done
  echo "[import] login failed (email/password missing or API not ready); skipping imports" 1>&2
  return 1
}

# Curl helper returning HTTP code with retries; first arg is output file for body
curl_http_with_retry() {
  local out="$1"; shift
  local max="${CURL_MAX_RETRIES:-20}" delay="${CURL_RETRY_DELAY_SECS:-1}"
  local attempt=0 code="" status=0
  while [ $attempt -lt $max ]; do
    code=$(curl -sS -o "$out" -w '%{http_code}' "$@" 2>/dev/null); status=$?
    if [ $status -eq 0 ] && [ -n "$code" ] && [ "$code" != "000" ]; then
      echo "$code"; return 0
    fi
    attempt=$((attempt+1)); sleep "$delay"
  done
  echo "${code:-000}"
  return 0
}

list_existing_evm_addrs() {
  curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" \
    | jq -r '.data[]? | .attributes.address | select(.!=null)' 2>/dev/null || true
}

list_existing_p2p_ids() {
  curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" \
    | jq -r '.data[]? | ((.attributes.peerId // .id) | sub("^p2p_";""))' 2>/dev/null || true
}

list_existing_ocr_ids() {
  curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" \
    | jq -r '.data[]? | .id | select(.!=null)' 2>/dev/null || true
}

main() {
  local key_dir token http
  key_dir="${SP_SECRETS_DIR}/cl-secrets/${NODE_NUMBER}"
  [[ -d "$key_dir" ]] || key_dir="/chainlink"

  login || exit 0

  # EVM: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/evm_key.json" && -n "${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" ]]; then
    mapfile -t existing_addrs < <(list_existing_evm_addrs)
    for a in "${existing_addrs[@]:-}"; do
      [[ -n "$a" ]] || continue
      http=$(curl_http_with_retry "/tmp/evm_delete_${a}.json" -X DELETE "${API_URL}/v2/keys/evm/${a}" \
        -H 'Content-Type: application/json' -b "${COOKIE_FILE}" || true)
      http_ok "$http" || echo "[import] warn: evm delete ${a} http=${http}" >&2
    done
    evm_chain_id=$CHAINLINK_CHAIN_ID
    if [[ -n "$evm_chain_id" ]]; then
      http=$(curl_http_with_retry "/tmp/evm_import.json" -X POST \
        "${API_URL}/v2/keys/evm/import?oldpassword=${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}&evmChainID=${evm_chain_id}" \
        -H 'Content-Type: application/json' -b "${COOKIE_FILE}" \
        --data-binary @"${key_dir}/evm_key.json" || true)
      echo "[import] EVM key http=${http} (${key_dir}/evm_key.json)" >&2
      http_ok "$http" || echo "[import] warn: EVM import non-success http=${http}" >&2
    else
      echo "[import] EVM key: missing CHAINLINK_CHAIN_ID; skipping import" >&2
    fi
  else
    echo "[import] EVM key: missing file or password; skipping" >&2
  fi

  # P2P: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/p2p_key.json" && -n "${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" ]]; then
    mapfile -t existing_pids < <(list_existing_p2p_ids)
    for pid in "${existing_pids[@]:-}"; do
      [[ -n "$pid" ]] || continue
      http=$(curl_http_with_retry "/tmp/p2p_delete_${pid}.json" -X DELETE "${API_URL}/v2/keys/p2p/p2p_${pid}" -H 'Content-Type: application/json' -b "${COOKIE_FILE}" || true)
      http_ok "$http" || echo "[import] warn: p2p delete ${pid} http=${http}" >&2
    done
    http=$(curl_http_with_retry "/tmp/p2p_import.json" -X POST \
      "${API_URL}/v2/keys/p2p/import?oldpassword=${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" \
      -H 'Content-Type: application/json' -b "${COOKIE_FILE}" --data-binary @"${key_dir}/p2p_key.json" || true)
    echo "[import] P2P key http=${http} (${key_dir}/p2p_key.json)" >&2
    http_ok "$http" || echo "[import] warn: P2P import non-success http=${http}" >&2
  else
    echo "[import] P2P key: missing file or password; skipping" >&2
  fi

  # OCR: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/ocr_key.json" && -n "${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" ]]; then
    mapfile -t existing_oids < <(list_existing_ocr_ids)
    for oid in "${existing_oids[@]:-}"; do
      [[ -n "$oid" ]] || continue
      http=$(curl_http_with_retry "/tmp/ocr_delete_${oid}.json" -X DELETE "${API_URL}/v2/keys/ocr/${oid}" -H 'Content-Type: application/json' -b "${COOKIE_FILE}" || true)
      http_ok "$http" || echo "[import] warn: ocr delete ${oid} http=${http}" >&2
    done
    http=$(curl_http_with_retry "/tmp/ocr_import.json" -X POST \
      "${API_URL}/v2/keys/ocr/import?oldpassword=${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" \
      -H 'Content-Type: application/json' -b "${COOKIE_FILE}" --data-binary @"${key_dir}/ocr_key.json" || true)
    echo "[import] OCR key http=${http} (${key_dir}/ocr_key.json)" >&2
    http_ok "$http" || echo "[import] warn: OCR import non-success http=${http}" >&2
  else
    echo "[import] OCR key: missing file or password; skipping" >&2
  fi
}

main "$@"
