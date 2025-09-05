const path = require('path');
const { spawn } = require('child_process');
const { readConfiguration } = require('./configuration/read-configuration');

const mapConfigToEnv = (cfg) => {
  const toStr = (value) => value && String(value);
  return {
    PGUSER: toStr(cfg.pgUser),
    PGPASSWORD: toStr(cfg.pgPassword),
    PGDATABASE: toStr(cfg.pgDatabase),
    PGPORT: toStr(cfg.pgPort),

    CHAINLINK_EMAIL: toStr(cfg.chainlinkEmail),
    CHAINLINK_PASSWORD: toStr(cfg.chainlinkPassword),
    CHAINLINK_KEYSTORE_PASSWORD: toStr(cfg.chainlinkKeystorePassword),
    CHAINLINK_CHAIN_ID: toStr(cfg.chainlinkChainId),
    CHAINLINK_NODE_NAME: toStr(cfg.chainlinkNodeName),
    CHAINLINK_RPC_WS_URL: toStr(cfg.chainlinkRpcWsUrl),
    CHAINLINK_RPC_HTTP_URL: toStr(cfg.chainlinkRpcHttpUrl),

    LINK_CA: toStr(cfg.linkCa),

    SP_SECRETS_DIR: toStr(cfg.spSecretsDir),
    TOTAL_NODES: toStr(cfg.totalNodes),
    BOOTSTRAP_NODES: toStr(cfg.bootstrapNodes),
    NODES_LIST: toStr(cfg.nodesList),
    PRIMARY_NODES: toStr(cfg.primaryNodes),
    BOOTSTRAP_NODE_ADDRESSES: toStr(cfg.bootstrapNodeAddresses),
  };
};

async function run() {
  const cfg = await readConfiguration();

  const env = { ...process.env, ...mapConfigToEnv(cfg) };

  const entrypointPath = path.resolve(__dirname, 'bash', 'entrypoint.sh');

  const child = spawn(entrypointPath, {
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`entrypoint terminated by signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 0;
  });

  child.on('error', (err) => {
    console.error('Failed to start entrypoint:', err);
    process.exitCode = 1;
  });
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
