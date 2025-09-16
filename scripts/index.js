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
    FAUCET_PRIVATE_KEY: toStr(cfg.faucetPrivateKey),
    BALANCE_TOPUP_CHECK_INTERVAL_MS: toStr(cfg.balanceTopupCheckIntervalMs),
    BALANCE_TOPUP_REQUIRED: cfg.balanceTopupRequired === undefined ? 'true' : String(cfg.balanceTopupRequired),
    FAUCET_MIN_WEI: toStr(cfg.faucetMinWei),
    FAUCET_TOPUP_WEI: toStr(cfg.faucetTopupWei),

    CHAINLINK_EMAIL: toStr(cfg.chainlinkEmail),
    CHAINLINK_PASSWORD: toStr(cfg.chainlinkPassword),
    CHAINLINK_KEYSTORE_PASSWORD: toStr(cfg.chainlinkKeystorePassword),
    CHAINLINK_CHAIN_ID: toStr(cfg.chainlinkChainId),
    CHAINLINK_NODE_NAME: toStr(cfg.chainlinkNodeName),
    CHAINLINK_RPC_WS_URL: toStr(cfg.chainlinkRpcWsUrl),
    CHAINLINK_RPC_HTTP_URL: toStr(cfg.chainlinkRpcHttpUrl),
    CL_FEED_TEMPLATES_DIR: toStr(cfg.chainlinkFeedTemplatesDir),

    LINK_CA: toStr(cfg.linkCa),

    SP_SECRETS_DIR: toStr(cfg.spSecretsDir),
    TOTAL_NODES: toStr(cfg.totalNodes),
    BOOTSTRAP_NODES: toStr(cfg.bootstrapNodes),
    NODES_LIST: toStr(cfg.nodesList),
    PRIMARY_NODES: toStr(cfg.primaryNodes),
    BOOTSTRAP_NODE_ADDRESSES: toStr(cfg.bootstrapNodeAddresses),

    ADMIN_CONTRACT_ADDRESS: toStr(cfg.adminContractAddress),
    DIAMOND_CONTRACT_ADDRESS: toStr(cfg.diamondContractAddress),

    HTTP_PROXY: toStr(cfg.httpProxy),
    HTTPS_PROXY: toStr(cfg.httpsProxy),
    NO_PROXY: toStr(cfg.noProxy),
  };
};

async function run() {
  const cfg = await readConfiguration();

  const env = { ...process.env, ...mapConfigToEnv(cfg) };

  // Make mapped env available to this process as well (for pre-start helpers)
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== null) process.env[k] = v;
  }

  const topupRequired = String(process.env.BALANCE_TOPUP_REQUIRED ?? 'true').toLowerCase() !== 'false';

  let ensureFundsFn;
  let faucetInterval = null;
  try {
    ({ ensureFunds: ensureFundsFn } = require('./secrets/balance-top-up'));
    console.log('Attempting balance top-up...');
    await ensureFundsFn();
  } catch (e) {
    console.error('Failed balance top-up step:', e?.message || e);
    if (topupRequired) {
      console.error('BALANCE_TOPUP_REQUIRED is enabled; exiting.');
      process.exit(1);
    } else {
      console.error('BALANCE_TOPUP_REQUIRED is disabled; continuing without top-up.');
    }
  }

  // Schedule periodic balance top-up checks (default every 1 hour)
  try {
    let intervalMs = parseInt(process.env.BALANCE_TOPUP_CHECK_INTERVAL_MS || '3600000', 10);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = 3600000;
    console.log(`Scheduling periodic balance top-up every ${intervalMs} ms`);

    let ensuring = false;
    const periodicEnsure = async () => {
      if (ensuring) return;
      ensuring = true;
      try {
        const fn = ensureFundsFn || require('./secrets/balance-top-up').ensureFunds;
        await fn();
      } catch (e) {
        console.error('Failed balance top-up (continuing):', e?.message || e);
      } finally {
        ensuring = false;
      }
    };

    faucetInterval = setInterval(periodicEnsure, intervalMs);
  } catch (e) {
    console.error('Failed to schedule periodic balance top-up:', e?.message || e);
    if (topupRequired) {
      console.error('BALANCE_TOPUP_REQUIRED is enabled; exiting.');
      process.exit(1);
    } else {
      console.error('BALANCE_TOPUP_REQUIRED is disabled; continuing without scheduler.');
    }
  }

  const entrypointPath = process.env.BASH_ENTRYPOINT_PATH
  ? path.resolve(process.env.BASH_ENTRYPOINT_PATH)
  : path.resolve(__dirname, 'bash', 'entrypoint.sh');

  const child = spawn(entrypointPath, {
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (typeof faucetInterval !== 'undefined' && faucetInterval) {
      clearInterval(faucetInterval);
    }
    if (signal) {
      console.error(`entrypoint terminated by signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 0;
  });

  child.on('error', (err) => {
    if (typeof faucetInterval !== 'undefined' && faucetInterval) {
      clearInterval(faucetInterval);
    }
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
