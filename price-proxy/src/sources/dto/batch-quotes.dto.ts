import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, Length, ValidateNested } from 'class-validator';

import { Currency } from '../../config/pairs';

export class PairDto {
  @ApiProperty({
    description: 'Base currency code',
    example: Currency.BTC,
    minLength: 1,
    maxLength: 10,
  })
  @IsString()
  @Length(1, 10)
  base: string;

  @ApiProperty({
    description: 'Quote currency code',
    example: Currency.USD,
    minLength: 1,
    maxLength: 10,
  })
  @IsString()
  @Length(1, 10)
  quote: string;
}

export class BatchQuotesDto {
  @ApiProperty({
    description: 'Array of currency pairs to fetch quotes for',
    type: [PairDto],
    example: [
      { base: 'BTC', quote: 'USD' },
      { base: 'ETH', quote: 'USD' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PairDto)
  pairs: PairDto[];
}
