import { HttpStatus } from '@nestjs/common';

import { SourceName } from '../source-name.enum';
import { SourceException } from './source.exception';

export class BatchSizeExceededException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(requestedSize: number, maxSize: number, sourceName: SourceName) {
    super(
      `Batch size ${requestedSize} exceeds maximum allowed size ${maxSize}`,
      sourceName,
    );
  }
}
