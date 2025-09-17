import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class BatchNotSupportedException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(sourceName: string) {
    super(
      `Source ${sourceName} does not support batch requests`,
      'BatchNotSupportedException',
    );
  }
}
