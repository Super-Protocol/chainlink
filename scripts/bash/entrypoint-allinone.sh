#!/usr/bin/env bash
set -euo pipefail

log() { echo "[s6-init] $*"; }

CONFIG_JSON_PATH="/sp/configurations/configuration.json"

if [ ! -f "$CONFIG_JSON_PATH" ]; then
  log "ERROR: Configuration file not found at $CONFIG_JSON_PATH"
  exit 1
fi

echo "Configuration JSON: "
cat $CONFIG_JSON_PATH

export ALL_IN_ONE="true"

TOTAL_NODES=$(jq -r '.solution.totalNodes' "$CONFIG_JSON_PATH")
if ! [[ "$TOTAL_NODES" =~ ^[0-9]+$ ]] || [ "$TOTAL_NODES" -lt 1 ]; then
  log "ERROR: Invalid 'totalNodes': '$TOTAL_NODES'"
  exit 1
fi
log "Found 'totalNodes': $TOTAL_NODES. Generating s6 services..."

# Export for downstream init scripts/services
export TOTAL_NODES
export PGDATA=/sp/postgresql/data
export POSTGRES_USER=postgres
export PRICE_AGGREGATOR_PORT=$(jq -r '.solution.priceAggregatorConfig.port' "$CONFIG_JSON_PATH")

# Validate PRICE_AGGREGATOR_PORT
if [ -z "$PRICE_AGGREGATOR_PORT" ] || [ "$PRICE_AGGREGATOR_PORT" = "null" ]; then
  log "ERROR: Missing 'priceAggregatorConfig.port' in configuration"
  exit 1
fi
if ! [[ "$PRICE_AGGREGATOR_PORT" =~ ^[0-9]+$ ]]; then
  log "ERROR: PRICE_AGGREGATOR_PORT must be an integer: '$PRICE_AGGREGATOR_PORT'"
  exit 1
fi
if [ "$PRICE_AGGREGATOR_PORT" -lt 1 ] || [ "$PRICE_AGGREGATOR_PORT" -gt 65535 ]; then
  log "ERROR: PRICE_AGGREGATOR_PORT out of range (1-65535): '$PRICE_AGGREGATOR_PORT'"
  exit 1
fi

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
#!/command/with-contenv bash
set -euo pipefail
mkdir -p /root/node-${i}
mkdir -p /root/node-${i}/.cache
export HOME=/root/node-${i}
export XDG_CACHE_HOME=/root/node-${i}/.cache
export ALL_IN_ONE="true"
export NODE_NUMBER=${i}
export CHAINLINK_ROOT=/chainlink
export NODE_ROOT_DIR=/chainlink/node-${i}
export CHAINLINK_WEB_SERVER_HTTP_PORT=${API_PORT}
export API_PORT=${API_PORT}
export P2P_PORT=${P2P_PORT}
export PRICE_AGGREGATOR_PORT=${PRICE_AGGREGATOR_PORT}
export CONFIGURATION_PUBLIC_KEY="\${CONFIGURATION_PUBLIC_KEY}"
cd /scripts
exec node index.js
EOF
  chmod +x "$svc_dir/run"

  # Generate finish script to stop container after repeated failures
  cat > "$svc_dir/finish" <<EOF
#!/usr/bin/env bash
set -eu

# Fixed service name using node index from generator time
SERVICE_NAME="chainlink-node-${i}"

STATE_DIR="/run/\${SERVICE_NAME}"
COUNT_FILE="\${STATE_DIR}/restart-count"
MAX_RESTARTS="\${MAX_RESTARTS:-3}"

exit_code="\${1:-0}"
signal="\${2:-0}"
if [ "\$exit_code" -eq 0 ] && [ "\$signal" -eq 0 ]; then
  echo "[\${SERVICE_NAME}] clean exit; not counting as crash"
  exit 0
fi

mkdir -p "\$STATE_DIR"
count=\$(cat "\$COUNT_FILE" 2>/dev/null || echo 0)
count=\$((count+1))
echo "\$count" > "\$COUNT_FILE"

echo "[\${SERVICE_NAME}] crash count: \$count/\${MAX_RESTARTS}"

if [ "\$count" -ge "\$MAX_RESTARTS" ]; then
  echo "[\${SERVICE_NAME}] too many failures, terminating supervision tree"
  # Ask s6-svscan (PID 1) to exit; this will stop the container
  s6-svscanctl -t /run/service || true
fi

exit 0
EOF
  chmod +x "$svc_dir/finish"
done

log "s6 service generation complete."
