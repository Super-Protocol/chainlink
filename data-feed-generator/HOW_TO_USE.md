## How to use the data feed generator

### What it does
- Renders job TOML files per node into `chainlink-node-<N>-data/jobs/` from `templates/btc-usd.toml`.
- Marks the bootstrap node (`isBootstrapPeer = true`) and removes fields that are invalid for a bootstrap job.
- On container start, a background publisher logs into each node and publishes the rendered jobs (injecting live P2P/OCR/EVM keys before POST).

### Prerequisites
- Each node directory has `apicredentials` with exactly two lines:
  1) Email, 2) Password.
- `chainlink-node-1-data/config.toml` exists (used to auto-detect `evmChainID` if not provided).
- Docker Compose file mounts the node directories and the scripts (already wired in `docker-compose.yml`).

### Render jobs (offline)
Run from repo root:

```bash
./data-feed-generator/generate.sh
```

Overrides (optional):
```bash
NODES_LIST="1 2 3 4 5" \
BOOTSTRAP_NODE=1 \
EVM_CHAIN_ID=5611 \
TEMPLATE_PATH=./data-feed-generator/templates/btc-usd.toml \
./data-feed-generator/generate.sh
```

Output:
- `chainlink-node-<N>-data/jobs/btc-usd.node-<N>.toml`
  - Bootstrap node gets `isBootstrapPeer = true` and no `observationSource/keyBundleID/transmitterAddress`.
  - Non-bootstrap nodes keep full pipeline and keys are injected at publish time.

### Start containers (auto-publish)
```bash
docker compose -f docker-compose.yml up -d --force-recreate
```

What happens on startup:
- The entrypoint starts Chainlink as PID 1.
- `publish-jobs.sh` waits for API, logs in, fetches CSRF, discovers live keys (P2P/OCR/EVM), rewrites TOML in-memory, then POSTs `/v2/jobs`.
- Logs show either "[publish] Created job …" or an error with server response.

### Optional: render + publish immediately
Set `PUBLISH=true` to make the generator also POST jobs right away (requires running nodes):
```bash
PUBLISH=true ./data-feed-generator/generate.sh
```

### Environment variables
- `NODES_LIST` (default: `"1 2 3 4 5"`): Which nodes to target.
- `BOOTSTRAP_NODE` (default: `1`): Which node is the bootstrap peer.
- `TEMPLATE_PATH` (default: `./data-feed-generator/templates/btc-usd.toml`): Template file.
- `EVM_CHAIN_ID` (optional): If omitted, auto-detected from node-1 config, else fallback `5611`.
- `HTTP_PORT_BASE` (default: `6688`): Node N → `base + N - 1`.
- `PUBLISH` (default: `false`): If `true`, generator also creates jobs via API.

### Notes / troubleshooting
- If some nodes return `401 Invalid password` on login, their DB has a different admin password. Update `apicredentials` or recreate that node’s DB, then restart the container.
- If a bootstrap job returns `400 unrecognised key … observationSource`, regenerate; generator strips that section for the bootstrap node.
- If you see `422` errors in logs, the publisher prints server response to help adjust fields.
