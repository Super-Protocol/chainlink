import { ApiProperty } from '@nestjs/swagger';

export class PairsResponseDto {
  @ApiProperty({
    description: 'Array of trading pairs',
    example: [
      ['BTC', 'USD'],
      ['ETH', 'USD'],
      ['BNB', 'BTC'],
    ],
    type: [[String]],
  })
  pairs: [string, string][];
}
