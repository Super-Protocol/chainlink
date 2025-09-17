import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class FeatureNotImplementedException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(featureName: string, sourceName?: string) {
    const sourceStr = sourceName ? ` in ${sourceName}` : '';
    super(
      `Feature '${featureName}' is not implemented${sourceStr}`,
      'FeatureNotImplementedException',
    );
  }
}
