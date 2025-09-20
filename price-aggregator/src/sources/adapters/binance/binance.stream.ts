import { Logger } from '@nestjs/common';

import { BinanceTickerData, BinanceStreamMessage } from './binance.types';
import { WebSocketClient } from '../../../common';
import { SourceApiException } from '../../exceptions';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://stream.binance.com:9443';
const STREAM_ALL_THRESHOLD = 20;
const QUOTE_ASSETS = [
  'USDT',
  'BUSD',
  'BTC',
  'ETH',
  'BNB',
  'USDC',
  'USD',
  'EUR',
];

interface StreamContext {
  messageQueue: Quote[];
  messagePromiseResolve: ((value: IteratorResult<Quote>) => void) | null;
  errorOccurred: Error | null;
  closed: boolean;
}

export class BinanceStream {
  private readonly logger = new Logger(BinanceStream.name);
  private readonly wsClients: Map<string, WebSocketClient> = new Map();

  async *streamQuotes(pairs: Pair[]): AsyncIterable<Quote> {
    const streamAll = this.shouldStreamAll(pairs);
    const wsUrl = this.buildWebSocketUrl(pairs, streamAll);
    const clientKey = this.getClientKey(pairs, streamAll);

    this.closeExistingClient(clientKey);

    const wsClient = this.createWebSocketClient(wsUrl);
    this.wsClients.set(clientKey, wsClient);

    const symbolToPair = this.createSymbolMap(pairs);
    const context: StreamContext = {
      messageQueue: [],
      messagePromiseResolve: null,
      errorOccurred: null,
      closed: false,
    };

    this.setupWebSocketHandlers(
      wsClient,
      streamAll,
      symbolToPair,
      context,
      clientKey,
    );

    wsClient.connect();

    try {
      yield* this.processMessages(context);
    } finally {
      this.cleanupClient(clientKey, wsClient);
    }

    if (context.errorOccurred) {
      throw new SourceApiException('binance', context.errorOccurred);
    }
  }

  closeAllStreams(): void {
    this.wsClients.forEach((client) => client.close());
    this.wsClients.clear();
  }

  private shouldStreamAll(pairs: Pair[]): boolean {
    return !pairs || pairs.length === 0 || pairs.length > STREAM_ALL_THRESHOLD;
  }

  private buildWebSocketUrl(pairs: Pair[], streamAll: boolean): string {
    if (streamAll) {
      return `${WS_BASE_URL}/ws/!miniTicker@arr`;
    }

    const streams = pairs
      .map((pair) => `${pair.join('').toLowerCase()}@miniTicker`)
      .join('/');
    return `${WS_BASE_URL}/stream?streams=${streams}`;
  }

  private getClientKey(pairs: Pair[], streamAll: boolean): string {
    return streamAll ? 'all' : pairs.map((p) => p.join('')).join(',');
  }

  private closeExistingClient(clientKey: string): void {
    const existingClient = this.wsClients.get(clientKey);
    if (existingClient) {
      existingClient.close();
    }
  }

  private createWebSocketClient(wsUrl: string): WebSocketClient {
    return new WebSocketClient({
      url: wsUrl,
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      pongTimeout: 10000,
    });
  }

  private createSymbolMap(pairs: Pair[]): Map<string, Pair> {
    const symbolToPair = new Map<string, Pair>();
    if (pairs && pairs.length > 0) {
      pairs.forEach((pair) => {
        symbolToPair.set(pair.join('').toUpperCase(), pair);
      });
    }
    return symbolToPair;
  }

  private setupWebSocketHandlers(
    wsClient: WebSocketClient,
    streamAll: boolean,
    symbolToPair: Map<string, Pair>,
    context: StreamContext,
    clientKey: string,
  ): void {
    wsClient.on('message', (data: unknown) => {
      try {
        const quotes = this.parseWebSocketMessage(
          data,
          streamAll,
          symbolToPair,
        );
        this.handleReceivedQuotes(quotes, context);
      } catch (error) {
        // Silently ignore parsing errors
      }
    });

    wsClient.on('error', (error: Error) => {
      context.errorOccurred = error;
      this.resolveWithError(context);
    });

    wsClient.on('close', () => {
      context.closed = true;
      this.resolveWithError(context);
    });

    wsClient.on('maxReconnectAttemptsReached', () => {
      context.closed = true;
      this.wsClients.delete(clientKey);
    });
  }

  private parseWebSocketMessage(
    data: unknown,
    streamAll: boolean,
    symbolToPair: Map<string, Pair>,
  ): Quote[] {
    if (streamAll) {
      return this.parseAllTickersMessage(data as BinanceTickerData[]);
    }
    return this.parseStreamMessage(data as BinanceStreamMessage, symbolToPair);
  }

  private parseAllTickersMessage(tickers: BinanceTickerData[]): Quote[] {
    const quotes: Quote[] = [];
    if (Array.isArray(tickers)) {
      tickers.forEach((tickerData) => {
        const quote = this.createQuoteFromTicker(tickerData, true);
        if (quote) {
          quotes.push(quote);
        }
      });
    }
    return quotes;
  }

  private parseStreamMessage(
    message: BinanceStreamMessage,
    symbolToPair: Map<string, Pair>,
  ): Quote[] {
    if (message.stream && message.data) {
      const quote = this.createQuoteFromTicker(
        message.data,
        false,
        symbolToPair,
      );
      return quote ? [quote] : [];
    }
    return [];
  }

  private createQuoteFromTicker(
    tickerData: BinanceTickerData,
    streamAll: boolean,
    symbolToPair?: Map<string, Pair>,
  ): Quote | null {
    const symbol = tickerData.s;
    let pair: Pair | undefined;

    if (streamAll) {
      pair = this.parseSymbolToPair(symbol);
    } else if (symbolToPair) {
      pair = symbolToPair.get(symbol);
    }

    if (pair && tickerData.c) {
      return {
        pair,
        price: String(tickerData.c),
        receivedAt: new Date(tickerData.E || Date.now()),
      };
    }

    return null;
  }

  private parseSymbolToPair(symbol: string): Pair | undefined {
    for (const quote of QUOTE_ASSETS) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        if (base) {
          return [base, quote];
        }
      }
    }
    return undefined;
  }

  private handleReceivedQuotes(quotes: Quote[], context: StreamContext): void {
    quotes.forEach((quote) => {
      if (context.messagePromiseResolve) {
        context.messagePromiseResolve({ value: quote, done: false });
        context.messagePromiseResolve = null;
      } else {
        context.messageQueue.push(quote);
      }
    });
  }

  private resolveWithError(context: StreamContext): void {
    if (context.messagePromiseResolve) {
      context.messagePromiseResolve({ value: {} as Quote, done: true });
      context.messagePromiseResolve = null;
    }
  }

  private async *processMessages(context: StreamContext): AsyncIterable<Quote> {
    while (!context.closed && !context.errorOccurred) {
      if (context.messageQueue.length > 0) {
        yield context.messageQueue.shift()!;
      } else {
        yield await new Promise<Quote>((resolve, reject) => {
          context.messagePromiseResolve = (result) => {
            if (result.done) {
              reject(context.errorOccurred || new Error('WebSocket closed'));
            } else {
              resolve(result.value);
            }
          };
        });
      }
    }
  }

  private cleanupClient(clientKey: string, wsClient: WebSocketClient): void {
    wsClient.close();
    this.wsClients.delete(clientKey);
  }
}
