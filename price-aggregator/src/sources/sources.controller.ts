import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';

import { BatchQuotesDto, QuoteResponseDto, PairsResponseDto } from './dto';
import { Pair } from './source-adapter.interface';
import { SourceName } from './source-name.enum';
import { SourcesManagerService } from './sources-manager.service';

@ApiTags('Sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesManager: SourcesManagerService) {}

  @Get(':source/:baseCurrency/:quoteCurrency')
  @ApiOperation({
    summary: 'Fetch quote for currency pair from specific source',
    description:
      'Get current price quote for a currency pair from the specified data source',
    deprecated: true,
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
  async fetchQuote(
    @Param('source') source: string,
    @Param('baseCurrency') baseCurrency: string,
    @Param('quoteCurrency') quoteCurrency: string,
  ): Promise<QuoteResponseDto> {
    const pair: Pair = [baseCurrency, quoteCurrency];

    const quote = await this.sourcesManager.fetchQuote(source, pair);
    return {
      source,
      pair: quote.pair,
      price: quote.price,
      receivedAt: quote.receivedAt,
    };
  }

  @Post(':source/batch')
  @ApiOperation({
    summary: 'Fetch quotes for multiple currency pairs',
    description:
      'Get current price quotes for multiple currency pairs from the specified data source',
    deprecated: true,
  })
  @ApiParam({
    name: 'source',
    enum: SourceName,
    description: 'Data source name',
    example: SourceName.BINANCE,
  })
  @ApiBody({
    type: BatchQuotesDto,
    description: 'Array of currency pairs to fetch quotes for',
  })
  @ApiResponse({
    status: 200,
    description: 'Quotes successfully retrieved',
    type: [QuoteResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid parameters or source does not support batch requests',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found or disabled',
  })
  async fetchBatchQuotes(
    @Param('source') source: string,
    @Body() batchQuotesDto: BatchQuotesDto,
  ): Promise<QuoteResponseDto[]> {
    if (!batchQuotesDto.pairs || batchQuotesDto.pairs.length === 0) {
      throw new BadRequestException('At least one pair must be provided');
    }

    const pairs: Pair[] = batchQuotesDto.pairs;

    const quotes = await this.sourcesManager.fetchQuotes(source, pairs);
    return quotes.map((quote) => ({
      source,
      pair: quote.pair,
      price: quote.price,
      receivedAt: quote.receivedAt,
    }));
  }

  @Get(':source/pairs')
  @ApiOperation({
    summary: 'Get available trading pairs from specific source',
    description:
      'Retrieve all available trading pairs from the specified data source',
  })
  @ApiParam({
    name: 'source',
    enum: SourceName,
    description: 'Data source name',
    example: SourceName.BINANCE,
  })
  @ApiResponse({
    status: 200,
    description: 'Trading pairs successfully retrieved',
    type: PairsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Source does not support getting pairs',
  })
  @ApiResponse({
    status: 404,
    description: 'Source not found or disabled',
  })
  async getPairs(@Param('source') source: string): Promise<PairsResponseDto> {
    const pairs = await this.sourcesManager.getPairs(source);
    return { pairs };
  }
}
