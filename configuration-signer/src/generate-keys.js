'use strict';
const { CryptoKeysTransformer, Crypto } = require('@super-protocol/sdk-js');
const { CryptoAlgorithm, Encoding } = require('@super-protocol/dto-js');

async function run() {
  const keys = await Crypto.generateKeys(CryptoAlgorithm.ECIES);

  const publicKeyBase64 = CryptoKeysTransformer.publicKeyObjToDer(keys.publicKey).toString(
    Encoding.base64,
  );
  const privateKeyBase64 = CryptoKeysTransformer.privateKeyObjToDer(keys.privateKey).toString(
    Encoding.base64,
  );
  console.log('Public Key:', publicKeyBase64);
  console.log('Private Key:', privateKeyBase64);
}

run().catch((error) => {
  console.error('Failed to generate keys', error);
  process.exit(1);
});
