#!/usr/bin/env bash
set -euo pipefail

cd $(dirname $0)

log() { echo "[entrypoint] $*"; }

# Postgres settings
export PGDATA_DIR="${PGDATA:-/var/lib/postgresql/data}"
export PGPORT="${PGPORT:-5432}"

export DB_SUPERUSER="postgres"
export APP_DB="${PGDATABASE:-chainlink_node}_${NODE_NUMBER}"
export APP_DB_USER="${PGUSER:-chainlink}"
export APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"

export CHAINLINK_ROOT="${CHAINLINK_ROOT:-/chainlink}"
export NODE_ROOT_DIR="${CHAINLINK_ROOT:-/chainlink}/node-${NODE_NUMBER}"
export TMP_DIR="/tmp/node-${NODE_NUMBER}"
export SP_SECRETS_DIR="${SP_SECRETS_DIR:-/sp/secrets}"

# Derive BOOTSTRAP_NODE_ADDRESSES if not provided
IFS=' ' read -r -a bs_nodes <<< "${BOOTSTRAP_NODES:-}"
if [ ${#bs_nodes[@]} -gt 0 ]; then
  addresses=()
  for bn in "${bs_nodes[@]}"; do
    [ -z "$bn" ] && continue
    if [ "${ALL_IN_ONE:-}" = "true" ]; then
      base="${BOOTSTRAP_P2P_PORT_BASE:-9900}"
      host="127.0.0.1"
      port=$((base + bn))
    else
      host_file="${SP_SECRETS_DIR}/bootstrap-${bn}.ip"
      if [ -s "$host_file" ]; then
        host=$(sed -n '1p' "$host_file")
      else
        host="10.5.0.$((8 + bn))"
      fi
      port="9999"
    fi
    addresses+=("${host}:${port}")
  done
  if [ ${#addresses[@]} -gt 0 ]; then
    BOOTSTRAP_NODE_ADDRESSES=$(IFS=','; echo "${addresses[*]}")
    export BOOTSTRAP_NODE_ADDRESSES
    log "computed BOOTSTRAP_NODE_ADDRESSES=${BOOTSTRAP_NODE_ADDRESSES}"
  fi
fi

mkdir -p "$TMP_DIR"

if [ -z "${BOOTSTRAP_NODE_ADDRESSES:-}" ]; then
  log "BOOTSTRAP_NODE_ADDRESSES env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_NODE_NAME:-}" ]; then
  log "CHAINLINK_NODE_NAME env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_RPC_WS_URL:-}" ]; then
  log "CHAINLINK_RPC_WS_URL env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_RPC_HTTP_URL:-}" ]; then
  log "CHAINLINK_RPC_HTTP_URL env var is required" >&2
  exit 1
fi

if [ -z "${CHAINLINK_CHAIN_ID:-}" ]; then
  log "CHAINLINK_CHAIN_ID env var is required" >&2
  exit 1
fi

if [ -z "${APP_DB_PASS:-}" ] || [ ${#APP_DB_PASS} -lt 16 ]; then
  log "APP_DB_PASS is less than 16 characters"
  exit 1
fi

if [ -z "${CHAINLINK_KEYSTORE_PASSWORD:-}" ] || [ ${#CHAINLINK_KEYSTORE_PASSWORD} -lt 16 ]; then
  log "CHAINLINK_KEYSTORE_PASSWORD is less than 16 characters"
  exit 1
fi

mkdir -p "$NODE_ROOT_DIR"

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
  local dst="${NODE_ROOT_DIR}/secrets.toml"
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
  /scripts/bash/chainlink-entrypoint.sh &
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

# Boot sequence
if [ "${MANAGE_POSTGRES:-true}" != "false" ]; then
  log "Postgres management is ENABLED."

  # Ensure ownership/dirs
  mkdir -p "$PGDATA_DIR"
  chown -R postgres:postgres "${PGDATA_DIR}" /var/lib/postgresql || true

  trap shutdown_all SIGINT SIGTERM

  # Boot sequence
  init_db_if_needed
  start_postgres
  wait_postgres
  ensure_app_db
  generate_secrets
  node scripts/secrets/balance-top-up.js
  start_chainlink

  # Monitor both processes; if any exits, stop the other and exit non-zero
  while true; do
    # Handle requested chainlink restarts
    if [ -f "$TMP_DIR/restart-chainlink" ]; then
      log "restart requested for chainlink"
      rm -f "$TMP_DIR/restart-chainlink" || true
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

else
  log "Postgres management is DISABLED. Assuming external Postgres."
  generate_secrets
  node scripts/secrets/balance-top-up.js
  start_chainlink
  log "Monitoring Chainlink process (PID: ${CL_PID}) for node ${NODE_NUMBER}..."
  while true; do
    if [ -f $TMP_DIR/restart-chainlink ]; then
      log "Restart requested for chainlink node ${NODE_NUMBER}"
      rm -f $TMP_DIR/restart-chainlink || true
      if kill -0 ${CL_PID} 2>/dev/null; then
        kill ${CL_PID} || true
        wait ${CL_PID} 2>/dev/null || true
      fi
      start_chainlink
      log "Chainlink process for node ${NODE_NUMBER} restarted. New PID: ${CL_PID}"
    fi
    if ! kill -0 ${CL_PID} 2>/dev/null; then
      log "Chainlink process for node ${NODE_NUMBER} has exited unexpectedly."
      exit 1
    fi
    sleep 2
  done
fi
