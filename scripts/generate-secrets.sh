#!/usr/bin/env bash
set -euo pipefail

# Required environment
if [ -z "${TOTAL_NODES:-}" ]; then
  log "TOTAL_NODES env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_KEYSTORE_PASSWORD:-}" ]; then
  log "CHAINLINK_KEYSTORE_PASSWORD env var is required" >&2
  exit 1
fi

# Generates per-node secrets and config into shared directory

SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
OUT_ROOT="$SP_SECRETS_DIR/cl-secrets"
SCRIPTS_DIR="/scripts/secrets"

log() { echo "[gen] $*"; }

ensure_node() { command -v node >/dev/null 2>&1 || { log "node is not available"; return 1; }; }

gen_keys_for_node() {
  local node_num="$1"
  local out_dir="$OUT_ROOT/$node_num"
  mkdir -p "$out_dir"
  local evm_file="$out_dir/evm_key.json" p2p_file="$out_dir/p2p_key.json" ocr_file="$out_dir/ocr_key.json"
  local need_evm=false need_p2p=false need_ocr=false
  [[ -s "$evm_file" ]] || need_evm=true
  [[ -s "$p2p_file" ]] || need_p2p=true
  [[ -s "$ocr_file" ]] || need_ocr=true
  if [[ ${need_evm} == true || ${need_p2p} == true || ${need_ocr} == true ]]; then
    # Ensure raw keys exist
    if [[ ! -s "$out_dir/keys-raw.json" ]]; then
      node "$SCRIPTS_DIR/gen-keys.js" "$out_dir/keys-raw.json"
    fi
    # Generate into a temp directory, then copy only missing files
    local tmp; tmp=$(mktemp -d)
    pushd "$tmp" >/dev/null
    OCR_PASSWORD="${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" \
    P2P_PASSWORD="${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" \
    EVM_PASSWORD="${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD}}" \
    node "$SCRIPTS_DIR/build-secrets.js" "$out_dir/keys-raw.json"
    popd >/dev/null
    if [[ ${need_evm} == true && -s "$tmp/evm_key.json" ]]; then
      install -m 600 -D "$tmp/evm_key.json" "$evm_file" || true
    fi
    if [[ ${need_p2p} == true && -s "$tmp/p2p_key.json" ]]; then
      install -m 600 -D "$tmp/p2p_key.json" "$p2p_file" || true
    fi
    if [[ ${need_ocr} == true && -s "$tmp/ocr_key.json" ]]; then
      install -m 600 -D "$tmp/ocr_key.json" "$ocr_file" || true
    fi
    rm -rf "$tmp" || true
    log "generated missing keys for node ${node_num} at ${out_dir}"
  else
    log "keys already present for node ${node_num}; skipping"
  fi
}

main() {
  ensure_node
  mkdir -p "$OUT_ROOT"
  local total_nodes="${TOTAL_NODES:-5}"; local i
  # 1) Generate keys for all nodes
  for i in $(seq 1 "$total_nodes"); do gen_keys_for_node "$i"; done
}

main "$@"

