const {
  validateBySchema,
  helpers,
  Crypto,
  CryptoKeysTransformer,
} = require('@super-protocol/sdk-js');
const { Encoding } = require('@super-protocol/dto-js');
const { readFileContentAsString } = require('../utils/read-file');
const { solutionConfigurationSchema } = require('./configuration-schema');

const readConfiguration = async () => {
  const configurationFilePath =
    process.env.CONFIGURATION_PATH || '/sp/configurations/configuration.json';

  const configuration = readFileContentAsString(configurationFilePath, 'configuration file');
  if (!configuration) {
    throw new Error('Configuration file is required');
  }

  const solutionConfiguration = JSON.parse(configuration).solution;
  const { isValid, errors } = validateBySchema(solutionConfiguration, solutionConfigurationSchema);
  if (!isValid) {
    throw new Error(`Configuration file is not valid: ${errors?.[0]}`);
  }

  await verifySignature(solutionConfiguration);
  console.log('Configuration file signature is valid');

  return solutionConfiguration;
};

const verifySignature = async (solutionConfiguration) => {
  const { signature, ...payload } = solutionConfiguration;
  const configurationHash = helpers.calculateObjectHash(payload).hash;

  const publicKey = process.env.CONFIGURATION_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      'Failed to verify configuration signature. CONFIGURATION_PUBLIC_KEY is missing',
    );
  }

  const isVerified = await Crypto.verify({
    data: configurationHash,
    signature,
    publicKey: CryptoKeysTransformer.publicDerToKeyObj(Buffer.from(publicKey, Encoding.base64)),
  });
  if (!isVerified) {
    throw new Error(
      'Failed to verify configuration signature. Configuration signature verification failed',
    );
  }
};

module.exports = { readConfiguration };
