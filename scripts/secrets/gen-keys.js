// gen-keys.js
const fs = require('fs');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { Wallet, getAddress } = require('ethers');
const bs58 = require('bs58').default;

function hex(buf) { return Buffer.from(buf).toString('hex'); }
function rand32() { return crypto.randomBytes(32); }

function genEvm() {
  const w = Wallet.createRandom();
  return {
    privateKeyHex: w.privateKey.replace(/^0x/, ''),
    address: getAddress(w.address)
  };
}

function genP2P() {
  const kp = nacl.sign.keyPair(); // ed25519
  // Construct a proper libp2p PeerID:
  // 1) protobuf PublicKey = 0x08 0x01 0x12 0x20 || pub(32)
  // 2) multihash identity: 0x00 || 0x24 || protobufPub
  const pub = Buffer.from(kp.publicKey);
  const protoPub = Buffer.concat([Buffer.from([0x08, 0x01, 0x12, 0x20]), pub]);
  const mh = Buffer.alloc(2 + protoPub.length);
  mh[0] = 0x00; // identity code
  mh[1] = 0x24; // length 36
  mh.set(protoPub, 2);
  const peerId = 'p2p_' + bs58.encode(mh);
  return {
    ed25519PrivKeyHex: hex(kp.secretKey), // 64 bytes
    ed25519PubKeyHex: hex(kp.publicKey),
    peerId
  };
}

function genOCR() {
  const w = Wallet.createRandom(); // on-chain signing (secp256k1)
  const ecdsaDHex = w.privateKey.replace(/^0x/, '');
  const ed = nacl.sign.keyPair();  // off-chain signing (ed25519)
  const encScalar = rand32();      // off-chain encryption (X25519 scalar)
  return {
    ecdsaDHex,
    ed25519PrivKeyHex: hex(ed.secretKey),   // 64 bytes
    offchainEncryptionHex: hex(encScalar),  // 32 bytes
    onChainAddress: getAddress(w.address),
    offchainPublicKeyHex: hex(ed.publicKey)
  };
}

const out = {
  evm: genEvm(),
  p2p: genP2P(),
  ocr: genOCR(),
};

const file = process.argv[2] || 'keys-raw.json';
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Wrote ${file}`);
