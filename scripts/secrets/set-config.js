/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl'); // X25519 via scalarMult
const { ethers } = require('ethers');
const { BlockchainConnector } = require('@super-protocol/sdk-js');
// Note: Avoid deep imports from @super-protocol/sdk-js to prevent exports errors
let TxManager;
try {
  // Using CJS build explicitly to avoid ESM interop issues
  TxManager = require('@super-protocol/sdk-js/dist/cjs/utils/TxManager.js').default;
} catch (_) {
  TxManager = null;
}
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

// In-memory cache and deferred flush handling
let _loadedCache = null;
let _cacheFilePathGlobal = null;
let _cacheDirty = false;
let _exitHandlersInstalled = false;

function ensureCacheLoaded(cacheFilePath) {
  if (!_cacheFilePathGlobal) _cacheFilePathGlobal = cacheFilePath;
  if (_loadedCache === null) {
    _loadedCache = readDonConfigCache(cacheFilePath);
  }
  if (!_exitHandlersInstalled) {
    _exitHandlersInstalled = true;
    const tryFlush = () => {
      try { flushDonConfigCacheSync(); } catch {}
    };
    process.once('beforeExit', tryFlush);
    process.once('exit', tryFlush);
    process.once('SIGINT', () => { tryFlush(); process.exit(130); });
    process.once('SIGTERM', () => { tryFlush(); process.exit(143); });
    process.on('uncaughtException', (e) => { try { console.error(e); } catch {}; tryFlush(); process.exit(1); });
    process.on('unhandledRejection', (e) => { try { console.error(e); } catch {}; tryFlush(); process.exit(1); });
  }
}

function getLoadedCache(cacheFilePath) {
  ensureCacheLoaded(cacheFilePath);
  return _loadedCache;
}

function markCacheUpdated(addr, comparableConfig, cacheFilePath) {
  ensureCacheLoaded(cacheFilePath);
  _loadedCache[addr] = comparableConfig;
  _cacheDirty = true;
}

function flushDonConfigCacheSync() {
  if (!_cacheDirty || !_cacheFilePathGlobal || _loadedCache === null) return;
  writeDonConfigCache(_cacheFilePathGlobal, _loadedCache);
  _cacheDirty = false;
}

async function flushDonConfigCache() {
  flushDonConfigCacheSync();
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

// SDK manages nonces internally; no local nonce allocator needed when using TxManager

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

const compareDonConfig = (a, b) => {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  delete left.sharedSecretEncryptions;
  delete right.sharedSecretEncryptions;
  return JSON.stringify(left) === JSON.stringify(right);
};

// Global connector state for reuse across multiple calls
let _conn = null;
let _connectorInitialized = false;
let _connectorChainUrl = null;
let _connectorContractAddress = null;
let _actionAddress = null;
let _derivedPkHexGlobal = null;
let _signerAddressGlobal = null;

async function initConnector(options = {}) {
  if (_connectorInitialized) return;

  const rpcUrl = options.rpcUrl || process.env.CHAINLINK_RPC_HTTP_URL;
  if (!rpcUrl) throw new Error('CHAINLINK_RPC_HTTP_URL is required');

  const secretsRoot = process.env.SP_SECRETS_DIR ? `${process.env.SP_SECRETS_DIR}` : '/sp/secrets';
  const secretsChainlinkRoot = `${secretsRoot}/cl-secrets`;

  // Derive sender key (can be overridden)
  let derivedPkHex = options.derivedPkHex || null;
  let signerAddress = null;
  if (!derivedPkHex) {
    const nodeNum = String(process.env.NODE_NUMBER || '1');
    const evmPath = path.join(secretsChainlinkRoot, nodeNum, 'evm_key.json');
    const ksPassword = process.env.CHAINLINK_KEYSTORE_PASSWORD;
    if (!ksPassword) throw new Error('CHAINLINK_KEYSTORE_PASSWORD is required for connector initialization');
    const evmJson = readJSON(evmPath);
    derivedPkHex = decryptEvmKeystore(evmJson, ksPassword);
    signerAddress = new ethers.Wallet(derivedPkHex).address;
  } else {
    signerAddress = new ethers.Wallet(derivedPkHex).address;
  }

  const diamondContractAddress = options.contractAddress || process.env.DIAMOND_CONTRACT_ADDRESS || null;

  _conn = BlockchainConnector.getInstance();
  await _conn.initialize({ contractAddress: diamondContractAddress || undefined, blockchainUrl: rpcUrl });
  const actionAddress = await _conn.initializeActionAccount(derivedPkHex);

  _connectorInitialized = true;
  _connectorChainUrl = rpcUrl;
  _connectorContractAddress = diamondContractAddress || null;
  _actionAddress = actionAddress;
  _derivedPkHexGlobal = derivedPkHex;
  _signerAddressGlobal = signerAddress;

  try { console.log('Sender:', actionAddress); } catch {}
  try { if (signerAddress) console.log('Signer:', signerAddress); } catch {}
}

function shutdownConnector() {
  try { BlockchainConnector.getInstance().shutdown(); } catch {}
  _conn = null;
  _connectorInitialized = false;
  _connectorChainUrl = null;
  _connectorContractAddress = null;
  _actionAddress = null;
  _derivedPkHexGlobal = null;
  _signerAddressGlobal = null;
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

  const cache = getLoadedCache(cacheFile);
  const existing = cache[normalizedAddr] ? normalizeForCompare(cache[normalizedAddr]) : null;
  if (existing && compareDonConfig(existing, comparableDonConfig)) {
    console.log(`Config for ${normalizedAddr} is up-to-date; skipping on-chain update.`);
    return;
  }

  console.log('donConfig (to publish)', donConfig);

  // Ensure connector is initialized (backward compatible when called directly)
  if (!_connectorInitialized) {
    await initConnector({ rpcUrl, contractAddress: diamondContractAddress || normalizedAddr });
  }

  // Encode call data using ethers Interface
  const iface = new ethers.Interface(aggregatorAbi);
  const data = iface.encodeFunctionData('setConfig', [{
    signers,
    transmitters,
    threshold,
    s: sArr,
    offchainPublicKeys,
    peerIDs,
    sharedSecretEncryptions: sse,
  }]);

  // Execute raw transaction via TxManager when available; fallback to ethers otherwise
  let receipt;
  if (TxManager && typeof TxManager.publishTransaction === 'function') {
    const transactionOptions = { from: _actionAddress };
    receipt = await TxManager.publishTransaction({ to: normalizedAddr, data }, transactionOptions);
    console.log('Mined', receipt?.transactionHash);
  } else {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    if (!_derivedPkHexGlobal) throw new Error('Connector not initialized with derived private key; cannot fallback to ethers signer');
    const sender = new ethers.Wallet(_derivedPkHexGlobal, provider);
    const tx = await sender.sendTransaction({ to: normalizedAddr, data, value: 0 });
    console.log('Submitted tx', tx.hash);
    receipt = await tx.wait();
    console.log('Mined', receipt?.hash || receipt?.transactionHash);
  }

  // Stage comparable DON config in memory; actual write is deferred
  markCacheUpdated(normalizedAddr, comparableDonConfig, cacheFile);
}

async function main() {
  const contractAddr = process.argv[2];
  await initConnector({});
  try {
    await setConfigForContract(contractAddr);
    await flushDonConfigCache();
  } finally {
    shutdownConnector();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { setConfigForContract, flushDonConfigCache, initConnector, shutdownConnector };
