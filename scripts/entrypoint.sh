#!/usr/bin/env bash
set -euo pipefail

# Ensure Chainlink node stays PID 1. If present, run publisher in background.
# Bootstrap nodes write their P2P details to shared secrets for workers
if [ -x "/init-chainlink.sh" ]; then
  /init-chainlink.sh || true
fi
if [ -x "/publish-jobs.sh" ]; then
  nohup /publish-jobs.sh >/proc/1/fd/1 2>/proc/1/fd/2 &
fi

if [ -f "/chainlink/apicredentials" ]; then
  chmod 600 /chainlink/apicredentials || true
  export CL_ADMIN_CREDENTIALS_FILE="/chainlink/apicredentials"
fi

cd /chainlink || exit 1
exec chainlink node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start -a /chainlink/apicredentials
