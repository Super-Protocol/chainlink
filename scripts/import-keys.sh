#!/usr/bin/env bash
set -euo pipefail

API_URL="http://127.0.0.1:6688"
COOKIE_FILE="/tmp/cl_cookie_import"
SHARED_SECRETS_DIR="${SHARED_SECRETS_DIR:-/sp/secrets}"

email=$(sed -n '1p' /chainlink/apicredentials 2>/dev/null || echo "")
password=$(sed -n '2p' /chainlink/apicredentials 2>/dev/null || echo "")

determine_node_number() {
  if [[ -n "${NODE_NUMBER:-}" ]]; then echo "${NODE_NUMBER}"; return; fi
  echo "${HOSTNAME}" | grep -oE '[0-9]+$' || echo "1"
}

csrf() {
  curl -sSI -X GET "${API_URL}/v2/csrf" -b "${COOKIE_FILE}" | awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="x-csrf-token" {gsub(/\r/,"",$2); print $2}'
}

login() {
  [[ -n "$email" && -n "$password" ]] || return 1
  curl -sS -X POST "${API_URL}/sessions" -H 'Content-Type: application/json' -c "${COOKIE_FILE}" --data "{\"email\":\"${email}\",\"password\":\"${password}\"}" >/dev/null || true
  grep -q 'clsession' "${COOKIE_FILE}" 2>/dev/null
}

list_existing_evm_addrs() {
  curl -sS -X GET "${API_URL}/v2/keys/evm" -b "${COOKIE_FILE}" \
    | jq -r '.data[] | .attributes.address | select(.!=null)' 2>/dev/null || true
}

list_existing_p2p_ids() {
  curl -sS -X GET "${API_URL}/v2/keys/p2p" -b "${COOKIE_FILE}" \
    | jq -r '.data[] | ((.attributes.peerId // .id) | sub("^p2p_";""))' 2>/dev/null || true
}

list_existing_ocr_ids() {
  curl -sS -X GET "${API_URL}/v2/keys/ocr" -b "${COOKIE_FILE}" \
    | jq -r '.data[] | .id | select(.!=null)' 2>/dev/null || true
}

main() {
  local node_num key_dir token http
  node_num=$(determine_node_number)
  key_dir="${SHARED_SECRETS_DIR}/cl-secrets/${node_num}"
  [[ -d "$key_dir" ]] || key_dir="/chainlink"

  login || exit 0
  token=$(csrf || true)

  # EVM: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/evm_key.json" && -n "${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" ]]; then
    mapfile -t existing_addrs < <(list_existing_evm_addrs)
    for a in "${existing_addrs[@]:-}"; do
      [[ -n "$a" ]] || continue
      curl -sS -o /tmp/evm_delete_${a}.json -w '%{http_code}' -X DELETE "${API_URL}/v2/keys/evm/${a}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" >/dev/null || true
    done
    evm_chain_id=$CHAINLINK_CHAIN_ID
    if [[ -n "$evm_chain_id" ]]; then
      http=$(curl -sS -o /tmp/evm_import.json -w '%{http_code}' -X POST "${API_URL}/v2/keys/evm/import?oldpassword=${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}&evmChainID=${evm_chain_id}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" --data-binary @"${key_dir}/evm_key.json" || true)
      echo "[import] EVM key http=${http} (${key_dir}/evm_key.json)" >&2
    else
      echo "[import] EVM key: missing evmChainID; skipping import" >&2
    fi
  else
    echo "[import] EVM key: missing file or password; skipping" >&2
  fi

  # P2P: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/p2p_key.json" && -n "${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" ]]; then
    mapfile -t existing_pids < <(list_existing_p2p_ids)
    for pid in "${existing_pids[@]:-}"; do
      [[ -n "$pid" ]] || continue
      curl -sS -o /tmp/p2p_delete_${pid}.json -w '%{http_code}' -X DELETE "${API_URL}/v2/keys/p2p/p2p_${pid}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" >/dev/null || true
    done
    http=$(curl -sS -o /tmp/p2p_import.json -w '%{http_code}' -X POST "${API_URL}/v2/keys/p2p/import?oldpassword=${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" --data-binary @"${key_dir}/p2p_key.json" || true)
    echo "[import] P2P key http=${http} (${key_dir}/p2p_key.json)" >&2
  else
    echo "[import] P2P key: missing file or password; skipping" >&2
  fi

  # OCR: delete all, then import (only if file and password exist)
  if [[ -f "${key_dir}/ocr_key.json" && -n "${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" ]]; then
    mapfile -t existing_oids < <(list_existing_ocr_ids)
    for oid in "${existing_oids[@]:-}"; do
      [[ -n "$oid" ]] || continue
      curl -sS -o /tmp/ocr_delete_${oid}.json -w '%{http_code}' -X DELETE "${API_URL}/v2/keys/ocr/${oid}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" >/dev/null || true
    done
    http=$(curl -sS -o /tmp/ocr_import.json -w '%{http_code}' -X POST "${API_URL}/v2/keys/ocr/import?oldpassword=${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" -H 'Content-Type: application/json' ${token:+-H "X-CSRF-Token: ${token}"} -b "${COOKIE_FILE}" --data-binary @"${key_dir}/ocr_key.json" || true)
    echo "[import] OCR key http=${http} (${key_dir}/ocr_key.json)" >&2
  else
    echo "[import] OCR key: missing file or password; skipping" >&2
  fi
}

main "$@"
