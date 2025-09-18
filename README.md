# Chainlink Multi-Node Setup Guide

## ALL IN ONE
```bash
docker build --platform linux/amd64 -f dockerfile.allinone -t sp-chainlink-all-in-one .
docker run -d --name chainlink-stack \
  --platform linux/amd64 \
  -p 6601:6601 \
  -p 6602:6602 \
  -p 6603:6603 \
  -p 6604:6604 \
  -p 6605:6605 \
  -v "$(pwd)/temp/certs:/sp/certs:ro" \
  -v "$(pwd)/temp/configurations:/sp/configurations:ro" \
  -v "$(pwd)/sp-secrets:/sp/secrets:rw" \
  -v "$(pwd)/scripts:/scripts" \
  --env-file .env \
  sp-chainlink-all-in-one
```

## Overview
This guide walks through setting up multiple Chainlink Oracle Nodes with Docker Compose for testing purposes, including shared PostgreSQL database and automated configuration. The setup supports dynamic scaling with additional nodes.

## Prerequisites
- Docker and Docker Compose installed
- Basic understanding of blockchain and oracles
- Test network access (opBNB Testnet)

## Project Structure
```
├── docker-compose.yml         # Main Docker Compose configuration
├── .env.example                       # Environment variables example
├── scripts/
│   ├── init-database.sql      # Database initialization script
│   └── entrypoint.sh # Universal node startup script
└── README.md
```

## Quick Setup

### 1. Configure Environment Variables

A sample environment file `.env.example` is provided. Copy it to create your own `.env` file:

```bash
cp .env.example .env
```

Then edit the `.env` file with your preferred text editor to configure your specific settings:

```bash
nano .env   # or vim .env, or any editor of your choice
```

#### Environment Variables Reference

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| **PostgreSQL Configuration** ||||
| `PGUSER` | PostgreSQL username | `postgres` | Yes |
| `PGPASSWORD` | PostgreSQL password | `mysecretpassword` | Yes |
| `PGDATABASE` | Base name for Chainlink databases | `chainlink_node` | Yes |
| `PGPORT` | PostgreSQL port | `5432` | Yes |
| **Chainlink API Credentials** ||||
| `CHAINLINK_EMAIL` | Admin email for Chainlink UI login | `admin@example.com` | Yes |
| `CHAINLINK_PASSWORD` | Base password for Chainlink UI login (min 16 chars) | `yoursuperpassword` | Yes |
| **Chainlink Configuration** ||||
| `CHAINLINK_KEYSTORE_PASSWORD` | Password to encrypt Chainlink keys (min 16 chars) | `yourkeystorepassword` | Yes |
| `CHAINLINK_CHAIN_ID` | Blockchain network chain ID | `5611` (opBNB Testnet) | Yes |
| `CHAINLINK_RPC_WS_URL` | WebSocket RPC endpoint | `wss://opbnb-testnet.g.alchemy.com/v2/YOUR_API_KEY` | Yes |
| `CHAINLINK_RPC_HTTP_URL` | HTTP RPC endpoint | `https://opbnb-testnet.g.alchemy.com/v2/YOUR_API_KEY` | Yes |
| `CHAINLINK_GAS_PRICE` | Default gas price in wei | `10000000000` (10 Gwei) | Yes |

**Important Notes:**
- The universal entrypoint script automatically appends the node number to both database names and passwords
- For Node 1, if `CHAINLINK_PASSWORD` is set to `yoursuperpassword`, the actual password will be `yoursuperpassword1`
- Both `CHAINLINK_PASSWORD` and `CHAINLINK_KEYSTORE_PASSWORD` must be at least 16 characters long
- If the base password is too short, the system will automatically pad it with the node number and timestamp

### 2. Start the Services
```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

The PostgreSQL database will be automatically initialized with separate databases for each node using the `init-database.sql` script. Each node connects to its own database (`chainlink_1`, `chainlink_2`, etc.) for isolation.

### 3. Access Web Interfaces
- **Node 1**: Open browser at `http://localhost:6688`
- **Node 2**: Open browser at `http://localhost:6689`
- **Node 3**: Open browser at `http://localhost:6690` (requires `--profile extra-nodes`)

Login with credentials:
- **Email**: Value from `CHAINLINK_EMAIL` in `.env` file
- **Password**: Value from `CHAINLINK_PASSWORD` in `.env` file + node number
  (e.g., if password is "chainlinkpassword", Node 1 uses "chainlinkpassword1")

### 4. Create Jobs via Web UI
1. Navigate to Jobs section
2. Click on "New Job" button
3. Paste one of the following TOML configurations:

#### Basic HTTP Job (Price Feed)
```toml
type = "webhook"
schemaVersion = 1
name = "Fetch ETH Price"
observationSource = """
    fetch [type="http" method=GET url="https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD" allowUnrestrictedNetworkAccess="true"]
    parse [type="jsonparse" path="USD" data="$(fetch.body)"]
    fetch -> parse
"""
```

#### Alternative BNB Price Feed
```toml
type = "webhook"
schemaVersion = 1
name = "Fetch BNB Price"
observationSource = """
    fetch [type="http" method=GET url="https://min-api.cryptocompare.com/data/price?fsym=BNB&tsyms=USD" allowUnrestrictedNetworkAccess="true"]
    parse [type="jsonparse" path="USD" data="$(fetch.body)"]
    fetch -> parse
"""
```

#### Direct Request Job
```toml
type = "directrequest"
schemaVersion = 1
name = "Get > Uint256"
# Optional: Set your own externalJobID
# externalJobID = "b1d42cd5-4a3a-4200-b1f7-25a68e48aad5"
contractAddress = "YOUR_ORACLE_CONTRACT_ADDRESS"
maxTaskDuration = "0s"
observationSource = """
    decode_log   [type="ethabidecodelog"
                  abi="OracleRequest(bytes32 indexed specId, address requester, bytes32 requestId, uint256 payment, address callbackAddr, bytes4 callbackFunctionId, uint256 cancelExpiration, uint256 dataVersion, bytes data)"
                  data="$(jobRun.logData)"
                  topics="$(jobRun.logTopics)"]

    decode_cbor  [type="cborparse" data="$(decode_log.data)"]
    fetch        [type="http" method=GET url="$(decode_cbor.url)" allowUnrestrictedNetworkAccess="true"]
    parse        [type="jsonparse" path="$(decode_cbor.path)" data="$(fetch.body)"]
    multiply     [type="multiply" input="$(parse)" times="$(decode_cbor.times)"]
    encode_data  [type="ethabiencode" abi="(uint256 value)" data="{ \"value\": $(multiply) }"]
    encode_tx    [type="ethabiencode"
                  abi="fulfillOracleRequest(bytes32 requestId, uint256 payment, address callbackAddress, bytes4 callbackFunctionId, uint256 expiration, bytes32 data)"
                  data="{ \"requestId\": $(decode_log.requestId), \"payment\": $(decode_log.payment), \"callbackAddress\": $(decode_log.callbackAddr), \"callbackFunctionId\": $(decode_log.callbackFunctionId), \"expiration\": $(decode_log.cancelExpiration), \"data\": $(encode_data) }"]
    submit_tx    [type="ethtx" to="YOUR_ORACLE_CONTRACT_ADDRESS" data="$(encode_tx)" minConfirmations="1"]

    decode_log -> decode_cbor -> fetch -> parse -> multiply -> encode_data -> encode_tx -> submit_tx
"""
```

4. Save the job and note the generated Job ID (UUID)

### 5. Testing Jobs via API

#### Node 1:
```bash
# Authenticate and get cookies
curl -c cookies_node1.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"your_email@example.com","password":"your_secure_password1"}' \
  http://localhost:6688/sessions

# Trigger a job
curl -b cookies_node1.txt -X POST \
  http://localhost:6688/v2/jobs/JOB_ID/runs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

#### Node 2:
```bash
# Authenticate and get cookies
curl -c cookies_node2.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"your_email@example.com","password":"your_secure_password2"}' \
  http://localhost:6689/sessions

# Trigger a job
curl -b cookies_node2.txt -X POST \
  http://localhost:6689/v2/jobs/JOB_ID/runs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

#### Node 3 (with extra-nodes profile):
```bash
# Authenticate and get cookies
curl -c cookies_node3.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"your_email@example.com","password":"your_secure_password3"}' \
  http://localhost:6690/sessions

# Trigger a job
curl -b cookies_node3.txt -X POST \
  http://localhost:6690/v2/jobs/JOB_ID/runs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Note:** Node numbers are appended to the base password. For example, if your base password is "chainlinkpassword", Node 1 will use "chainlinkpassword1", Node 2 will use "chainlinkpassword2", etc.

## Service Management

### Key Commands
```bash
# Start all core services (Node 1 & 2)
docker-compose up -d

# Start all services including extra nodes
docker-compose --profile extra-nodes up -d

# Stop all services
docker-compose --profile extra-nodes down

# View service logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f chainlink-node-1
docker-compose logs -f chainlink-node-2
docker-compose logs -f chainlink-node-3
docker-compose logs -f db

# Restart a specific service
docker-compose restart chainlink-node-1

# Check service status
docker-compose ps
```

### Removing Data
```bash
# Stop services and remove volumes (CAUTION: Deletes all data)
docker-compose --profile extra-nodes down -v

# For complete cleanup including all images and cache
docker-compose --profile extra-nodes down --rmi all -v
docker system prune -a --volumes

# To verify all volumes were removed
docker volume ls | grep chainlink
```

## Important Notes

### Security Warnings ⚠️
- This setup is for **TESTING ONLY**
- Never use credentials from this guide in production
- Always use strong, unique passwords
- Enable HTTPS in production environments

### Network Configuration
- RPC endpoints are configured via environment variables in `.env`
- Default chain ID is set for opBNB Testnet (5611)
- Gas price settings can be adjusted in the `.env` file

### Troubleshooting
- Check Docker Compose logs: `docker-compose logs -f`
- Verify PostgreSQL connection: `docker-compose exec db pg_isready -U postgres`
- List all databases: `docker-compose exec db psql -U postgres -c '\l'`
- Ensure RPC endpoints are accessible
- Check firewall settings for ports 6688, 6689, and 6690
- Inspect node configuration: `docker-compose exec chainlink-node-1 cat /chainlink/config.toml`
- Check database connection: `docker-compose exec chainlink-node-1 cat /chainlink/secrets.toml`
- View node logs: `docker-compose logs -f chainlink-node-1 | grep -i error`


## Next Steps
- Deploy Oracle contracts
- Fund nodes with LINK tokens
- Create consumer contracts
- Test end-to-end oracle functionality
- Configure a load balancer for high availability
**Happy Oracle Building! 🚀**
