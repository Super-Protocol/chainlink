import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class SourceUnsupportedException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(sourceName: string, supportedSources: string[]) {
    const supported = supportedSources.join(', ');
    super(
      `Unsupported source: ${sourceName}. Supported sources: ${supported}`,
      'SourceUnsupportedException',
    );
  }
}
