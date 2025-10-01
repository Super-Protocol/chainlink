import { readFileSync } from 'fs';

import { Value } from '@sinclair/typebox/value';
import { load } from 'js-yaml';

import { yamlValidationSchema } from '../schema';
import { Config } from '../types';
import { handleValidationError } from '../utils/validation-error.util';

export function yamlLoader(configPath?: string): Config {
  try {
    const yamlPath = configPath || process.env.CONFIG_FILE || 'config.yaml';

    let yamlContent: string;
    try {
      yamlContent = readFileSync(yamlPath, 'utf8');
    } catch (error) {
      throw new Error(
        `Failed to read YAML config file at ${yamlPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let parsedYaml: unknown;
    try {
      parsedYaml = load(yamlContent);
    } catch (error) {
      throw new Error(
        `Failed to parse YAML config file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!parsedYaml || typeof parsedYaml !== 'object') {
      throw new Error('YAML config file is empty or invalid');
    }

    // Handle empty proxy section (YAML parses it as null)
    if (
      parsedYaml &&
      typeof parsedYaml === 'object' &&
      'proxy' in parsedYaml &&
      parsedYaml.proxy === null
    ) {
      parsedYaml.proxy = {};
    }

    const validatedConfig = Value.Parse(yamlValidationSchema, parsedYaml);

    return validatedConfig;
  } catch (error) {
    handleValidationError(error, 'Failed to load YAML configuration');
  }
}
