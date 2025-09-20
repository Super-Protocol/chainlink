import { ApiProperty } from '@nestjs/swagger';

export class PairsBySourceResponseDto {
  @ApiProperty({
    description: 'Data source name',
    example: 'binance',
  })
  source: string;

  @ApiProperty({
    description: 'Array of currency pairs as arrays [base, quote]',
    type: [[String]],
    example: [
      ['BTC', 'USD'],
      ['ETH', 'USD'],
    ],
  })
  pairs: [string, string][];
}
