#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl'); // X25519 via scalarMult
const { ethers } = require('ethers');
// Note: Avoid deep imports from @super-protocol/sdk-js to prevent exports errors
const { hexToBuf, keccak256, aes128EcbEncryptBlock, decryptEvmKeystore } = require('./crypto-utils');
const aggregatorAbi = require('./abis/AccessControlledOffchainAggregator.json').abi;

function hexToBufLocal(h) { return hexToBuf(h); }

function normalizeForCompare(value) {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalizeForCompare(value[k]);
    return out;
  }
  return value;
}

function computeComparableDonConfig(donConfig) {
  const { sharedSecretEncryptions, ...rest } = donConfig;
  const comparable = {
    ...rest,
    sharedSecretEncryptions: sharedSecretEncryptions && sharedSecretEncryptions.sharedSecretHash
      ? { sharedSecretHash: sharedSecretEncryptions.sharedSecretHash }
      : null,
  };
  return normalizeForCompare(comparable);
}

function readDonConfigCache(cacheFilePath) {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const raw = fs.readFileSync(cacheFilePath, 'utf8');
      if (raw.trim().length === 0) return {};
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function writeDonConfigCache(cacheFilePath, data) {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
  } catch {}
  fs.writeFileSync(cacheFilePath, JSON.stringify(data, null, 2));
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Serialize cache writes across concurrent calls within this process
let _cacheWrite = Promise.resolve();
async function updateDonConfigCache(cacheFilePath, addr, data) {
  _cacheWrite = _cacheWrite.then(async () => {
    const updated = readDonConfigCache(cacheFilePath);
    updated[addr] = data;
    writeDonConfigCache(cacheFilePath, updated);
  });
  await _cacheWrite;
}

// Per-address nonce allocator to safely publish concurrent txs
const _nonceChains = new Map(); // address -> Promise chain
const _nextNonce = new Map();   // address -> number
async function allocateNonce(provider, address) {
  const prev = _nonceChains.get(address) || Promise.resolve();
  const next = prev.then(async () => {
    if (!_nextNonce.has(address)) {
      const start = await provider.getTransactionCount(address, 'pending');
      _nextNonce.set(address, start);
    }
    const n = _nextNonce.get(address);
    _nextNonce.set(address, n + 1);
    return n;
  });
  _nonceChains.set(address, next.catch(() => {}));
  return next;
}

function listWorkers(nodesList, bootstrapSet) {
  const out = [];
  for (const s of nodesList.split(/[\s,]+/).filter(Boolean)) {
    const n = parseInt(s, 10);
    if (!bootstrapSet.has(n)) out.push(n);
  }
  return out;
}

function loadNodeSecrets(rootDir, nodeNum) {
  const dir = path.join(rootDir, String(nodeNum));
  const ocr = readJSON(path.join(dir, 'ocr_key.json'));
  const evm = readJSON(path.join(dir, 'evm_key.json'));
  const p2p = readJSON(path.join(dir, 'p2p_key.json'));

  const signer = ethers.getAddress((ocr.onChainSigningAddress || '').replace(/^ocrsad_/, ''));
  const transmitter = ethers.getAddress(evm.address);
  const offchainCfgHex = (ocr.configPublicKey || '').replace(/^ocrcfg_/, '');
  const offchainPublicHex = (ocr.offChainPublicKey || '').replace(/^ocroff_/, '');
  if (offchainCfgHex.length !== 64) throw new Error(`bad ocrcfg for node ${nodeNum}`);
  const offchainCfg = '0x' + offchainCfgHex;
  const peerId = (p2p.peerID || p2p.peerId || '').replace(/^p2p_/, '');
  return { signer, transmitter, offchainCfg, peerId, offchainPublicHex };
}

function encryptSharedSecret(x25519PubKeys, sharedSecret16) {
  // ephemeral secret scalar (32 bytes)
  const sk = crypto.randomBytes(32);
  // ephemeral public: X25519(sk, basepoint)
  const base = new Uint8Array(32); base[0] = 9;
  const pk = nacl.scalarMult(sk, base); // Uint8Array(32)
  const encs = [];
  for (const pubHex of x25519PubKeys) {
    const pub = hexToBufLocal(pubHex); // 32 bytes
    if (pub.length !== 32) throw new Error('x25519 pub must be 32 bytes');
    const dh = nacl.scalarMult(sk, new Uint8Array(pub)); // 32 bytes
    const key16 = keccak256(Buffer.from(dh)).subarray(0, 16);
    const ct = aes128EcbEncryptBlock(key16, sharedSecret16);
    encs.push('0x' + ct.toString('hex'));
  }
  return {
    diffieHellmanPoint: '0x' + Buffer.from(pk).toString('hex'),
    sharedSecretHash: '0x' + keccak256(sharedSecret16).toString('hex'),
    encryptions: encs,
  };
}

async function setConfigForContract(contractAddr) {
  const rpcUrl = process.env.CHAINLINK_RPC_HTTP_URL;
  if (!rpcUrl) throw new Error('CHAINLINK_RPC_HTTP_URL is required');
  if (!contractAddr) throw new Error('Missing contract address. Usage: node set-config.js <contractAddress>');

  const nodesList = process.env.NODES_LIST || '1 2 3 4 5';
  const bootstrapStr = process.env.BOOTSTRAP_NODES || '1';
  const bootstrapSet = new Set(bootstrapStr.split(/[\s,]+/).filter(Boolean).map((s) => parseInt(s, 10)));
  const secretsRoot = process.env.SP_SECRETS_DIR ? `${process.env.SP_SECRETS_DIR}` : '/sp/secrets';
  const secretsChainlinkRoot = `${secretsRoot}/cl-secrets`;
  const cacheFile = path.join(secretsRoot, 'don-configs.json');

  const workers = listWorkers(nodesList, bootstrapSet);
  if (workers.length === 0) throw new Error('No worker nodes to configure');

  const signers = []; const transmitters = []; const offchainPublicKeys = []; const peerIDsArr = [];
  const x25519PubKeys = [];
  for (const n of workers) {
    const { signer, transmitter, offchainCfg, peerId, offchainPublicHex} = loadNodeSecrets(secretsChainlinkRoot, n);
    signers.push(signer);
    transmitters.push(transmitter);
    offchainPublicKeys.push(`0x${offchainPublicHex}`);
    peerIDsArr.push(peerId);
    x25519PubKeys.push(offchainCfg);
  }

  const threshold = 1;
  const sArr = workers.map((_, i) => (i === 0 ? 1 : 2));
  const peerIDs = peerIDsArr.join(',');

  const sharedSecretHex = process.env.SHARED_SECRET_HEX || '';
  const sharedSecret16 = sharedSecretHex ? hexToBuf(sharedSecretHex) : crypto.randomBytes(16);
  if (sharedSecret16.length !== 16) throw new Error('SHARED_SECRET_HEX must be 16 bytes');
  const sse = encryptSharedSecret(x25519PubKeys, sharedSecret16);

  // Optional env, not strictly needed when sending via ethers
  const diamondContractAddress = process.env.DIAMOND_CONTRACT_ADDRESS;

  const donConfig = {
    signers,
    transmitters,
    threshold,
    s: sArr,
    offchainPublicKeys,
    peerIDs,
    sharedSecretEncryptions: sse,
  };

  const normalizedAddr = ethers.getAddress(contractAddr);
  const comparableDonConfig = computeComparableDonConfig(donConfig);

  const cache = readDonConfigCache(cacheFile);
  const existing = cache[normalizedAddr] ? normalizeForCompare(cache[normalizedAddr]) : null;
  if (existing && JSON.stringify(existing) === JSON.stringify(comparableDonConfig)) {
    console.log(`Config for ${normalizedAddr} is up-to-date; skipping on-chain update.`);
    return;
  }

  console.log('donConfig (to publish)', donConfig);

  // Derive and print sender and signer addresses (from this node's evm_key.json only)
  let signerAddress = null;
  let derivedPkHex = null;
  try {
    const nodeNum = String(process.env.NODE_NUMBER || '1');
    const evmPath = path.join(secretsChainlinkRoot, nodeNum, 'evm_key.json');
    const ksPassword = process.env.CHAINLINK_KEYSTORE_PASSWORD;
    if (ksPassword) {
      const evmJson = readJSON(evmPath);
      derivedPkHex = decryptEvmKeystore(evmJson, ksPassword);
      signerAddress = new ethers.Wallet(derivedPkHex).address;
    }
  } catch {}
  if (!derivedPkHex) {
    throw new Error('Unable to decrypt sender key from evm_key.json. Ensure CHAINLINK_KEYSTORE_PASSWORD and file are correct.');
  }

  // Initialize SDK and send transaction via TxManager
  // Send via ethers using decrypted key
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const iface = new ethers.Interface(aggregatorAbi);
  const data = iface.encodeFunctionData('setConfig', [donConfig]);
  const sender = new ethers.Wallet(derivedPkHex, provider);
  console.log('Sender:', sender.address);
  if (signerAddress) console.log('Signer:', signerAddress);
  const feeData = await provider.getFeeData();
  const maxFeePerGasEnv = process.env.MAX_FEE_PER_GAS_WEI;
  const gasPriceEnv = process.env.CHAINLINK_GAS_PRICE; // legacy fallback
  const overrides = {};
  // Allocate a unique nonce for concurrency safety
  overrides.nonce = await allocateNonce(provider, sender.address);
  if (!gasPriceEnv) {
    const latestBlock = await provider.getBlock('latest');
    const baseFee = latestBlock?.baseFeePerGas ?? 0n;
    const suggestedMaxFee = feeData.maxFeePerGas ?? (baseFee + 1n);
    const desiredMaxFee = maxFeePerGasEnv ? BigInt(maxFeePerGasEnv) : suggestedMaxFee;
    overrides.maxPriorityFeePerGas = 1n; // enforce 1 wei priority fee
    overrides.maxFeePerGas = desiredMaxFee >= baseFee + 1n ? desiredMaxFee : (baseFee + 1n);
  } else {
    overrides.gasPrice = BigInt(gasPriceEnv);
  }
  const tx = await sender.sendTransaction({ to: normalizedAddr, data, value: 0, ...overrides });
  console.log('Submitted tx', tx.hash);
  const confirmations = parseInt(process.env.TX_CONFIRMATIONS || '1', 10);
  const timeoutMs = parseInt(process.env.TX_TIMEOUT_MS || '300000', 10); // default 5 min
  let rcpt;
  try {
    rcpt = await provider.waitForTransaction(tx.hash, confirmations, timeoutMs);
  } catch (e) {
    if (e && (e.code === 'TIMEOUT' || String(e.message || '').toLowerCase().includes('timeout'))) {
      console.warn('waitForTransaction timeout, checking receipt directly...', tx.hash);
      rcpt = await provider.getTransactionReceipt(tx.hash);
      if (!rcpt) {
        console.error('Transaction not mined yet (pending or dropped):', tx.hash);
        return;
      }
    } else {
      throw e;
    }
  }
  console.log('Mined', rcpt?.transactionHash);

  // Persist comparable DON config after successful transaction
  await updateDonConfigCache(cacheFile, normalizedAddr, comparableDonConfig);
}

async function main() {
  const contractAddr = process.argv[2];
  await setConfigForContract(contractAddr);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { setConfigForContract };
