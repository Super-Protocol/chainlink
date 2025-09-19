#!/usr/bin/env bash
set -euo pipefail

log() { echo "[s6-init] $*"; }

CONFIG_JSON_PATH="/sp/configurations/configuration.json"

echo "Configuration JSON: "
cat $CONFIG_JSON_PATH

export ALL_IN_ONE="true"

if [ ! -f "$CONFIG_JSON_PATH" ]; then
  log "ERROR: Configuration file not found at $CONFIG_JSON_PATH"
  exit 1
fi

TOTAL_NODES=$(jq -r '.solution.totalNodes' "$CONFIG_JSON_PATH")
if ! [[ "$TOTAL_NODES" =~ ^[0-9]+$ ]] || [ "$TOTAL_NODES" -lt 1 ]; then
  log "ERROR: Invalid 'totalNodes': '$TOTAL_NODES'"
  exit 1
fi
log "Found 'totalNodes': $TOTAL_NODES. Generating s6 services..."

# Export for downstream init scripts/services
export TOTAL_NODES
export PGDATA=/var/lib/postgresql/data
export POSTGRES_USER=postgres

# Initialize data dir (idempotent)
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA" || true

# Generate per-node environment for s6 chainlink-node service instances
# s6 v3 supports multiple instances via copies; here we export expected env vars
BASE_API_PORT="${BASE_API_PORT:-6600}"
for i in $(seq 1 "$TOTAL_NODES"); do
  API_PORT=$((BASE_API_PORT + i))
  P2P_PORT=$((9900 + i))
  svc_dir="/etc/services.d/chainlink-node-${i}"
  mkdir -p "$svc_dir"
  cat > "$svc_dir/run" <<EOF
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /root/node-${i}
mkdir -p /root/node-${i}/.cache
export HOME=/root/node-${i}
export XDG_CACHE_HOME=/root/node-${i}/.cache
export ALL_IN_ONE="true"
export NODE_NUMBER=${i}
export CHAINLINK_ROOT=/chainlink
export NODE_ROOT_DIR=/chainlink/node-${i}
export MANAGE_POSTGRES=false
export CHAINLINK_WEB_SERVER_HTTP_PORT=${API_PORT}
export API_PORT=${API_PORT}
export P2P_PORT=${P2P_PORT}
export CONFIGURATION_PUBLIC_KEY="MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE1mXRd/v32RmPknpTnasAa3b5G31lbOUwMV4cQK/GU8WHySSvJj1MSCsdwhGggGoroMD2Qp/Ql2UOAiGvDRDmGw=="
export CHAINLINK_EMAIL=admin@example.com
export CHAINLINK_PASSWORD=yoursuperpassword
cd /scripts
exec node index.js
EOF
  chmod +x "$svc_dir/run"
done

log "s6 service generation complete."
