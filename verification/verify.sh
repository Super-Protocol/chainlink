#!/usr/bin/env bash

set -euo pipefail

CHILD_PID=""
on_int() {
  echo "" >&2
  echo "Received Ctrl+C, forwarding to child..." >&2
  if [[ -n "${CHILD_PID:-}" ]]; then
    # Send to process group and directly to pid as fallback
    kill -INT -"$CHILD_PID" 2>/dev/null || true
    kill -INT "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  exit 130
}
on_term() {
  echo "" >&2
  echo "Termination requested, forwarding to child..." >&2
  if [[ -n "${CHILD_PID:-}" ]]; then
    kill -TERM -"$CHILD_PID" 2>/dev/null || true
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  exit 143
}
trap on_int INT
trap on_term TERM

run_with_trap() {
  "$@" &
  CHILD_PID=$!
  wait "$CHILD_PID"
  local rc=$?
  CHILD_PID=""
  return $rc
}

# Automated verification script
# - Downloads latest spctl for your OS/arch
# - Creates config.json with a fresh private key
# - Downloads image via spctl files download using verification/resource.json
# - Computes SHA-256 of the image
# - Fetches order report and compares three hashes: resource.json, local shasum, order report
#
# Usage:
#   ./verify.sh [RESOURCE_JSON] [ORDER_ID]
# Defaults:
#   RESOURCE_JSON: verification/resource.json (sibling of this script)
#   ORDER_ID: read from resource.json (.orderId)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Allow calling either with no args, with just resource.json, or with resource.json + orderId
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  RESOURCE_JSON="$SCRIPT_DIR/resource.json"
  ORDER_ID="$1"
else
  RESOURCE_JSON="${1:-$SCRIPT_DIR/resource.json}"
  ORDER_ID="${2:-}"
fi

need_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required dependency '$1' is not installed." >&2
    case "$1" in
      jq)
        echo "Install jq, e.g. on macOS: brew install jq; on Linux: apt-get install -y jq or yum install -y jq" >&2 ;;
      curl)
        echo "Install curl via your package manager." >&2 ;;
      shasum)
        echo "Install Perl Digest::SHA utilities or use 'sha256sum' and adapt the script." >&2 ;;
      openssl)
        echo "Install OpenSSL via your package manager." >&2 ;;
    esac
    exit 1
  fi
}

need_bin curl
need_bin jq
need_bin shasum
need_bin openssl

if [[ ! -f "$RESOURCE_JSON" ]]; then
  echo "Error: resource.json not found at: $RESOURCE_JSON" >&2
  exit 1
fi

echo "==> Downloading spctl (Super Protocol CLI)"
SPCTL_BIN="$SCRIPT_DIR/spctl"
if [[ ! -x "$SPCTL_BIN" ]]; then
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux) os_id="linux" ;;
    Darwin) os_id="macos" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64) arch_id="x64" ;;
    arm64|aarch64) arch_id="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac

  SPCTL_URL="${SPCTL_URL:-https://github.com/Super-Protocol/ctl/releases/latest/download/spctl-${os_id}-${arch_id}}"
  echo "    URL: $SPCTL_URL"
  curl -fsSL "$SPCTL_URL" -o "$SPCTL_BIN"
  chmod +x "$SPCTL_BIN"
else
  echo "    Using existing spctl at $SPCTL_BIN"
fi

echo "==> Creating config.json with a fresh private key"
PRIV_KEY_HEX="$(openssl rand -hex 32)"
cat > "$SCRIPT_DIR/config.json" <<JSON
{
  "backend": {
    "url": "https://bff.superprotocol.com/graphql",
    "accessToken": "eyJhbGciOiJFUzI1NiJ9.eyJhZGRyZXNzIjoiMHhBN0E5NjQ4ZGE2QTg5QjBhNzFhNGMwRDQ2Y2FENDAwMDU3ODI3NGEyIiwiaWF0IjoxNjc5OTk4OTQyLCJleHAiOjE3NDMxMTQxNDJ9.x2lx90D733mToYYdOWhh4hhXn3YowFW4JxFjDFtI7helgp2uqekDHFgekT5yjbBWeHTzRap7SHbDC3VvMIDe0g"
  },
  "blockchain": {
    "rpcUrl": "https://opbnb.superprotocol.com",
    "smartContractAddress": "0x3C69ea105Fc716C1Dcb41859281Aa817D0A0B279",
    "accountPrivateKey": "0x${PRIV_KEY_HEX}"
  },
  "storage": {
    "type": "STORJ",
    "bucket": "",
    "prefix": "",
    "writeAccessToken": "",
    "readAccessToken": ""
  },
  "workflow": {
    "resultEncryption": {
      "algo": "ECIES",
      "key": "",
      "encoding": "base64"
    }
  }
}
JSON

echo "==> Reading expected values from resource.json"
EXPECTED_HASH="$(jq -r '.hash.hash' "$RESOURCE_JSON" | tr '[:upper:]' '[:lower:]')"
EXPECTED_ENCRYPTED_PATH="$(jq -r '.resource.filepath' "$RESOURCE_JSON")"
EXPECTED_BASE_NAME="$(basename "$EXPECTED_ENCRYPTED_PATH")"
if [[ "$EXPECTED_BASE_NAME" == *.encrypted ]]; then
  EXPECTED_FILE_NAME="${EXPECTED_BASE_NAME%.encrypted}"
else
  EXPECTED_FILE_NAME="$EXPECTED_BASE_NAME"
fi

IMAGE_PATH="$SCRIPT_DIR/$EXPECTED_FILE_NAME"
if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "==> Image not found locally, downloading via spctl files download"
  OLDPWD_SAVE="$(pwd)"
  cd "$SCRIPT_DIR"
  if ! run_with_trap "$SPCTL_BIN" files download "$RESOURCE_JSON" .; then
    echo "Error: spctl files download failed" >&2
    cd "$OLDPWD_SAVE"; exit 1
  fi
  cd "$OLDPWD_SAVE"
  # After download, re-evaluate IMAGE_PATH or fallback to any .tar.gz
  if [[ ! -f "$IMAGE_PATH" ]]; then
    CANDIDATE=$(ls -1 "$SCRIPT_DIR"/*.tar.gz 2>/dev/null | head -n1 || true)
    if [[ -n "${CANDIDATE:-}" && -f "$CANDIDATE" ]]; then
      IMAGE_PATH="$CANDIDATE"
      echo "    Expected file not found; using found image: $(basename "$IMAGE_PATH")"
    else
      echo "Error: downloaded image file not found (expected: $EXPECTED_FILE_NAME)" >&2
      exit 1
    fi
  fi
else
  echo "==> Image already exists, skipping download: $(basename "$IMAGE_PATH")"
fi

echo "==> Calculating local SHA-256 with shasum"
LOCAL_HASH="$(shasum -a 256 "$IMAGE_PATH" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
echo "    Local shasum: $LOCAL_HASH"
echo "    Resource hash: $EXPECTED_HASH"

if [[ -z "$ORDER_ID" ]]; then
  echo "==> Reading orderId from resource.json"
  ORDER_ID="$(jq -r '.orderId // empty' "$RESOURCE_JSON")"
  if [[ -z "$ORDER_ID" ]]; then
    echo "Error: orderId is not provided and not found in $RESOURCE_JSON (.orderId)." >&2
    exit 1
  fi
fi

echo "==> Fetching order report for order $ORDER_ID"
REPORT_JSON="order-report.$ORDER_ID.json"
OLDPWD_SAVE="$(pwd)"; cd "$SCRIPT_DIR"
if ! run_with_trap "$SPCTL_BIN" orders get-report "$ORDER_ID" --save-to "$REPORT_JSON"; then
  echo "Error: spctl orders get-report failed" >&2
  cd "$OLDPWD_SAVE"; exit 1
fi
cd "$OLDPWD_SAVE"

# Extract image hash from report
REPORT_HASH="$(jq -r '.workloadInfo.runtimeInfo[] | select(.type=="Image") | .hash.hash' "$SCRIPT_DIR/$REPORT_JSON" | head -n1 | tr '[:upper:]' '[:lower:]')"
echo "    Report image hash: $REPORT_HASH"

ALL_OK=true

if [[ -z "$EXPECTED_HASH" || -z "$LOCAL_HASH" || -z "$REPORT_HASH" ]]; then
  echo "Error: One or more hashes are empty. Cannot validate." >&2
  ALL_OK=false
fi

if [[ "$EXPECTED_HASH" != "$LOCAL_HASH" ]]; then
  echo "Mismatch: resource.json hash != local shasum" >&2
  ALL_OK=false
fi

if [[ "$EXPECTED_HASH" != "$REPORT_HASH" ]]; then
  echo "Mismatch: resource.json hash != order report hash" >&2
  ALL_OK=false
fi

echo "==> Hashes summary"
echo "    resource.json: $EXPECTED_HASH"
echo "    local shasum : $LOCAL_HASH"
echo "    order report : $REPORT_HASH"

if [[ "$ALL_OK" == true ]]; then
  echo "Validation result: OK"
  exit 0
else
  echo "Validation result: FAIL" >&2
  exit 1
fi
