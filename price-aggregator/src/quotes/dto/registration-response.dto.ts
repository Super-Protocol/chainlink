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
    description: 'Timestamp of last successful quote',
    example: '2021-12-31T23:00:00.100Z',
  })
  lastQuoteAt: Date;

  @ApiProperty({
    description: 'Timestamp of last request',
    example: '2021-12-31T23:00:00.200Z',
  })
  lastRequestAt: Date;
}
