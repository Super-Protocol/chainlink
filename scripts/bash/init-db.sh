#!/bin/bash
set -e

TOTAL_NODES="${1:-5}" # Accepting the number of nodes from the argument, default is 5
log() { echo "[init-db] $*"; }

# Variables from env, can be overridden
POSTGRES_USER="${POSTGRES_USER:-postgres}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
APP_DB_USER="${PGUSER:-chainlink}"
APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"

# Ensure data dir exists and owned by postgres
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA" || true

# Initializing the database cluster, if the data directory is empty
if [ -z "$(ls -A "$PGDATA" 2>/dev/null || true)" ]; then
    log "Initializing PostgreSQL database as user 'postgres'..."
    su - postgres -c "initdb -D \"$PGDATA\" --username=\"$POSTGRES_USER\""
fi

# Starting Postgres in the background for executing commands
log "Starting temporary PostgreSQL server as user 'postgres'..."
su - postgres -c "postgres -D \"$PGDATA\"" &
pid="$!"

# Waiting for the server to be ready to accept connections
until su - postgres -c "pg_isready -h localhost -p 5432 -U \"$POSTGRES_USER\""; do
  log "Waiting for PostgreSQL to start..."
  sleep 1
done
log "PostgreSQL is ready."

# Creating the user for Chainlink nodes, if it doesn't exist
if ! su - postgres -c "psql -t -c \"SELECT 1 FROM pg_roles WHERE rolname='$APP_DB_USER'\"" | grep -q 1; then
    log "Creating user $APP_DB_USER..."
    su - postgres -c "psql -c \"CREATE USER \\\"$APP_DB_USER\\\" WITH PASSWORD '$APP_DB_PASS';\""
else
    log "User $APP_DB_USER already exists."
fi

# Creating databases for each node
for i in $(seq 1 "$TOTAL_NODES"); do
    DB_NAME="chainlink_node_${i}"
    if su - postgres -c "psql -lqt | cut -d \| -f 1 | grep -qw \"$DB_NAME\""; then
        log "Database $DB_NAME already exists."
    else
        log "Creating database $DB_NAME..."
        su - postgres -c "createdb -O \"$APP_DB_USER\" \"$DB_NAME\""
    fi
done

# Stopping the temporary Postgres process
log "Stopping temporary PostgreSQL server..."
kill -SIGINT "$pid"
wait "$pid" || true
log "PostgreSQL initialization complete."
