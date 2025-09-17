import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class SourceDisabledException extends SourceException {
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(sourceName: string) {
    super(`Adapter ${sourceName} is disabled`, 'SourceDisabledException');
  }
}
