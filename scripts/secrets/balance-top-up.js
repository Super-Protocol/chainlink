const path = require('path');
const fs = require('fs');
const { BlockchainConnector } = require('@super-protocol/sdk-js');

function getTransmitterAddress() {
  try {
    const secretsRoot = process.env.SP_SECRETS_DIR ? `${process.env.SP_SECRETS_DIR}` : '/sp/secrets';
    const secretsChainlinkRoot = `${secretsRoot}/cl-secrets`;
    const nodeNum = String(process.env.NODE_NUMBER || '1');
    const evmPath = path.join(secretsChainlinkRoot, nodeNum, 'evm_key.json');
    const evmJson = JSON.parse(fs.readFileSync(evmPath, 'utf8'));

    return `0x${evmJson.address}`; // set-config.js treats evm.address as the transmitter address
  } catch (e) {
    console.error('Failed to read transmitter address:', e?.message || e);
    throw e;
  }
}

async function ensureFunds() {
  const faucetPrivateKey = process.env.FAUCET_PRIVATE_KEY;
  if (!faucetPrivateKey) {
    throw new Error('FAUCET_PRIVATE_KEY is not set; skipping top-up');
  }
  const rpcUrl = process.env.CHAINLINK_RPC_HTTP_URL;
  const diamondContractAddress = process.env.DIAMOND_CONTRACT_ADDRESS;
  if (!rpcUrl || !diamondContractAddress) {
    throw new Error('RPC or DIAMOND_CONTRACT_ADDRESS missing; skipping top-up');
  }

  const targetAddress = getTransmitterAddress();

  console.log(`Attempting faucet top-up for ${targetAddress}...`);
  const minWeiStr = process.env.FAUCET_MIN_WEI || '20000000000000';
  const topupWeiStr = process.env.FAUCET_TOPUP_WEI || '10000000000000';
  const minWei = BigInt(minWeiStr);
  const topupWei = BigInt(topupWeiStr);

  try {
    const conn = BlockchainConnector.getInstance();
    await conn.initialize({
      contractAddress: diamondContractAddress,
      blockchainUrl: rpcUrl,
    });

    const balStr = await conn.getBalance(targetAddress);
    const bal = BigInt(balStr);
    if (bal >= minWei) {
      console.log(`Balance for ${targetAddress} is sufficient: ${bal.toString()} wei`);
      return;
    }

    const pk = typeof faucetPrivateKey === 'string' && faucetPrivateKey.startsWith('0x')
      ? faucetPrivateKey
      : `0x${String(faucetPrivateKey)}`;
    await conn.initializeActionAccount(pk);

    console.log(`Requesting faucet transfer of ${topupWei.toString()} wei to ${targetAddress} (using FAUCET_PRIVATE_KEY sender)`);
    const tx = await conn.transfer(targetAddress, topupWei.toString());
    console.log('Faucet transfer submitted, tx:', tx?.hash || tx);
  } catch (e) {
    console.error('Faucet top-up failed:', e?.message || e);
    throw e;
  } finally {
    BlockchainConnector.getInstance().shutdown();
  }
}

if (require.main === module) {
  ensureFunds().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { ensureFunds };
