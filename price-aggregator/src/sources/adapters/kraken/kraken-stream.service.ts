import { Injectable, Logger } from '@nestjs/common';

import {
  KrakenSubscribeRequest,
  KrakenSubscribeResponse,
  KrakenTickerData,
  KrakenUnsubscribeRequest,
  KrakenWebSocketMessage,
} from './kraken.types';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { Pair } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const WS_BASE_URL = 'wss://ws.kraken.com/v2';

@Injectable()
export class KrakenStreamService extends BaseStreamService {
  protected readonly logger = new Logger(KrakenStreamService.name);
  private requestId = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    appConfigService: AppConfigService,
    metricsService?: MetricsService,
  ) {
    const { stream } = appConfigService.get('sources.kraken');
    super(stream, metricsService);
  }

  protected getSourceName(): SourceName {
    return SourceName.KRAKEN;
  }

  protected getWsUrl(): string {
    return WS_BASE_URL;
  }

  protected pairToIdentifier(pair: Pair): string {
    const [base, quote] = pair;

    const wsBase = base === 'BTC' ? 'BTC' : base;
    const wsQuote = quote === 'USDT' ? 'USDT' : quote;

    const symbol = `${wsBase}/${wsQuote}`;
    this.logger.debug(
      `Converted pair [${pair.join(', ')}] to symbol: ${symbol}`,
    );
    return symbol;
  }

  protected async sendSubscribeMessage(symbols: string[]): Promise<void> {
    const requestId = this.requestId++;
    const request: KrakenSubscribeRequest = {
      method: 'subscribe',
      params: {
        channel: 'ticker',
        symbol: symbols,
        event_trigger: 'trades',
      },
      req_id: requestId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.logger.warn(
          `Subscribe timeout for symbols: ${symbols.join(', ')}, req_id: ${requestId}`,
        );
        reject(new Error('Subscribe timeout'));
      }, 10000);

      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this.logger.debug(
            `Successfully subscribed to: ${symbols.join(', ')}`,
          );
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this.logger.error(`Subscription rejected: ${error.message}`);
          reject(error);
        },
        timeout,
      });

      this.wsClient?.send(request);
    });
  }

  protected async sendUnsubscribeMessage(symbols: string[]): Promise<void> {
    const requestId = this.requestId++;
    const request: KrakenUnsubscribeRequest = {
      method: 'unsubscribe',
      params: {
        channel: 'ticker',
        symbol: symbols,
        event_trigger: 'trades',
      },
      req_id: requestId,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve();
      }, 5000);

      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          resolve();
        },
        timeout,
      });

      this.wsClient?.send(request);
    });
  }

  protected handleMessage(data: unknown): void {
    try {
      const message = data as Record<string, unknown>;

      if (message.channel !== 'heartbeat') {
        this.logger.verbose(
          `Received WebSocket message: ${JSON.stringify(data)}`,
        );
      }

      if (
        message.method &&
        message.req_id &&
        typeof message.req_id === 'number'
      ) {
        this.logger.verbose(
          `Processing response for req_id: ${message.req_id}`,
        );
        const pending = this.pendingRequests.get(message.req_id);
        if (pending) {
          const response = message as unknown as KrakenSubscribeResponse;
          this.logger.verbose(
            `Response details: success=${response.success}, error=${response.error}`,
          );
          if (response.success) {
            this.logger.verbose(
              `Subscription successful for req_id: ${message.req_id}`,
            );
            pending.resolve();
          } else {
            this.logger.error(
              `Subscription failed for req_id: ${message.req_id}, error: ${response.error}`,
            );
            if (response.error === 'Already subscribed') {
              this.logger.verbose('Treating "Already subscribed" as success');
              pending.resolve();
            } else {
              pending.reject(new Error(response.error || 'Unknown error'));
            }
          }
        } else {
          this.logger.debug(
            `No pending request found for req_id: ${message.req_id}`,
          );
        }
        return;
      }

      if (message.channel === 'ticker' && Array.isArray(message.data)) {
        const tickerMessage = message as KrakenWebSocketMessage;
        tickerMessage.data?.forEach((tickerData) => {
          this.processTickerData(tickerData);
        });
      } else if (message.channel !== 'heartbeat') {
        this.logger.verbose(
          `Unhandled message type: channel=${message.channel}, data type=${typeof message.data}`,
        );
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
      this.logger.error(`Raw message data: ${JSON.stringify(data)}`);
    }
  }

  private processTickerData(tickerData: KrakenTickerData): void {
    const symbol = tickerData.symbol;
    this.logger.verbose(`Processing ticker data for symbol: ${symbol}`);

    if (this.identifierToPairMap.has(symbol)) {
      this.emitQuote(symbol, {
        price: String(tickerData.last),
        receivedAt: new Date(),
      });
    } else {
      this.logger.warn(`No pair mapping found for symbol: ${symbol}`);
    }
  }

  protected onConnect(): void {
    this.requestId = 1;
  }

  protected onDisconnect(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
  }

  async disconnect(): Promise<void> {
    this.onDisconnect();
    return super.disconnect();
  }
}
