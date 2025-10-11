import { HttpStatus } from '@nestjs/common';

import { formatPairLabel } from '../../common';
import { Pair } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';
import { SourceException } from './source.exception';

export class QuoteTimeoutException extends SourceException {
  readonly httpStatus = HttpStatus.REQUEST_TIMEOUT;

  constructor(
    public readonly source: SourceName,
    public readonly pair: Pair,
    public readonly ttlMs: number,
  ) {
    const pairStr = formatPairLabel(pair);
    super(
      `Quote request timeout after ${ttlMs}ms for ${source} ${pairStr}`,
      'QuoteTimeoutException',
    );
  }
}
