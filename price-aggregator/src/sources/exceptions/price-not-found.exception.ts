import { HttpStatus } from '@nestjs/common';

import { formatPairLabel } from '../../common';
import { Pair } from '../source-adapter.interface';
import { SourceException } from './source.exception';

export class PriceNotFoundException extends SourceException {
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(pair: Pair, sourceName?: string) {
    const pairStr = formatPairLabel(pair);
    const sourceStr = sourceName ? ` from ${sourceName}` : '';
    super(
      `No price found for ${pairStr}${sourceStr}`,
      'PriceNotFoundException',
    );
  }
}
