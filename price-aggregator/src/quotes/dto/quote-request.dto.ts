import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class QuoteRequestDto {
  @ApiProperty({
    description: 'Base currency code',
    example: 'BTC',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  baseCurrency: string;

  @ApiProperty({
    description: 'Quote currency code',
    example: 'USD',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @Length(1, 50)
  quoteCurrency: string;
}
