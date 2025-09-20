import { Controller, Get, Param, ParseEnumPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

import {
  QuoteResponseDto,
  PairsBySourceResponseDto,
  AllRegistrationsResponseDto,
} from './dto';
import { QuotesService } from './quotes.service';
import { Pair } from '../sources/source-adapter.interface';
import { SourceName } from '../sources/source-name.enum';

@ApiTags('Quotes')
@Controller('quote')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get(':source/:baseCurrency/:quoteCurrency')
  @ApiOperation({
    summary: 'Get quote for currency pair from specific source',
    description:
      'Get current price quote for a currency pair from the specified data source',
  })
  @ApiParam({
    name: 'source',
    enum: SourceName,
    description: 'Data source name',
    example: SourceName.BINANCE,
  })
  @ApiParam({
    name: 'baseCurrency',
    description: 'Base currency code',
    example: 'BTC',
  })
  @ApiParam({
    name: 'quoteCurrency',
    description: 'Quote currency code',
    example: 'USD',
  })
  @ApiResponse({
    status: 200,
    description: 'Quote successfully retrieved',
    type: QuoteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid parameters provided',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found or disabled',
  })
  async getQuote(
    @Param('source', new ParseEnumPipe(SourceName)) source: SourceName,
    @Param('baseCurrency') baseCurrency: string,
    @Param('quoteCurrency') quoteCurrency: string,
  ): Promise<QuoteResponseDto> {
    const pair: Pair = [baseCurrency, quoteCurrency];
    return this.quotesService.getQuote(source, pair);
  }

  @Get('pairs/:source')
  @ApiOperation({
    summary: 'Get registered pairs for specific source',
    description:
      'Get all currency pairs that have been registered for the specified data source',
  })
  @ApiParam({
    name: 'source',
    enum: SourceName,
    description: 'Data source name',
    example: SourceName.BINANCE,
  })
  @ApiResponse({
    status: 200,
    description: 'Registered pairs successfully retrieved',
    type: PairsBySourceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid source parameter',
  })
  async getPairsBySource(
    @Param('source', new ParseEnumPipe(SourceName)) source: SourceName,
  ): Promise<PairsBySourceResponseDto> {
    return this.quotesService.getPairsBySource(source);
  }

  @Get('registrations')
  @ApiOperation({
    summary: 'Get all pair-source registrations',
    description:
      'Get all registered pair-source combinations with their tracking information',
  })
  @ApiResponse({
    status: 200,
    description: 'All registrations successfully retrieved',
    type: AllRegistrationsResponseDto,
  })
  async getAllRegistrations(): Promise<AllRegistrationsResponseDto> {
    return this.quotesService.getAllRegistrations();
  }
}
