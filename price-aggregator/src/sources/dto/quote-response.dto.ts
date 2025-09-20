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
    description: 'Timestamp when quote was received',
    example: '2021-12-31T23:00:00.100Z',
  })
  receivedAt: Date;
}
