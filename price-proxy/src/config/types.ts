import { LoggerLevel, NodeEnvironment } from './constants';

export type Config = {
  port: number;
  environment: NodeEnvironment;
  logger: {
    level: LoggerLevel;
    isPrettyEnabled: boolean;
  };
  priceProxy: {
    refreshIntervalMs: number;
    requestTimeoutMs: number;
    maxRetries: number;
  };
};
