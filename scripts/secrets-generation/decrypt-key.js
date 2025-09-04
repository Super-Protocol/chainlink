#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const { fromHex, keccak256, deriveKeyScrypt } = require('./crypto-utils');

function decryptOCR(exportJson, plainPassword) {
  if (!exportJson || !exportJson.crypto) {
    throw new Error('Invalid JSON: crypto section missing');
  }
  const { keyType, crypto: c } = exportJson;

  if (!keyType || keyType !== 'OCR') {
    throw new Error(`Unsupported keyType: ${keyType || 'undefined'}. Expected "OCR".`);
  }
  if (c.kdf !== 'scrypt') {
    throw new Error(`Unsupported KDF: ${c.kdf}. Only scrypt is supported in this script.`);
  }
  if (c.cipher !== 'aes-128-ctr') {
    throw new Error(`Unsupported cipher: ${c.cipher}. Only aes-128-ctr is supported in this script.`);
  }

  // Chainlink adds an "adulteration" prefix for exported JSON passwords:
  // see core/services/keystore/keys/ocrkey/export.go -> adulteratedPassword()
  const effectivePassword = Buffer.from('ocrkey' + plainPassword, 'utf8');

  const salt = fromHex(c.kdfparams.salt);
  const iv = fromHex(c.cipherparams.iv);
  const ciphertext = fromHex(c.ciphertext);
  const macHex = c.mac.toLowerCase();

  const dk = deriveKeyScrypt(effectivePassword, salt, {
    dklen: c.kdfparams.dklen,
    n: c.kdfparams.n,
    r: c.kdfparams.r,
    p: c.kdfparams.p,
  });

  // go-ethereum keystore MAC: keccak256(dk[16:32] || ciphertext)
  const macCalc = keccak256(Buffer.concat([dk.slice(16, 32), ciphertext])).toString('hex');
  if (macCalc !== macHex) {
    throw new Error('MAC mismatch (wrong password or corrupted file)');
  }

  const encKey = dk.slice(0, 16); // AES-128 key
  const decipher = crypto.createDecipheriv('aes-128-ctr', encKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // The plaintext for OCR is JSON (keyBundleRawData)
  let parsed;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Fallback: return raw buffer if not valid JSON
    return { raw: plaintext.toString('hex') };
  }
  return parsed;
}

function main() {
  const password = process.env.KEY_PASSWORD;
  if (!password) {
    console.error('ERROR: Please set KEY_PASSWORD env var to the export password.');
    process.exit(1);
  }

  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'); // stdin if no file
  const exported = JSON.parse(input);

  const out = decryptOCR(exported, password);
  // Pretty-print decrypted payload
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main();
}
