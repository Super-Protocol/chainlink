#!/usr/bin/env node
/* eslint-disable no-console */
const crypto = require('crypto');
const createKeccakHash = require('keccak');

function fromHex(hex) {
  if (typeof hex !== 'string') throw new Error('Expected hex string');
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}

function hexToBuf(h) {
  return fromHex(h);
}

function keccak256(buf) {
  return createKeccakHash('keccak256').update(buf).digest();
}

function deriveKeyScrypt(passwordBuf, saltBuf, params) {
  const { n, r, p, dklen } = params;
  return crypto.scryptSync(passwordBuf, saltBuf, dklen, { N: n, r, p, maxmem: 1024 * 1024 * 1024 });
}

function decryptOCR(exportJson, plainPassword) {
  if (!exportJson || !exportJson.crypto) {
    throw new Error('Invalid JSON: crypto section missing');
  }
  const { keyType, crypto: c } = exportJson;
  if (!keyType || keyType !== 'OCR') {
    throw new Error(`Unsupported keyType: ${keyType || 'undefined'}. Expected "OCR".`);
  }
  if (c.kdf !== 'scrypt') throw new Error(`Unsupported KDF: ${c.kdf}`);
  if (c.cipher !== 'aes-128-ctr') throw new Error(`Unsupported cipher: ${c.cipher}`);

  const effectivePassword = Buffer.from('ocrkey' + plainPassword, 'utf8');
  const salt = fromHex(c.kdfparams.salt);
  const iv = fromHex(c.cipherparams.iv);
  const ciphertext = fromHex(c.ciphertext);
  const macHex = (c.mac || '').toLowerCase();

  const dk = deriveKeyScrypt(effectivePassword, salt, {
    dklen: c.kdfparams.dklen,
    n: c.kdfparams.n,
    r: c.kdfparams.r,
    p: c.kdfparams.p,
  });

  const macCalc = keccak256(Buffer.concat([dk.slice(16, 32), ciphertext])).toString('hex');
  if (macCalc !== macHex) throw new Error('MAC mismatch (wrong password or corrupted file)');

  const encKey = dk.slice(0, 16);
  const decipher = crypto.createDecipheriv('aes-128-ctr', encKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return { raw: plaintext.toString('hex') };
  }
}

function decryptEvmKeystore(exportJson, password) {
  if (!exportJson || !exportJson.crypto) {
    throw new Error('Invalid EVM keystore JSON');
  }
  const c = exportJson.crypto;
  const passBuf = Buffer.from(password, 'utf8');
  const salt = fromHex(c.kdfparams.salt);
  let dk;
  if (c.kdf === 'scrypt') {
    const { n, r, p, dklen } = c.kdfparams;
    dk = crypto.scryptSync(passBuf, salt, dklen, { N: n, r, p, maxmem: 1024 * 1024 * 1024 });
  } else if (c.kdf === 'pbkdf2') {
    const { c: iters, dklen, prf } = c.kdfparams;
    const digest = (prf || 'hmac-sha256').replace('hmac-', '');
    dk = crypto.pbkdf2Sync(passBuf, salt, iters, dklen, digest);
  } else {
    throw new Error(`Unsupported KDF: ${c.kdf}`);
  }
  const iv = fromHex(c.cipherparams.iv);
  const ciphertext = fromHex(c.ciphertext);
  const macCalc = keccak256(Buffer.concat([dk.slice(16, 32), ciphertext])).toString('hex');
  if (macCalc !== (c.mac || '').toLowerCase()) throw new Error('EVM keystore MAC mismatch (wrong password?)');
  if (c.cipher !== 'aes-128-ctr') throw new Error(`Unsupported cipher: ${c.cipher}`);
  const encKey = dk.slice(0, 16);
  const decipher = crypto.createDecipheriv('aes-128-ctr', encKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length !== 32) throw new Error('Unexpected EVM private key length');
  return '0x' + plaintext.toString('hex');
}

function aes128EcbEncryptBlock(key16, plaintext16) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key16, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext16), cipher.final()]);
}

module.exports = {
  fromHex,
  hexToBuf,
  keccak256,
  deriveKeyScrypt,
  decryptOCR,
  decryptEvmKeystore,
  aes128EcbEncryptBlock,
};
