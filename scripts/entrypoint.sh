#!/usr/bin/env bash
set -euo pipefail

log() { echo "[entrypoint] $*"; }

# Postgres settings
PGDATA_DIR="${PGDATA:-/var/lib/postgresql/data}"
PGPORT="${PGPORT:-5432}"

DB_SUPERUSER="postgres"
APP_DB="${PGDATABASE:-chainlink_node}"
APP_DB_USER="${PGUSER:-chainlink}"
APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"

if [ -z "${BOOTSTRAP_NODE_ADDRESSES}" ]; then
  log "BOOTSTRAP_NODE_ADDRESSES env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_NODE_NAME}" ]; then
  log "CHAINLINK_NODE_NAME env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_RPC_WS_URL}" ]; then
  log "CHAINLINK_RPC_WS_URL env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_RPC_HTTP_URL}" ]; then
  log "CHAINLINK_RPC_HTTP_URL env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_CHAIN_ID}" ]; then
  log "CHAINLINK_CHAIN_ID env var is required" >&2
  exit 1
fi

if [ -z "$APP_DB_PASS" ] || [ ${#APP_DB_PASS} -lt 16 ]; then
  log "APP_DB_PASS is less than 16 characters"
  exit 1
fi

if [ -z "$CHAINLINK_KEYSTORE_PASSWORD" ] || [ ${#CHAINLINK_KEYSTORE_PASSWORD} -lt 16 ]; then
  log "CHAINLINK_KEYSTORE_PASSWORD is less than 16 characters"
  exit 1
fi

mkdir -p /chainlink

# Ensure ownership/dirs
mkdir -p "$PGDATA_DIR"
chown -R postgres:postgres "${PGDATA_DIR}" /var/lib/postgresql || true

init_db_if_needed() {
  if [[ ! -f "${PGDATA_DIR}/PG_VERSION" ]]; then
    log "initializing postgres data dir at ${PGDATA_DIR}"
    su -s /bin/bash -c "initdb -D '${PGDATA_DIR}' -U ${DB_SUPERUSER} -A trust" postgres
  fi
}

start_postgres() {
  log "starting postgres on 127.0.0.1:${PGPORT}"
  # Run postgres as postgres user, listening only on localhost
  su -s /bin/bash -c "postgres -D '${PGDATA_DIR}' -c listen_addresses=127.0.0.1 -p ${PGPORT}" postgres &
  PG_PID=$!
}

wait_postgres() {
  log "waiting for postgres to be healthy"
  for i in {1..120}; do
    if pg_isready -h 127.0.0.1 -p "${PGPORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  log "postgres did not become healthy in time"
  return 1
}

ensure_app_db() {
  log "ensuring database/user exist"
  # Create user if missing
  su -s /bin/bash -c "psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -v ON_ERROR_STOP=1 -tc \"SELECT 1 FROM pg_roles WHERE rolname='${APP_DB_USER}'\" | grep -q 1 || psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -c \"CREATE USER \"\"${APP_DB_USER}\"\" WITH PASSWORD '\"\"${APP_DB_PASS}\"\"';\"" postgres
  # Create DB if missing and grant
  su -s /bin/bash -c "psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -v ON_ERROR_STOP=1 -tc \"SELECT 1 FROM pg_database WHERE datname='${APP_DB}'\" | grep -q 1 || psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -c \"CREATE DATABASE \"\"${APP_DB}\"\" OWNER \"\"${APP_DB_USER}\"\";\"" postgres
}

generate_secrets() {
  local dst="/chainlink/secrets.toml"
  local url="postgresql://${APP_DB_USER}:${APP_DB_PASS}@127.0.0.1:${PGPORT}/${APP_DB}?sslmode=disable"
  umask 077
  cat > "$dst" <<EOF
[Password]
Keystore = '${CHAINLINK_KEYSTORE_PASSWORD}'
[Database]
URL = '${url}'
EOF
  chmod 600 "$dst" || true
  log "(re)generated ${dst}"
}

start_chainlink() {
  log "starting Chainlink entrypoint"
  /scripts/chainlink-entrypoint.sh &
  CL_PID=$!
}

shutdown_all() {
  log "shutting down (signal caught)"
  # Try to stop chainlink first, then postgres
  if kill -0 ${CL_PID:-0} 2>/dev/null; then
    kill ${CL_PID} || true
  fi
  if kill -0 ${PG_PID:-0} 2>/dev/null; then
    kill ${PG_PID} || true
  fi
  # Give a moment and force kill if needed
  sleep 2
  kill -9 ${CL_PID:-0} 2>/dev/null || true
  kill -9 ${PG_PID:-0} 2>/dev/null || true
}

trap shutdown_all SIGINT SIGTERM

# Boot sequence
init_db_if_needed
start_postgres
wait_postgres
ensure_app_db
generate_secrets
start_chainlink

# Monitor both processes; if any exits, stop the other and exit non-zero
while true; do
  # Handle requested chainlink restarts
  if [ -f /tmp/restart-chainlink ]; then
    log "restart requested for chainlink"
    rm -f /tmp/restart-chainlink || true
    if kill -0 ${CL_PID} 2>/dev/null; then
      kill ${CL_PID} || true
      wait ${CL_PID} 2>/dev/null || true
    fi
    start_chainlink
  fi
  if ! kill -0 ${PG_PID} 2>/dev/null; then
    log "postgres exited"
    if kill -0 ${CL_PID} 2>/dev/null; then kill ${CL_PID} || true; fi
    wait ${CL_PID} 2>/dev/null || true
    exit 1
  fi
  if ! kill -0 ${CL_PID} 2>/dev/null; then
    log "chainlink exited"
    if kill -0 ${PG_PID} 2>/dev/null; then kill ${PG_PID} || true; fi
    wait ${PG_PID} 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
