import { ApiProperty } from '@nestjs/swagger';

import { SourceName } from '../../sources';

export class RegistrationResponseDto {
  @ApiProperty({
    description: 'Currency pair as array [base, quote]',
    type: [String],
    example: ['BTC', 'USD'],
  })
  pair: [string, string];

  @ApiProperty({
    description: 'Data source name',
    example: SourceName.BINANCE,
    enum: SourceName,
  })
  source: SourceName;

  @ApiProperty({
    description: 'Timestamp when pair was first registered',
    example: '2021-12-31T23:00:00.000Z',
  })
  registeredAt: Date;

  @ApiProperty({
    description: 'Timestamp of last successful fetch',
    example: '2021-12-31T23:00:00.100Z',
  })
  lastFetchAt: Date;

  @ApiProperty({
    description: 'Timestamp of last successful response',
    example: '2021-12-31T23:00:00.200Z',
  })
  lastResponseAt: Date;

  @ApiProperty({
    description: 'Timestamp of last request',
    example: '2021-12-31T23:00:00.200Z',
  })
  lastRequestAt: Date;

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
