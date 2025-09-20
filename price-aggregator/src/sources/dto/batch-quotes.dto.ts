import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, Length, ArrayMinSize } from 'class-validator';

import { IsArrayOfPairs } from '../../common/decorators';

export class PairDto {
  @ApiProperty({
    description: 'Base currency code',
    example: 'BTC',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  base: string;

  @ApiProperty({
    description: 'Quote currency code',
    example: 'USD',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  quote: string;
}

export class BatchQuotesDto {
  @ApiProperty({
    description: 'Array of currency pairs as arrays [base, quote]',
    type: [[String]],
    example: [
      ['BTC', 'USD'],
      ['ETH', 'USD'],
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one pair must be provided' })
  @IsArrayOfPairs()
  pairs: [string, string][];
}
