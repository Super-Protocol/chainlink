#!/bin/bash

readonly CHAINLINK_DIR="/chainlink"
readonly MIN_PASSWORD_LENGTH=16
readonly INITIALIZATION_DELAY=2

# Wait for container initialization
sleep $INITIALIZATION_DELAY

determine_node_number() {
    if [ -n "$NODE_NUMBER" ]; then
        echo "$NODE_NUMBER"
    else
        # Extract number from container name (e.g., chainlink-node-1 -> 1)
        echo "$HOSTNAME" | grep -o '[0-9]\+$' || echo "1"
    fi
}

generate_keystore_password() {
    local node_num="$1"
    local keystore_pass="${CHAINLINK_KEYSTORE_PASSWORD}${node_num}"

    # Ensure keystore password meets minimum length requirement
    if [ ${#keystore_pass} -lt $MIN_PASSWORD_LENGTH ]; then
        local padding_needed=$((MIN_PASSWORD_LENGTH - ${#keystore_pass}))
        local padding=$(printf "%0${padding_needed}d" "$node_num")
        keystore_pass="${keystore_pass}${padding}$(date +%s | tail -c 6)"
    fi

    echo "$keystore_pass"
}

create_config_files() {
    local node_num="$1"
    local keystore_pass="$2"

    # Generate config.toml
    cat > "${CHAINLINK_DIR}/config.toml" << EOF
[Log]
Level = 'warn'

[WebServer]
AllowOrigins = '*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[[EVM]]
ChainID = '${CHAINLINK_CHAIN_ID}'
LogBackfillBatchSize = 500

[[EVM.Nodes]]
Name = 'opBNB Testnet'
WSURL = '${CHAINLINK_WS_URL}'
HTTPURL = '${CHAINLINK_HTTP_URL}'

[EVM.GasEstimator]
Mode = 'FixedPrice'
PriceDefault = '${CHAINLINK_GAS_PRICE}'
EOF

    # Generate secrets.toml with node-specific database and password
    cat > "${CHAINLINK_DIR}/secrets.toml" << EOF
[Password]
Keystore = '${keystore_pass}'
[Database]
URL = 'postgresql://${PGUSER}:${PGPASSWORD}@db:5432/${PGDATABASE}_${node_num}?sslmode=disable'
EOF

    # Create credentials file with node-specific password
    {
        echo "${CHAINLINK_EMAIL}"
        echo "${CHAINLINK_PASSWORD}${node_num}"
    } > "${CHAINLINK_DIR}/apicredentials"
}

set_file_permissions() {
    chmod 600 "${CHAINLINK_DIR}/secrets.toml" "${CHAINLINK_DIR}/apicredentials"
    chmod 644 "${CHAINLINK_DIR}/config.toml"
}

install_expect_if_needed() {
    if ! command -v expect &> /dev/null; then
        echo "Installing expect..."
        apt-get update -qq && apt-get install -y -qq expect
    fi
}

# Function to create expect script for first-time initialization
create_expect_script() {
    local node_num="$1"

    cat > /tmp/init_chainlink.exp << EXPECT_EOF
#!/usr/bin/expect -f
set timeout 120

spawn chainlink node -config ${CHAINLINK_DIR}/config.toml -secrets ${CHAINLINK_DIR}/secrets.toml start

expect {
    "Enter API Email:" {
        send "${CHAINLINK_EMAIL}\r"
        exp_continue
    }
    "Enter API Password:" {
        send "${CHAINLINK_PASSWORD}${node_num}\r"
        exp_continue
    }
    "Confirm API Password:" {
        send "${CHAINLINK_PASSWORD}${node_num}\r"
        exp_continue
    }
    -re "Chainlink node.*started.*successfully" {
        puts "\\n=== Node #${node_num} initialized successfully ==="
        exp_continue
    }
    -re "Listening and serving.*" {
        puts "\\n=== Node #${node_num} is running ==="
        exp_continue
    }
    timeout {
        puts "Timeout during initialization"
        exit 1
    }
    eof {
        puts "Process ended"
        exit 0
    }
}

# Keep the process running
interact
EXPECT_EOF

    chmod +x /tmp/init_chainlink.exp
}

start_existing_node() {
    echo "=== Keys found - starting with existing setup ==="
    exec chainlink --admin-credentials-file "${CHAINLINK_DIR}/apicredentials" node \
        -config "${CHAINLINK_DIR}/config.toml" \
        -secrets "${CHAINLINK_DIR}/secrets.toml" \
        start
}

initialize_new_node() {
    local node_num="$1"

    echo "=== First time initialization ==="
    install_expect_if_needed
    create_expect_script "$node_num"
    exec /tmp/init_chainlink.exp
}

main() {
    local node_num
    local keystore_pass

    node_num=$(determine_node_number)
    echo "=== Initializing Chainlink Node #${node_num} ==="

    mkdir -p "$CHAINLINK_DIR"

    # Generate secure keystore password
    keystore_pass=$(generate_keystore_password "$node_num")
    echo "Keystore password length: ${#keystore_pass}"

    # Create configuration files
    create_config_files "$node_num" "$keystore_pass"
    set_file_permissions

    # Change to chainlink directory with error handling
    cd "$CHAINLINK_DIR" || { echo "Failed to change to $CHAINLINK_DIR"; exit 1; }

    echo "=== Starting Chainlink Node #${node_num} ==="
    echo "Database: ${PGDATABASE}_${node_num}"
    echo "Keystore Password: ${CHAINLINK_KEYSTORE_PASSWORD}${node_num}"

    # Check if keys directory exists and start accordingly
    if [ -d "${CHAINLINK_DIR}/keys" ]; then
        start_existing_node
    else
        initialize_new_node "$node_num"
    fi
}

main "$@"
