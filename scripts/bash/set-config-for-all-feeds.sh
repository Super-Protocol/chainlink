#!/usr/bin/env bash
set -euo pipefail

cd $(dirname $0)

# This wrapper now delegates to a JS implementation which uses @super-protocol/sdk-js
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_JS="${SCRIPT_DIR}/../secrets/set-config-for-all-feeds.js"

if [[ ! -f "${RUNNER_JS}" ]]; then
  echo "Runner script not found: ${RUNNER_JS}" >&2
  exit 1
fi

node "${RUNNER_JS}"
