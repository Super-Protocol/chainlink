#!/usr/bin/env bash
set -euo pipefail

cd $(dirname $0)

# This script iterates over all .toml files in CL_FEED_TEMPLATES_DIR,
# extracts contractAddress, and runs scripts/secrets/set-config.js for each.

if [[ -z "${CL_FEED_TEMPLATES_DIR:-}" ]]; then
  echo "CL_FEED_TEMPLATES_DIR is required" >&2
  exit 1
fi

if [[ ! -d "${CL_FEED_TEMPLATES_DIR}" ]]; then
  echo "Directory not found: ${CL_FEED_TEMPLATES_DIR}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SET_CONFIG_JS="${SCRIPT_DIR}/../secrets/set-config.js"

if [[ ! -f "${SET_CONFIG_JS}" ]]; then
  echo "set-config.js not found at ${SET_CONFIG_JS}" >&2
  exit 1
fi

found_any=false
while IFS= read -r -d '' file; do
  found_any=true
  line=$(grep -E '^[[:space:]]*contractAddress[[:space:]]*=' "$file" | head -n1 || true)
  if [[ -z "$line" ]]; then
    echo "[skip] No contractAddress in $(basename "$file")"
    continue
  fi
  value=$(echo "$line" \
    | sed -E 's/^[[:space:]]*contractAddress[[:space:]]*=[[:space:]]*//; s/[[:space:]]+#.*$//' \
    | tr -d '"' \
    | xargs)
  if [[ -z "$value" ]]; then
    echo "[skip] Empty contractAddress in $(basename "$file")"
    continue
  fi
  if [[ "$value" == \$* ]]; then
    echo "[skip] Placeholder contractAddress ($value) in $(basename "$file")"
    continue
  fi
  if ! printf '%s' "$value" | grep -Eq '^0x[0-9a-fA-F]{40}$'; then
    echo "[skip] Invalid contractAddress '$value' in $(basename "$file")"
    continue
  fi
  echo "[run ] $(basename "$file"): contractAddress=$value"
  node "${SET_CONFIG_JS}" "$value"
done < <(find "${CL_FEED_TEMPLATES_DIR}" -maxdepth 1 -type f -name '*.toml' -print0)

if [[ "$found_any" = false ]]; then
  echo "No .toml files found in ${CL_FEED_TEMPLATES_DIR}" >&2
fi

