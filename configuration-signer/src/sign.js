'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { helpers, Crypto, CryptoKeysTransformer } = require('@super-protocol/sdk-js');
const { Encoding } = require('@super-protocol/dto-js');

async function run() {
  const configurationPath = process.argv[2];
  if (!configurationPath) {
    console.error('Please provide a configuration file path as an argument.');
    process.exit(1);
  }

  const privateKeyBase64 = process.argv[3];
  if (!privateKeyBase64) {
    console.error('Please provide a private key as an argument.');
    process.exit(1);
  }

  const isConfigurationReadable = await fs.promises
    .access(configurationPath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
  if (!isConfigurationReadable) {
    console.error(`Configuration file not found or not enough rigts: ${configurationPath}`);
    process.exit(1);
  }

  const configurationJson = await fs.promises.readFile(configurationPath, 'utf8');
  let configuration;
  try {
    configuration = JSON.parse(configurationJson);
  } catch (error) {
    console.error(`Failed to JSON parse configuration file: ${error.message}`);
    process.exit(1);
  }

  const configurationHash = helpers.calculateObjectHash(configuration).hash;
  const privateKeyObj = CryptoKeysTransformer.privateDerToKeyObj(
    Buffer.from(privateKeyBase64, Encoding.base64),
  );
  const configurationHashSignature = await Crypto.sign({
    data: configurationHash,
    privateKey: privateKeyObj,
  });

  configuration.signature = configurationHashSignature;

  await fs.promises.writeFile(configurationPath, JSON.stringify(configuration));

  console.log(`Configuration file signed successfully: ${configurationPath}`);
  process.exit(0);
}

run().catch((error) => {
  console.error('failed to run sign configuration', error);
  process.exit(1);
});
