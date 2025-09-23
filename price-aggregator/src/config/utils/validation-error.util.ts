import { TSchema } from '@sinclair/typebox';
import { AssertError } from '@sinclair/typebox/value';

type SchemaLike = TSchema & {
  anyOf?: TSchema[];
  schema?: TSchema;
  description?: string;
};

function extractDescription(
  schema: SchemaLike | undefined,
): string | undefined {
  if (!schema) return undefined;
  if (typeof schema.description === 'string') return schema.description;
  if (
    (schema as SchemaLike).schema &&
    typeof (schema as SchemaLike).schema!.description === 'string'
  ) {
    return (schema as SchemaLike).schema!.description as string;
  }
  if (Array.isArray((schema as SchemaLike).anyOf)) {
    for (const variant of (schema as SchemaLike).anyOf!) {
      const v = variant as SchemaLike;
      if (typeof v.description === 'string') return v.description;
    }
  }
  return undefined;
}

function getSchemaHint(path?: string): string {
  if (!path) return '';

  if (path.includes('port')) {
    return '\nTip: port should be a number between 1 and 65535';
  }
  if (path.includes('priceProxy')) {
    return '\nTip: priceProxy settings should be positive numbers (milliseconds for timeouts, count for retries)';
  }
  if (path.includes('logger')) {
    return '\nTip: logger.level should be one of: error, warn, info, debug, verbose';
  }

  return '';
}

function handleSchemaValidationError(
  error: AssertError,
  context: string,
): never {
  const errorDetails = error.error;
  const isYamlContext = context.includes('YAML');

  if (!errorDetails) {
    const genericMessage = isYamlContext
      ? 'YAML configuration validation failed.\n' +
        'Please verify your YAML configuration structure.\n' +
        '\nFor help with configuration, see:\n' +
        '- config.example.yaml file for reference\n' +
        '- Schema definitions in src/config/schema/'
      : 'Environment variables validation failed.\n' +
        'Please verify your environment variables structure.\n' +
        '\nFor help with environment variables, see:\n' +
        '- .env.example file for reference\n' +
        '- Schema definitions in src/config/schema/';

    throw new Error(genericMessage, { cause: error });
  }

  const pathDisplay = errorDetails.path
    ? ` at path "${errorDetails.path}"`
    : '';
  const valueDisplay =
    errorDetails.value !== undefined
      ? ` (received: ${JSON.stringify(errorDetails.value)})`
      : '';

  const fieldDescription = extractDescription(
    errorDetails.schema as SchemaLike,
  );

  const fieldName = errorDetails.path
    ? errorDetails.path.replace('/', '')
    : 'unknown';
  const schemaHint = getSchemaHint(errorDetails.path);

  if (isYamlContext) {
    const yamlMessage = [
      `YAML configuration validation failed: ${fieldName}`,
      `Expected: ${errorDetails.message}${valueDisplay}`,
      fieldDescription ? `Description: ${fieldDescription}` : '',
      `Please set the correct value for the ${fieldName} field in your YAML config.`,
      'Check your config.yaml file.',
      schemaHint,
      '',
      'For help with configuration, see:',
      '- config.example.yaml file for reference',
      '- Schema definitions in src/config/schema/yaml.schema.ts',
    ]
      .filter(Boolean)
      .join('\n');

    throw new Error(yamlMessage);
  } else {
    const envMessage = [
      `Environment variable validation failed: ${fieldName}`,
      `Expected: ${errorDetails.message}${valueDisplay}`,
      fieldDescription ? `Description: ${fieldDescription}` : '',
      `Please set the correct value for the ${fieldName} environment variable.`,
      'Check your .env file or system environment variables.',
      schemaHint,
      '',
      'For help with environment variables, see:',
      '- .env.example file for reference',
      '- Schema definitions in src/config/schema/env.schema.ts',
    ]
      .filter(Boolean)
      .join('\n');

    throw new Error(envMessage);
  }
}

function handleGenericError(error: unknown, context: string): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const message = [
    context,
    `Error: ${errorMessage}`,
    'Please check your environment variables and try again.',
  ].join('\n');

  throw new Error(message, { cause: error });
}

export function handleValidationError(error: unknown, context: string): never {
  if (error instanceof AssertError) {
    handleSchemaValidationError(error, context);
  }

  handleGenericError(error, context);
}
