import { envLoader } from './env.loader';
import { Config } from '../types';

export function loader(): Config {
  return envLoader();
}
