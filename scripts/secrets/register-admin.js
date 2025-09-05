const path = require('path');
const fs = require('fs');
const { BlockchainConnector, AdminService } = require('@super-protocol/sdk-js');
const { readFileContentAsString } = require('../utils/read-file');
const { decryptEvmKeystore } = require('./crypto-utils');

const registerAdmin = async () => {
  const secretsRoot = process.env.SP_SECRETS_DIR
    ? `${process.env.SP_SECRETS_DIR}`
    : '/sp/secrets';
  const secretsChainlinkRoot = `${secretsRoot}/cl-secrets`;
  const nodeNum = String(process.env.NODE_NUMBER || '1');
  const evmPath = path.join(secretsChainlinkRoot, nodeNum, 'evm_key.json');
  const ksPassword = process.env.CHAINLINK_KEYSTORE_PASSWORD;
  if (!ksPassword) {
    throw new Error('CHAINLINK_KEYSTORE_PASSWORD env var is required');
  }

  const evmJson = JSON.parse(fs.readFileSync(evmPath, 'utf8'));
  const adminAccountPrivateKey = decryptEvmKeystore(evmJson, ksPassword);

  const adminContractAddress = process.env.ADMIN_CONTRACT_ADDRESS;
  if (!adminContractAddress) {
    throw new Error('ADMIN_CONTRACT_ADDRESS env var is required');
  }

  const diamondContractAddress = process.env.DIAMOND_CONTRACT_ADDRESS;
  if (!diamondContractAddress) {
    throw new Error('DIAMOND_CONTRACT_ADDRESS env var is required');
  }

  const blockchainUrl = process.env.BLOCKCHAIN_URL;
  if (!blockchainUrl) {
    throw new Error('BLOCKCHAIN_URL env var is required');
  }
  const { certsPem, certPrivateKeyPem } = getOrderCerts();

  try {
    await BlockchainConnector.getInstance().initialize({
      contractAddress: diamondContractAddress,
      blockchainUrl: blockchainUrl,
    });

    const adminAddress =
      await BlockchainConnector.getInstance().initializeActionAccount(
        adminAccountPrivateKey
      );

    const adminService = new AdminService(adminContractAddress);

    if (await adminService.isAdmin(adminAddress)) {
      console.log(`Admin ${adminAddress} is already registered`);
      return;
    }

    await adminService.registerAdmin({
      certsPem,
      certPrivateKeyPem,
      adminAccountAddress: adminAddress,
    });

    console.log(`Admin ${adminAddress} successfully registered`);
  } catch (err) {
    console.error('register admin error', err.message);
    throw err;
  } finally {
    BlockchainConnector.getInstance().shutdown();
  }
};

const getOrderCerts = () => {
  const certsFolder = process.env.CERTS_FOLDER || '/sp/certs';

  const certFilePath = path.join(certsFolder, 'order_cert.crt');
  const cert = readFileContentAsString(certFilePath, 'order cert file');
  if (!cert) {
    throw new Error('Order cert file is required');
  }

  const certBundleFilePath = path.join(certsFolder, 'order_cert_ca_bundle.crt');
  const certBundle = readFileContentAsString(
    certBundleFilePath,
    'order cert CA bundle file'
  );
  if (!certBundle) {
    throw new Error('Order cert CA bundle file is required');
  }

  const certPrivateKeyFilePath = path.join(certsFolder, 'order_cert.key');
  const certPrivateKeyPem = readFileContentAsString(
    certPrivateKeyFilePath,
    'cert private key file'
  );
  if (!certPrivateKeyPem) {
    throw new Error('Order cert private key file is required');
  }

  return { certsPem: `${cert}\n${certBundle}`, certPrivateKeyPem };
};

module.exports = { registerAdmin };

if (require.main === module) {
  registerAdmin().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
