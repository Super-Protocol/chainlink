#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl'); // X25519 via scalarMult
const createKeccakHash = require('keccak');
const { ethers } = require('ethers');

function hexToBuf(h) {
  return Buffer.from(h.replace(/^0x/, ''), 'hex');
}
function keccak256(buf) {
  return createKeccakHash('keccak256').update(buf).digest();
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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
  if (offchainCfgHex.length !== 64) throw new Error(`bad ocrcfg for node ${nodeNum}`);
  const offchainCfg = '0x' + offchainCfgHex;
  const peerId = (p2p.peerID || p2p.peerId || '').replace(/^p2p_/, '');
  return { signer, transmitter, offchainCfg, peerId };
}

function aes128EcbEncryptBlock(key16, plaintext16) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key16, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext16), cipher.final()]);
}

function encryptSharedSecret(x25519PubKeys, sharedSecret16) {
  // ephemeral secret scalar (32 bytes)
  const sk = crypto.randomBytes(32);
  // ephemeral public: X25519(sk, basepoint)
  const base = new Uint8Array(32); base[0] = 9;
  const pk = nacl.scalarMult(sk, base); // Uint8Array(32)
  const encs = [];
  for (const pubHex of x25519PubKeys) {
    const pub = hexToBuf(pubHex); // 32 bytes
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

async function main() {
  const rpcUrl = process.env.CHAINLINK_RPC_HTTP_URL;
  const contractAddr = process.env.CHAINLINK_NODE_SC_ADDRESS;
  if (!rpcUrl || !contractAddr) throw new Error('CHAINLINK_RPC_HTTP_URL and CHAINLINK_NODE_SC_ADDRESS are required');

  const nodesList = process.env.NODES_LIST || '1 2 3 4 5';
  const bootstrapStr = process.env.BOOTSTRAP_NODES || '1';
  const bootstrapSet = new Set(bootstrapStr.split(/[\s,]+/).filter(Boolean).map((s) => parseInt(s, 10)));
  const secretsRoot = process.env.SECRETS_ROOT || '/sp/secrets/cl-secrets';

  const workers = listWorkers(nodesList, bootstrapSet);
  if (workers.length === 0) throw new Error('No worker nodes to configure');

  const signers = []; const transmitters = []; const offchainPublicKeys = []; const peerIDsArr = [];
  const x25519PubKeys = [];
  for (const n of workers) {
    const { signer, transmitter, offchainCfg, peerId } = loadNodeSecrets(secretsRoot, n);
    signers.push(signer);
    transmitters.push(transmitter);
    offchainPublicKeys.push(offchainCfg);
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

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const { chainId } = await provider.getNetwork();

  const iface = new ethers.Interface([
    'function setConfig(bytes[] certsChain,uint256 rootCertId,bytes signature,(address[] signers,address[] transmitters,uint8 threshold,uint8[] s,bytes32[] offchainPublicKeys,string peerIDs,(bytes32 diffieHellmanPoint,bytes32 sharedSecretHash,bytes16[] encryptions) sharedSecretEncryptions) donConfig)'
  ]);

  const donConfig = {
    signers,
    transmitters,
    threshold,
    s: sArr,
    offchainPublicKeys,
    peerIDs,
    sharedSecretEncryptions: sse,
  };

  // Build hash: sha256(abi.encode(donConfig, signatureNonce, chainid, address(this)))
  const signatureNonce = BigInt(process.env.SIGNATURE_NONCE || '0');
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const hashPacked = coder.encode([
    'tuple(address[],address[],uint8,uint8[],bytes32[],string,tuple(bytes32,bytes32,bytes16[]))',
    'uint256', 'uint256', 'address'
  ], [
    donConfig,
    signatureNonce,
    BigInt(chainId),
    contractAddr,
  ]);
  const dataHash = crypto.createHash('sha256').update(Buffer.from(hashPacked.slice(2), 'hex')).digest();

  let signature = '0x';
  if (process.env.SIGNATURE_HEX) {
    signature = process.env.SIGNATURE_HEX;
  } else if (process.env.SIGNATURE_SIGNER_PK) {
    const wallet = new ethers.Wallet(process.env.SIGNATURE_SIGNER_PK);
    const sig = wallet.signingKey.sign(dataHash);
    signature = sig.serialized;
  }

  // Encode tx data
  const data = iface.encodeFunctionData('setConfig', [[], 0, signature, donConfig]);

  if (!process.env.SENDER_PRIVATE_KEY) {
    console.log(JSON.stringify({ to: ethers.getAddress(contractAddr), data }, null, 2));
    return;
  }

  const sender = new ethers.Wallet(process.env.SENDER_PRIVATE_KEY, provider);
  const tx = await sender.sendTransaction({ to: ethers.getAddress(contractAddr), data, value: 0 });
  console.log('Submitted tx', tx.hash);
  const rcpt = await tx.wait();
  console.log('Mined', rcpt?.transactionHash);
}

main().catch((e) => { console.error(e); process.exit(1); });


