import { Injectable, Logger } from '@nestjs/common';

import { MESSAGE_TYPES } from './cryptocompare.types';
import { WebSocketClient } from '../../../common';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { Pair } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const WS_BASE_URL = 'wss://streamer.cryptocompare.com/v2';
const AGGREGATE_INDEX = 'CCCAGG';

interface SubscriptionMessage {
  action: 'SubAdd' | 'SubRemove';
  subs: string[];
}

@Injectable()
export class CryptoCompareStreamService extends BaseStreamService {
  protected readonly logger = new Logger(CryptoCompareStreamService.name);
  private readonly apiKey?: string;
  private readonly unsupportedIdentifiers = new Set<string>();

  constructor(
    appConfigService: AppConfigService,
    metricsService?: MetricsService,
  ) {
    const { stream, apiKey } = appConfigService.get('sources.cryptocompare');
    super(stream, metricsService);
    this.apiKey = apiKey;
  }
  protected getSourceName(): SourceName {
    return SourceName.CRYPTOCOMPARE;
  }

  protected getWsUrl(): string {
    return this.apiKey
      ? `${WS_BASE_URL}?api_key=${this.apiKey}&format=streamer`
      : `${WS_BASE_URL}?format=streamer`;
  }

  protected getWebSocketClientOptions(): Partial<
    ConstructorParameters<typeof WebSocketClient>[0]
  > {
    return { parseJson: false };
  }

  protected pairToIdentifier(pair: Pair): string {
    const [base, quote] = pair;
    return this.buildChannel(base.toUpperCase(), quote.toUpperCase());
  }

  protected async sendSubscribeMessage(channels: string[]): Promise<void> {
    const subscribeMessage: SubscriptionMessage = {
      action: 'SubAdd',
      subs: channels,
    };
    this.wsClient?.send(JSON.stringify(subscribeMessage));
  }

  protected async sendUnsubscribeMessage(channels: string[]): Promise<void> {
    const unsubscribeMessage: SubscriptionMessage = {
      action: 'SubRemove',
      subs: channels,
    };
    this.wsClient?.send(JSON.stringify(unsubscribeMessage));
  }

  protected handleMessage(data: unknown): void {
    const message = data as string;
    try {
      this.logger.debug(`Received message: ${message}`);

      const parts = message.split('~');
      if (parts.length < 2) {
        this.logger.debug(`Ignoring short message: ${message}`);
        return;
      }

      const messageType = parts[0];
      this.logger.debug(`Message type: ${messageType}`);

      if (messageType === MESSAGE_TYPES.CURRENTAGG) {
        this.handleAggregateMessage(parts);
      } else if (messageType === MESSAGE_TYPES.CURRENT) {
        this.handleCurrentMessage(parts);
      } else if (messageType === MESSAGE_TYPES.HEARTBEAT) {
        this.logger.debug('Received heartbeat');
      } else if (messageType === MESSAGE_TYPES.ERROR) {
        this.handleErrorMessage(parts);
      } else {
        this.logger.debug(
          `Unknown message type: ${messageType}, full message: ${message}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error handling message: ${message}`, error);
    }
  }

  private handleAggregateMessage(parts: string[]): void {
    if (parts.length < 6) return;

    const [, , fromSymbol, toSymbol, , priceStr] = parts;
    const channel = this.buildChannel(fromSymbol, toSymbol);
    const price = parseFloat(priceStr);

    if (!isNaN(price)) {
      this.emitQuote(channel, {
        price: String(price),
        receivedAt: new Date(),
      });
    }
  }

  private handleCurrentMessage(parts: string[]): void {
    if (parts.length < 6) return;

    const [, , fromSymbol, toSymbol, , priceStr] = parts;
    const channel = this.buildChannel(fromSymbol, toSymbol);
    const price = parseFloat(priceStr);

    if (!isNaN(price)) {
      this.emitQuote(channel, {
        price: String(price),
        receivedAt: new Date(),
      });
    }
  }

  private buildChannel(base: string, quote: string): string {
    return `5~${AGGREGATE_INDEX}~${base}~${quote}`;
  }

  private handleErrorMessage(parts: string[]): void {
    if (parts.length < 6) {
      this.logger.warn(`Invalid error message format: ${parts.join('~')}`);
      return;
    }

    const [, errorType, errorMessage, , exchange, fromSymbol, toSymbol] = parts;

    if (errorType === 'SUBSCRIPTION_UNRECOGNIZED') {
      const identifier = this.buildChannel(fromSymbol, toSymbol);
      this.unsupportedIdentifiers.add(identifier);

      const pair = this.getPairByIdentifier(identifier);
      const pairStr = pair ? pair.join('/') : `${fromSymbol}/${toSymbol}`;

      this.logger.warn(
        { pair: pairStr, exchange, errorType, errorMessage },
        `Pair ${pairStr} is not supported by CryptoCompare. Adding to blacklist.`,
      );

      this.subscribedIdentifiers.delete(identifier);
    } else {
      this.logger.warn(
        { errorType, errorMessage, exchange, fromSymbol, toSymbol },
        `CryptoCompare error: ${errorType} - ${errorMessage}`,
      );
    }
  }

  protected async subscribeToIdentifiers(identifiers: string[]): Promise<void> {
    const supportedIdentifiers = identifiers.filter((identifier) => {
      if (this.unsupportedIdentifiers.has(identifier)) {
        const pair = this.getPairByIdentifier(identifier);
        const pairStr = pair ? pair.join('/') : identifier;
        this.logger.debug(
          { pair: pairStr },
          `Skipping subscription to unsupported pair: ${pairStr}`,
        );
        return false;
      }
      return true;
    });

    if (supportedIdentifiers.length === 0) {
      return;
    }

    await super.subscribeToIdentifiers(supportedIdentifiers);
  }
}
