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
    description:
      'Timestamp when pair was first registered (Unix timestamp in milliseconds)',
    example: 1640995200000,
  })
  registeredAt: number;

  @ApiProperty({
    description:
      'Timestamp of last successful quote (Unix timestamp in milliseconds)',
    example: 1640995200100,
  })
  lastQuoteAt: number;

  @ApiProperty({
    description: 'Timestamp of last request (Unix timestamp in milliseconds)',
    example: 1640995200200,
  })
  lastRequestAt: number;
}
