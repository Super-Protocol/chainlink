import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';
import { SourceName } from '../source-name.enum';

export class SourceUnauthorizedException extends SourceException {
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor(public readonly sourceName: SourceName) {
    super(
      `Source ${sourceName} returned 401 Unauthorized. API key may be invalid or missing.`,
      SourceUnauthorizedException.name,
    );
  }
}
