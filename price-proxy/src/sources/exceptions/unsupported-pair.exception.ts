import { HttpStatus } from '@nestjs/common';

import { Pair } from '../source-adapter.interface';
import { SourceException } from './source.exception';

export class UnsupportedPairException extends SourceException {
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(pair: Pair, sourceName: string) {
    const pairStr = pair.join('/');
    super(
      `Unsupported pair ${pairStr} for source ${sourceName}`,
      'UnsupportedPairException',
    );
  }
}
