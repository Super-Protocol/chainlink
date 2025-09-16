#!/bin/bash
set -m # Enable Job Control

# The total number of nodes to launch.
# This can be overridden by setting the NODE_COUNT environment variable,
# for example: docker run -e NODE_COUNT=3 ...
NODE_COUNT=${NODE_COUNT:-5}

log() { echo "[all-in-one-entrypoint] $*"; }

# --- 1. Start PostgreSQL in the background ---
log "Starting PostgreSQL manager..."
/scripts/bash/all-in-one/postgres-manager.sh &

# Give it a moment to initialize and start up
log "Waiting for PostgreSQL to initialize..."
sleep 10

# --- 2. Launch Chainlink Nodes ---
log "Starting $NODE_COUNT Chainlink nodes..."

for i in $(seq 1 ${NODE_COUNT})
do
  log "--> Preparing and launching node #$i"

  (
    export NODE_NUMBER=$i
    export BASH_ENTRYPOINT_PATH="/scripts/bash/all-in-one/chainlink-starter.sh"

    node /scripts/index.js

  ) &

  sleep 2
done


# --- 3. Keep the container alive ---
log "All nodes have been launched. Container is running."

# Wait for any background process to exit. If any node or postgres fails,
# the container will stop.
wait -n
exit $?
