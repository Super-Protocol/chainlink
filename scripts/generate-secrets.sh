#!/usr/bin/env bash
set -euo pipefail

# Generates per-node secrets and config into shared directory

SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"
OUT_ROOT="$SP_SECRETS_DIR/cl-secrets"
SCRIPTS_DIR="/scripts/secrets"

log() { echo "[gen] $*"; }

ensure_node() { command -v node >/dev/null 2>&1 || { log "node is not available"; return 1; }; }

gen_keys_for_node() {
  local node_num="$1"; local out_dir="$OUT_ROOT/$node_num"; mkdir -p "$out_dir"
  local evm_file="$out_dir/evm_key.json" p2p_file="$out_dir/p2p_key.json" ocr_file="$out_dir/ocr_key.json"
  local need_evm need_p2p need_ocr any_missing=false
  [[ -s "$evm_file" ]] || need_evm=true
  [[ -s "$p2p_file" ]] || need_p2p=true
  [[ -s "$ocr_file" ]] || need_ocr=true
  if [[ ${need_evm:-false} == true || ${need_p2p:-false} == true || ${need_ocr:-false} == true ]]; then any_missing=true; fi
  if [[ "$any_missing" == true ]]; then
    # Ensure raw keys exist
    if [[ ! -s "$out_dir/keys-raw.json" ]]; then
      node "$SCRIPTS_DIR/gen-keys.js" "$out_dir/keys-raw.json"
    fi
    # Generate into a temp directory, then copy only missing files
    local tmp; tmp=$(mktemp -d)
    pushd "$tmp" >/dev/null
    KEY_PASSWORD="${CHAINLINK_KEYSTORE_PASSWORD:-export}" \
    OCR_PASSWORD="${OCR_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" \
    P2P_PASSWORD="${P2P_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" \
    EVM_PASSWORD="${EVM_EXPORT_PASSWORD:-${CHAINLINK_KEYSTORE_PASSWORD:-export}}" \
    node "$SCRIPTS_DIR/build-secrets.js" "$out_dir/keys-raw.json"
    popd >/dev/null
    if [[ ${need_evm:-false} == true && -s "$tmp/evm_key.json" ]]; then
      install -m 600 -D "$tmp/evm_key.json" "$evm_file" || true
    fi
    if [[ ${need_p2p:-false} == true && -s "$tmp/p2p_key.json" ]]; then
      install -m 600 -D "$tmp/p2p_key.json" "$p2p_file" || true
    fi
    if [[ ${need_ocr:-false} == true && -s "$tmp/ocr_key.json" ]]; then
      install -m 600 -D "$tmp/ocr_key.json" "$ocr_file" || true
    fi
    rm -rf "$tmp" || true
    log "generated missing keys for node ${node_num} at ${out_dir}"
  else
    log "keys already present for node ${node_num}; skipping"
  fi
}

read_peer_id_for_node() {
  local node_num="$1"; local f="$OUT_ROOT/$node_num/p2p_key.json"
  if [[ -s "$f" ]]; then
    # Try to parse peerID; remove p2p_ prefix if present
    local pid
    pid=$(sed -n 's/.*"peerID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -n1)
    [[ -z "$pid" ]] && pid=$(sed -n 's/.*"peerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -n1)
    pid=${pid#p2p_}
    echo "$pid"
  fi
}

default_bootstrappers_for_node() {
  local node_num="$1"; local bs_env="${BOOTSTRAP_NODES:-1}"; local IFS=' ,\t'; read -r -a bs_nodes <<< "$bs_env"
  local entries=()
  local bn
  # if current node is bootstrap, return []
  for bn in "${bs_nodes[@]}"; do if [[ "$bn" == "$node_num" ]]; then echo "[]"; return; fi; done
  for bn in "${bs_nodes[@]}"; do
    local peer ip
    peer=$(read_peer_id_for_node "$bn")
    ip="10.5.0.$((8 + bn))"
    if [[ -n "$peer" ]]; then entries+=("'${peer}@${ip}:9999'"); fi
  done
  if [[ ${#entries[@]} -eq 0 ]]; then echo "[]"; else printf "[%s]\n" "$(IFS=,; echo "${entries[*]}")"; fi
}


main() {
  ensure_node
  mkdir -p "$OUT_ROOT"
  local total_nodes="${TOTAL_NODES:-5}"; local i
  # 1) Generate keys for all nodes
  for i in $(seq 1 "$total_nodes"); do gen_keys_for_node "$i"; done
}

main "$@"

