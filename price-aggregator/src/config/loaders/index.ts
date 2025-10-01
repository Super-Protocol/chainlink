import { yamlLoader } from './yaml.loader';
import { Config } from '../types';

export function loader(): Config {
  const configFile = process.env.CONFIG_FILE || 'config.yaml';
  return yamlLoader(configFile);
}
