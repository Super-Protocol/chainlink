// build-secrets.js
const fs = require('fs');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const createKeccakHash = require('keccak');
const { Wallet } = require('ethers');

function fromHex(h) { return Buffer.from(h.replace(/^0x/, ''), 'hex'); }
function hex(b) { return Buffer.from(b).toString('hex'); }
// function b64(b) { return Buffer.from(b).toString('base64'); }
function keccak256(buf) { return createKeccakHash('keccak256').update(buf).digest(); }
function scrypt(password, salt, dklen, N, r, p) {
  return crypto.scryptSync(password, salt, dklen, { N, r, p, maxmem: 1024 * 1024 * 1024 });
}
function uuidV4() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function aes128ctrEncrypt(key16, iv16, plaintext) {
  const c = crypto.createCipheriv('aes-128-ctr', key16, iv16);
  return Buffer.concat([c.update(plaintext), c.final()]);
}

// Common parameters (compatible with Chainlink/go-ethereum)
const SCRYPT = { dklen: 32, n: 262144, r: 8, p: 1 };
function makeCrypto(passwordBuf, plaintext, adulteratePrefix = '') {
  if (!Buffer.isBuffer(passwordBuf) || passwordBuf.length === 0) {
    throw new Error('empty password buffer is not allowed');
  }

  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const effective = Buffer.concat([Buffer.from(adulteratePrefix, 'utf8'), passwordBuf]);
  const dk = scrypt(effective, salt, SCRYPT.dklen, SCRYPT.n, SCRYPT.r, SCRYPT.p);
  const encKey = dk.slice(0, 16);
  const ciphertext = aes128ctrEncrypt(encKey, iv, plaintext);
  const mac = keccak256(Buffer.concat([dk.slice(16, 32), ciphertext]));
  return {
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: hex(ciphertext),
      cipherparams: { iv: hex(iv) },
      kdf: 'scrypt',
      kdfparams: { dklen: SCRYPT.dklen, n: SCRYPT.n, p: SCRYPT.p, r: SCRYPT.r, salt: hex(salt) },
      mac: hex(mac),
    }
  };
}

// EVM (geth v3 keystore)
function buildEvmKeystore(evmPrivHex, passwordBuf) {
  const priv = fromHex(evmPrivHex);
  if (priv.length !== 32) {
    throw new Error(`EVM private key must be 32 bytes, got ${priv.length}`);
  }
  const pub = crypto.createECDH('secp256k1'); // only to validate key length
  pub.setPrivateKey(priv);
  // derive address from private key via ethers Wallet, then store lowercased hex without 0x (geth v3 format)
  const eip55 = new Wallet('0x' + evmPrivHex).address;
  const address = eip55.replace(/^0x/, '').toLowerCase();

  const { crypto: c } = makeCrypto(passwordBuf, priv, '');
  return {
    address,
    crypto: c,
    id: uuidV4(),
    version: 3
  };
}

// P2P (EncryptedP2PKeyExport)
function buildP2PExport(ed25519PrivHex, ed25519PubHex, peerIdString, passwordBuf) {
  const libp2pPrefix = Buffer.from([0x08, 0x01, 0x12, 0x40]);
  const raw = Buffer.concat([libp2pPrefix, fromHex(ed25519PrivHex)]);
  const { crypto: c } = makeCrypto(passwordBuf, raw, 'p2pkey');
  // Compute proper PeerID from the public key:
  // multihash identity: 0x00 || 0x24 || protobufPub
  const pub = fromHex(ed25519PubHex);
  if (pub.length !== 32) {
    throw new Error('Ed25519PubKey must be 32 bytes');
  }
  // protobuf PublicKey = 0x08 0x01 0x12 0x20 || pub(32)
  const protoPub = Buffer.concat([Buffer.from([0x08, 0x01, 0x12, 0x20]), pub]);
  const mh = Buffer.alloc(2 + protoPub.length);
  mh[0] = 0x00; // identity
  mh[1] = protoPub.length; // length=36
  mh.set(protoPub, 2);
  const computedPeerId = 'p2p_' + bs58.encode(mh);
  return {
    keyType: 'P2P',
    publicKey: ed25519PubHex.toLowerCase(),
    peerID: peerIdString || computedPeerId,
    crypto: c,
  };
}

// OCR (EncryptedOCRKeyExport)
function buildOCRExport(ecdsaDHex, ed25519PrivHex, offchainEncHex, onChainAddress, offchainPubHex, passwordBuf) {
  // plain JSON = keyBundleRawData
  // EcdsaD — decimal string
  const ecdsaDDec = BigInt('0x' + ecdsaDHex).toString(10);
  const edPriv = fromHex(ed25519PrivHex);
  if (edPriv.length !== 64) {
    throw new Error('Ed25519PrivKey must be 64 bytes');
  }
  const edPrivB64 = edPriv.toString('base64');
  // X25519 scalar: clamp bytes for compatibility across implementations
  const enc = Buffer.from(fromHex(offchainEncHex));
  if (enc.length !== 32) {
    throw new Error('OffChainEncryption must be 32 bytes');
  }
  enc[0] &= 248; enc[31] &= 127; enc[31] |= 64;
  const encArr = Array.from(enc); // exactly 32 numbers
  // Build JSON manually to keep EcdsaD as a number (not a string), otherwise Go complains:
  // "cannot unmarshal \"...\" into a *big.Int"
  const plainStr = `{"EcdsaD":${ecdsaDDec},"Ed25519PrivKey":"${edPrivB64}","OffChainEncryption":[${encArr.join(',')}]}`;
  const plain = Buffer.from(plainStr);
  const id = hex(crypto.createHash('sha256').update(plain).digest());

  // derive config public key (X25519) from the scalar
  const pubCfg = Buffer.from(nacl.scalarMult.base(enc));
  const onAddrStr = 'ocrsad_' + onChainAddress;
  const offPubStr = 'ocroff_' + offchainPubHex.toLowerCase();
  const cfgPubStr = 'ocrcfg_' + hex(pubCfg);

  const { crypto: c } = makeCrypto(passwordBuf, plain, 'ocrkey');
  return {
    keyType: 'OCR',
    id,
    onChainSigningAddress: onAddrStr,
    offChainPublicKey: offPubStr,
    configPublicKey: cfgPubStr,
    crypto: c,
  };
}

function main() {
  const file = process.argv[2] || 'keys-raw.json';
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  const pwAll = process.env.KEY_PASSWORD || '';
  const ocrPass = process.env.OCR_PASSWORD || pwAll;
  const p2pPass = process.env.P2P_PASSWORD || pwAll;
  const evmPass = process.env.EVM_PASSWORD || pwAll;

  if (!ocrPass || !p2pPass || !evmPass) {
    console.error('Empty password detected (OCR_PASSWORD/P2P_PASSWORD/EVM_PASSWORD or KEY_PASSWORD). Refusing to proceed.');
    process.exit(1);
  }

  const OCR_PW = Buffer.from(ocrPass, 'utf8');
  const P2P_PW = Buffer.from(p2pPass, 'utf8');
  const EVM_PW = Buffer.from(evmPass, 'utf8');

  const evmOut = buildEvmKeystore(raw.evm.privateKeyHex, EVM_PW);
  const p2pOut = buildP2PExport(raw.p2p.ed25519PrivKeyHex, raw.p2p.ed25519PubKeyHex, raw.p2p.peerId, P2P_PW);
  const ocrOut = buildOCRExport(
    raw.ocr.ecdsaDHex,
    raw.ocr.ed25519PrivKeyHex,
    raw.ocr.offchainEncryptionHex,
    raw.ocr.onChainAddress,
    raw.ocr.offchainPublicKeyHex,
    OCR_PW
  );

  fs.writeFileSync('evm_key.json', JSON.stringify(evmOut, null, 2));
  fs.writeFileSync('p2p_key.json', JSON.stringify(p2pOut, null, 2));
  fs.writeFileSync('ocr_key.json', JSON.stringify(ocrOut, null, 2));
  console.log('Wrote evm_key.json, p2p_key.json, ocr_key.json');
}

main();
