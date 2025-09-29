#!/bin/bash
set -euo pipefail

log() { echo "[init-db] $*"; }

# Variables from env, can be overridden
POSTGRES_USER="${POSTGRES_USER:-postgres}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
APP_DB_USER="${PGUSER:-chainlink}"
APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"
TOTAL_NODES="${TOTAL_NODES:-5}"

bootstrap() {
  # Ensure data dir exists and owned by postgres
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA" || true

  # Initialize the database cluster if empty
  if [ -z "$(ls -A "$PGDATA" 2>/dev/null || true)" ]; then
    log "Initializing PostgreSQL database as user 'postgres'..."
    # Enable data checksums for early corruption detection on ephemeral storage
    su - postgres -c "initdb -D \"$PGDATA\" --username=\"$POSTGRES_USER\" --data-checksums"
  fi

  # Apply recommended config for ephemeral, cache-only usage (idempotent)
  if ! grep -q "^# BEGIN chainlink-ephemeral-config$" "$PGDATA/postgresql.conf" 2>/dev/null; then
    log "Applying recommended PostgreSQL config for ephemeral cache..."
    su - postgres -c "cat >> \"$PGDATA/postgresql.conf\" <<'EOF'
# BEGIN chainlink-ephemeral-config
# Crash-safety and bounded WAL growth on ephemeral/overlay storage
fsync = on
full_page_writes = on
synchronous_commit = on
wal_level = minimal
archive_mode = off
wal_keep_size = 0
max_wal_size = 256MB
min_wal_size = 64MB
checkpoint_timeout = 5min
checkpoint_completion_target = 0.9
shared_buffers = 128MB
autovacuum = on
# Disable streaming/slots for cache-only use
max_wal_senders = 0
max_replication_slots = 0
# END chainlink-ephemeral-config
EOF"
  fi
}

wait_ready() {
  until su - postgres -c "pg_isready -h localhost -p 5432 -U \"$POSTGRES_USER\""; do
    log "Waiting for PostgreSQL to start..."
    sleep 1
  done
  log "PostgreSQL is ready."
}

provision() {
  # Creating the user for Chainlink nodes, if it doesn't exist
  if ! su - postgres -c "psql -t -c \"SELECT 1 FROM pg_roles WHERE rolname='$APP_DB_USER'\"" | grep -q 1; then
    log "Creating user $APP_DB_USER..."
    su - postgres -c "psql -c \"CREATE USER \\\"$APP_DB_USER\\\" WITH PASSWORD '$APP_DB_PASS';\""
  else
    log "User $APP_DB_USER already exists."
  fi

  # Creating databases for each node
  for i in $(seq 1 "$TOTAL_NODES"); do
    DB_NAME="${PGDATABASE:-chainlink_node}_${i}"
    if su - postgres -c "psql -lqt | cut -d \| -f 1 | grep -qw \"$DB_NAME\""; then
      log "Database $DB_NAME already exists."
    else
      log "Creating database $DB_NAME..."
      su - postgres -c "createdb -O \"$APP_DB_USER\" \"$DB_NAME\""
    fi
  done
}

full_cycle() {
  bootstrap
  log "Starting temporary PostgreSQL server as user 'postgres'..."
  su - postgres -c "postgres -D \"$PGDATA\"" &
  local pid="$!"
  wait_ready
  provision
  log "Stopping temporary PostgreSQL server..."
  kill -SIGINT "$pid"
  wait "$pid" || true
  log "PostgreSQL initialization complete."
}

case "${1:-full}" in
  bootstrap)
    bootstrap
    ;;
  provision)
    wait_ready
    provision
    ;;
  full|*)
    full_cycle
    ;;
esac
