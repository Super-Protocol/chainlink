#!/bin/bash
set -euo pipefail

log() { echo "[entrypoint] $*"; }

CONFIG_JSON_PATH="/sp/configurations/configuration.json"
SUPERVISOR_CONF_PATH="/etc/supervisor/supervisord.conf"

# 1. Считываем количество нод из вашего configuration.json
if [ ! -f "$CONFIG_JSON_PATH" ]; then
    log "ERROR: Configuration file not found at $CONFIG_JSON_PATH"
    exit 1
fi
TOTAL_NODES=$(jq -r '.solution.totalNodes' "$CONFIG_JSON_PATH")

if ! [[ "$TOTAL_NODES" =~ ^[0-9]+$ ]] || [ "$TOTAL_NODES" -lt 1 ]; then
    log "ERROR: Invalid 'totalNodes' value in configuration: '$TOTAL_NODES'. Must be a positive integer."
    exit 1
fi
log "Found 'totalNodes': $TOTAL_NODES. Generating supervisor configuration..."

# 2. Генерируем supervisord.conf
# Статическая часть
cat > "$SUPERVISOR_CONF_PATH" <<EOF
[supervisord]
nodaemon=true
user=root
logfile=/dev/null
logfile_maxbytes=0

[program:postgres]
command=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/data
user=postgres
autostart=true
autorestart=true
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

EOF

for i in $(seq 1 "$TOTAL_NODES"); do
    API_PORT=$((6688 + $i - 1))
    P2P_PORT=$((9990 + $i))
    P2P_V2_PORT=$((8000 + $i))

    cat >> "$SUPERVISOR_CONF_PATH" <<EOF
[program:chainlink-node-${i}]
command=bash -c "cd /scripts && npm run start"
environment=NODE_NUMBER="${i}",PGDATABASE="chainlink_node_${i}",CHAINLINK_ROOT="/chainlink/node-${i}",MANAGE_POSTGRES="false",CHAINLINK_WEB_SERVER_HTTP_PORT="${API_PORT}"
autostart=true
autorestart=true
priority=100
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
user=root
directory=/

EOF
done

log "Successfully generated supervisor config for $TOTAL_NODES nodes."

# 3. Запускаем инициализацию БД, передав ей количество нод
export PGDATA=/var/lib/postgresql/data
export POSTGRES_USER=postgres
/scripts/bash/init-db.sh "$TOTAL_NODES"

# 4. Запускаем Supervisor
log "Starting supervisord..."
exec /usr/bin/supervisord -n -c "$SUPERVISOR_CONF_PATH"

