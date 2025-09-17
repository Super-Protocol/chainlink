import { ApiProperty } from '@nestjs/swagger';

export class QuoteResponseDto {
  @ApiProperty({
    description: 'Currency pair as array [base, quote]',
    type: [String],
    example: ['BTC', 'USD'],
  })
  pair: [string, string];

  @ApiProperty({
    description: 'Current price as string',
    example: '45000.00',
  })
  price: string;

  @ApiProperty({
    description:
      'Timestamp when quote was received (Unix timestamp in milliseconds)',
    example: 1640995200100,
  })
  receivedAt: number;
}
