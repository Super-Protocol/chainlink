import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class SourceNotFoundException extends SourceException {
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(sourceName: string) {
    super(
      `Adapter not found for source: ${sourceName}`,
      'SourceNotFoundException',
    );
  }
}
