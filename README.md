# Chainlink Oracle Infrastructure

A comprehensive setup for running Chainlink Oracle nodes with support for both standalone multi-node deployment and all-in-one containerized solution.

## Quick Start: All-in-One Container

For rapid deployment of a complete Chainlink stack:

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

## Project Overview

This repository provides a complete infrastructure for deploying and managing Chainlink Oracle nodes. It includes:

- **Multi-node setup**: Run up to 5 Chainlink nodes with Docker Compose
- **All-in-one container**: Single container deployment with all services
- **Price aggregator**: NestJS-based caching layer that fetches and caches external data for Chainlink jobs
- **Verification**: TEE attestation and image verification tools

## Project Structure

```
├── docker-compose.yml              # Multi-node Docker Compose configuration
├── dockerfile                      # Standard Chainlink node image
├── dockerfile.allinone            # All-in-one container image
├── aio/                           # All-in-one container s6-rc configuration
├── price-aggregator/              # NestJS caching layer for external data sources
│   └── README.md                 # Service documentation
├── scripts/                       # Utility scripts for key generation and management
├── verification/                  # Image verification tools
│   └── README.md                 # Verification guide
└── README.md                      # This file
```

## Multi-Node Setup

### Prerequisites

- Docker and Docker Compose installed
- Basic understanding of blockchain and oracles
- Network access (e.g., opBNB Testnet)

### Configuration

#### 1. Environment Variables

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
nano .env
```

#### Key Environment Variables

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| **Chainlink API Credentials** ||||
| `CHAINLINK_EMAIL` | Admin email for Chainlink UI | `admin@example.com` | Yes |
| `CHAINLINK_PASSWORD` | Base password for Chainlink UI (min 16 chars) | `YOUR_PASSWORD` | Yes |
| **Chainlink Configuration** ||||
| `CHAINLINK_KEYSTORE_PASSWORD` | Password to encrypt Chainlink keys (min 16 chars) | `YOUR_KEYSTORE_PASSWORD` | Yes |
| `CHAINLINK_CHAIN_ID` | Blockchain network chain ID | `5611` (opBNB Testnet) | Yes |
| `CHAINLINK_RPC_WS_URL` | WebSocket RPC endpoint | `wss://opbnb-testnet-rpc.publicnode.com` | Yes |
| `CHAINLINK_RPC_HTTP_URL` | HTTP RPC endpoint | `https://opbnb-testnet-rpc.publicnode.com` | Yes |
| `CHAINLINK_GAS_PRICE` | Default gas price in wei | `10000000000` (10 Gwei) | Yes |

**Important:** Node numbers are automatically appended to passwords. For Node 1 with `CHAINLINK_PASSWORD="YOUR_PASSWORD"`, the actual password will be `YOUR_PASSWORD1`.

### Starting the Nodes

```bash
# Start all 5 nodes
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# View specific node logs
docker-compose logs -f chainlink-node-1
```

### Accessing the Nodes

Each node runs on a separate port:

- **Node 1**: http://localhost:6688
- **Node 2**: http://localhost:6689
- **Node 3**: http://localhost:6690
- **Node 4**: http://localhost:6691
- **Node 5**: http://localhost:6692

Login credentials:
- **Email**: Value from `CHAINLINK_EMAIL`
- **Password**: `CHAINLINK_PASSWORD` + node number (e.g., `YOUR_PASSWORD1`)

## Price Aggregator Service

A NestJS-based caching layer that queries external data sources, caches the responses, and provides up-to-date data to Chainlink jobs without requiring each node to make separate external requests.

### Running the Service

```bash
cd price-aggregator
npm install

# Development mode
npm run start:dev

# Production mode
npm run start:prod
```

API documentation available at: http://localhost:3000/api

For more details, see [price-aggregator/README.md](price-aggregator/README.md).

## Verification

Verify the authenticity of the Chainlink image using TEE attestation and Super Protocol order reports.

### Quick Verification

```bash
cd verification
chmod +x ./verify.sh
./verify.sh ./resource.json
```

For detailed verification instructions, see [verification/README.md](verification/README.md).

## Service Management

### Common Commands

```bash
# Start all nodes
docker-compose up -d

# Stop all nodes
docker-compose down

# Restart a specific node
docker-compose restart chainlink-node-1

# View all logs
docker-compose logs -f

# Remove all data (CAUTION)
docker-compose down -v
```

### Complete Cleanup

```bash
# Remove all containers, images, and volumes
docker-compose down --rmi all -v
docker system prune -a --volumes
```

## Creating Jobs

### Via Web UI

1. Navigate to the Jobs section in the Chainlink UI
2. Click "New Job"
3. Paste a TOML configuration

#### Example: Price Feed Job

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

### Via API

```bash
# Authenticate
curl -c cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"YOUR_PASSWORD1"}' \
  http://localhost:6688/sessions

# Trigger a job
curl -b cookies.txt -X POST \
  http://localhost:6688/v2/jobs/JOB_ID/runs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Security Considerations ⚠️

- This setup is designed for **TESTING AND DEVELOPMENT**
- Never use example credentials in production
- Always use strong, unique passwords (minimum 16 characters)
- Enable HTTPS in production environments
- Secure RPC endpoints with authentication
- Keep secrets in `sp-secrets/` directory out of version control

## Network Configuration

- Default chain ID: 5611 (opBNB Testnet)
- Configurable via environment variables
- Supports custom RPC endpoints (HTTP and WebSocket)
- Internal Docker network: 10.5.0.0/16

## Troubleshooting

### Node Issues

```bash
# Check node logs
docker-compose logs -f chainlink-node-1

# Verify node is running
docker-compose ps

# Check node configuration
docker-compose exec chainlink-node-1 env
```

### Network Issues

- Verify RPC endpoints are accessible
- Check firewall settings for ports 6688-6692
- Ensure Docker network is properly configured

### Job Issues

- Check node logs for error messages
- Verify job TOML syntax
- Ensure all required keys (P2P, OCR, EVM) are configured
- For OCR jobs, verify bootstrap node is configured correctly

### Common Error Solutions

- **401 Invalid password**: Verify credentials in environment variables or recreate node database
- **422 errors**: Check server response in logs for field validation errors

## Development Workflow

1. Start nodes with `docker-compose up -d`
2. Create and manage jobs via Web UI or API
3. Monitor price data with price-aggregator service
4. Verify deployments using verification tools

## Additional Resources

- [Price Aggregator Documentation](price-aggregator/README.md)
- [Verification Guide](verification/README.md)
- [Chainlink Official Documentation](https://docs.chain.link/)

## License

UNLICENSED

---

**Happy Oracle Building! 🚀**
