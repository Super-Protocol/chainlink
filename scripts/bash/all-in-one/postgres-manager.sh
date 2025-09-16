#!/usr/bin/env bash
set -euo pipefail

log() { echo "[postgres-manager] $*"; }

PGDATA_DIR="${PGDATA:-/var/lib/postgresql/data}"
PGPORT="${PGPORT:-5432}"
DB_SUPERUSER="postgres"
APP_DB="${PGDATABASE:-chainlink_node}"
APP_DB_USER="${PGUSER:-chainlink}"
APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"

mkdir -p "$PGDATA_DIR"
chown -R postgres:postgres "${PGDATA_DIR}" /var/lib/postgresql

init_db_if_needed() {
  if [[ ! -f "${PGDATA_DIR}/PG_VERSION" ]]; then
    log "Initializing postgres data directory: ${PGDATA_DIR}"
    su -s /bin/bash -c "initdb -D '${PGDATA_DIR}' -U ${DB_SUPERUSER} -A trust" postgres
  fi
}

start_postgres() {
  log "Starting postgres on 127.0.0.1:${PGPORT}"
  su -s /bin/bash -c "postgres -D '${PGDATA_DIR}' -c listen_addresses=127.0.0.1 -p ${PGPORT}" postgres &
}

wait_postgres() {
  log "Waiting for postgres to be ready..."
  for i in {1..120}; do
    if pg_isready -h 127.0.0.1 -p "${PGPORT}" >/dev/null 2>&1; then
      log "Postgres is ready!"
      return 0
    fi
    sleep 1
  done
  log "Postgres did not start in time."
  return 1
}

ensure_app_db() {
  log "Ensuring database and user exist..."
  su -s /bin/bash -c "psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -v ON_ERROR_STOP=1 -tc \"SELECT 1 FROM pg_roles WHERE rolname='${APP_DB_USER}'\" | grep -q 1 || psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -c \"CREATE USER \"\"${APP_DB_USER}\"\" WITH PASSWORD '\"\"${APP_DB_PASS}\"\"';\"" postgres
  su -s /bin/bash -c "psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -v ON_ERROR_STOP=1 -tc \"SELECT 1 FROM pg_database WHERE datname='${APP_DB}'\" | grep -q 1 || psql -h 127.0.0.1 -p ${PGPORT} -U ${DB_SUPERUSER} -d postgres -c \"CREATE DATABASE \"\"${APP_DB}\"\" OWNER \"\"${APP_DB_USER}\"\";\"" postgres
}

init_db_if_needed
start_postgres
wait_postgres
ensure_app_db

log "PostgreSQL has been started and configured."
