export const NODE_ENVIRONMENTS = ['development', 'production', 'test'] as const;
export const LOGGER_LEVELS = [
  'error',
  'warn',
  'info',
  'debug',
  'verbose',
] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type LoggerLevel = (typeof LOGGER_LEVELS)[number];
