import { Controller, Get, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

import {
  QuoteResponseDto,
  PairsBySourceResponseDto,
  AllRegistrationsResponseDto,
} from './dto';
import { PairCleanupService } from './pair-cleanup.service';
import { PairService } from './pair.service';
import { QuotesService } from './quotes.service';
import { Pair } from '../sources/source-adapter.interface';
import { SourceName } from '../sources/source-name.enum';

@ApiTags('Quotes')
@Controller('quote')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly pairService: PairService,
    private readonly pairCleanupService: PairCleanupService,
  ) {}

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
    return await this.quotesService.getPairsBySource(source);
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
    return await this.quotesService.getAllRegistrations();
  }

  @Post('cleanup')
  @ApiOperation({
    summary: 'Manually trigger cleanup of inactive pairs',
    description:
      'Manually trigger cleanup process to remove pairs that have not been requested for the configured timeout period',
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed successfully',
    schema: {
      type: 'object',
      properties: {
        removedCount: {
          type: 'number',
          description: 'Number of inactive pairs removed',
        },
      },
    },
  })
  async manualCleanup(): Promise<{ removedCount: number }> {
    const removedCount = this.pairCleanupService.manualCleanup();
    return { removedCount };
  }
}
