import { ApiProperty } from '@nestjs/swagger';

export class PairWithCacheDto {
  @ApiProperty({
    description: 'Currency pair as array [base, quote]',
    type: [String],
    example: ['BTC', 'USD'],
  })
  pair: [string, string];

  @ApiProperty({
    description: 'Cached price value if available',
    example: '42350.50',
    required: false,
  })
  cachedPrice?: string;

  @ApiProperty({
    description: 'Timestamp when price was originally received',
    example: '2021-12-31T23:00:00.150Z',
    required: false,
  })
  receivedAt?: Date;

  @ApiProperty({
    description: 'Timestamp when price was cached',
    example: '2021-12-31T23:00:00.160Z',
    required: false,
  })
  cachedAt?: Date;
}

export class PairsBySourceResponseDto {
  @ApiProperty({
    description: 'Data source name',
    example: 'binance',
  })
  source: string;

  @ApiProperty({
    description: 'Array of currency pairs with optional cached data',
    type: [PairWithCacheDto],
  })
  pairs: PairWithCacheDto[];
}
