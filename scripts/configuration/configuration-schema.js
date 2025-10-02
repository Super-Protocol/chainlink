const { Type } = require('@sinclair/typebox');

const solutionConfigurationSchema = Type.Object({
  pgUser: Type.String({ minLength: 1 }),
  pgPassword: Type.String({ minLength: 1 }),
  pgDatabase: Type.String({ minLength: 1 }),
  pgPort: Type.Number({ minimum: 1, maximum: 65535 }),

  chainlinkEmail: Type.String({ minimum: 1 }),
  chainlinkPassword: Type.String({
    minLength: 16,
    description: 'Chainlink API password (>15 chars)',
  }),

  maxRestarts: Type.Number({ minimum: 1, default: 3 }),

  chainlinkKeystorePassword: Type.String({
    minLength: 16,
    description: 'Chainlink keystore password (>15 chars)',
  }),
  chainlinkChainId: Type.Number({ minimum: 1 }),
  chainlinkNodeName: Type.String({ minLength: 1 }),
  chainlinkRpcWsUrl: Type.String({
    pattern: '^wss?://.+',
    description: 'RPC WebSocket URL',
  }),
  chainlinkRpcHttpUrl: Type.String({
    pattern: '^https?://.+',
    description: 'RPC HTTP URL',
  }),
  chainlinkGasPrice: Type.Number({
    minimum: 0,
  }),
  chainlinkNodeScAddress: Type.String({
    pattern: '^0x[0-9a-fA-F]{40}$',
    description: 'Node smart contract address (EVM checksummed or lower/uppercase)',
  }),

  spSecretsDir: Type.String({
    minLength: 1,
    description: 'Path to secrets directory',
  }),
  totalNodes: Type.String({
    pattern: '^[0-9]+$',
    description: 'Total number of nodes as string',
  }),
  bootstrapNodes: Type.String({
    pattern: '^[0-9]+$',
    description: 'Number of bootstrap nodes as string',
  }),
  nodesList: Type.String({
    description: 'Space-separated list of node indices',
  }),
  primaryNodes: Type.String({
    description: 'Space-separated list of primary node indices',
  }),
  linkCa: Type.String({
    pattern: '^0x[0-9a-fA-F]{40}$',
    description: 'LINK token contract address',
  }),
  signature: Type.String({ minLength: 1 }),
  adminContractAddress: Type.String({
    pattern: '^0x[0-9a-fA-F]{40}$',
    description: 'Amin contract address',
  }),
  diamondContractAddress: Type.String({
    pattern: '^0x[0-9a-fA-F]{40}$',
    description: 'Diamond contract address',
  }),
  chainlinkFeedTemplatesDir: Type.String({ minLength: 1 }),
  faucetPrivateKey: Type.Optional(Type.String({
    minLength: 64,
    description: 'Faucet EVM account private key (hex with or without 0x)',
  })),
  balanceTopupCheckIntervalMs: Type.Optional(
    Type.Number({ minimum: 5000, description: 'Interval in milliseconds for periodic balance top-up checks' })
  ),
  faucetMinWei: Type.Optional(
    Type.Number({ minimum: 1, description: 'Minimum balance threshold in wei before triggering top-up' })
  ),
  faucetTopupWei: Type.Optional(
    Type.Number({ minimum: 1, description: 'Top-up amount in wei to transfer when below threshold' })
  ),
  balanceTopupRequired: Type.Optional(
    Type.Boolean({ description: 'If true, fail-fast on top-up or schedule failures' })
  ),
});

module.exports = { solutionConfigurationSchema };
