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

import { BatchQuotesDto, PairDto, QuoteResponseDto } from './dto';
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

    const pairs: Pair[] = batchQuotesDto.pairs.map((pairDto: PairDto) => [
      pairDto.base,
      pairDto.quote,
    ]);

    const quotes = await this.sourcesManager.fetchQuotes(source, pairs);
    return quotes.map((quote) => ({
      pair: quote.pair,
      price: quote.price,
      receivedAt: quote.receivedAt,
    }));
  }
}
