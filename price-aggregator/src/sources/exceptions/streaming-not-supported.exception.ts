import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class StreamingNotSupportedException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(sourceName: string) {
    super(
      `Source ${sourceName} does not support streaming`,
      'StreamingNotSupportedException',
    );
  }
}
