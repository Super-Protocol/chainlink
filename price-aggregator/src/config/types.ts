import { Static } from '@sinclair/typebox';

import { yamlValidationSchema } from './schema';

export type Config = Static<typeof yamlValidationSchema>;
