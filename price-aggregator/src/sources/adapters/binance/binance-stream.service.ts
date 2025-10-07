import { Injectable, Logger } from '@nestjs/common';

import { BinanceTickerData, WebSocketCommand } from './binance.types';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { StreamServiceOptions } from '../../quote-stream.interface';
import { Pair } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const DEFAULT_WS_URL = 'wss://stream.binance.us:9443/ws';
const SUBSCRIBE_METHOD = 'SUBSCRIBE';
const UNSUBSCRIBE_METHOD = 'UNSUBSCRIBE';

@Injectable()
export class BinanceStreamService extends BaseStreamService {
  protected readonly logger = new Logger(BinanceStreamService.name);
  private commandId = 1;
  private readonly wsUrl: string;
  private pendingCommands = new Map<
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
    const sourceConfig = appConfigService.get('sources.binance');
    const options: StreamServiceOptions = {
      ...sourceConfig.stream,
    };
    super(options, metricsService);
    this.wsUrl = sourceConfig?.stream?.wsUrl ?? DEFAULT_WS_URL;
  }

  protected getSourceName(): SourceName {
    return SourceName.BINANCE;
  }

  protected getWsUrl(): string {
    return this.wsUrl;
  }

  protected pairToIdentifier(pair: Pair): string {
    return `${pair.join('').toLowerCase()}@miniTicker`;
  }

  protected async sendSubscribeMessage(streams: string[]): Promise<void> {
    const commandId = this.commandId++;
    const command: WebSocketCommand = {
      method: SUBSCRIBE_METHOD,
      params: streams,
      id: commandId,
    };

    this.logger.debug('Sending subscribe command', {
      commandId,
      streams,
      command,
    });

    const timeout = setTimeout(() => {
      this.pendingCommands.delete(commandId);
      this.logger.debug(
        `Subscribe confirmation timeout for streams: ${streams.join(', ')} (this is OK, subscription may still work)`,
      );
    }, 10000);

    this.pendingCommands.set(commandId, {
      resolve: () => {
        clearTimeout(timeout);
        this.pendingCommands.delete(commandId);
        this.logger.debug(`Subscribed to: ${streams.join(', ')}`);
      },
      reject: (error: Error) => {
        clearTimeout(timeout);
        this.pendingCommands.delete(commandId);
        this.logger.warn(`Subscribe error for ${streams.join(', ')}`, error);
      },
      timeout,
    });

    this.wsClient?.send(command);
  }

  protected async sendUnsubscribeMessage(streams: string[]): Promise<void> {
    const commandId = this.commandId++;
    const command: WebSocketCommand = {
      method: UNSUBSCRIBE_METHOD,
      params: streams,
      id: commandId,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        resolve();
      }, 5000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve();
        },
        timeout,
      });

      this.wsClient?.send(command);
    });
  }

  protected handleMessage(data: unknown): void {
    try {
      const message = data as Record<string, unknown>;

      if ('id' in message && typeof message.id === 'number') {
        const pending = this.pendingCommands.get(message.id);
        if (pending) {
          if (message.result === null || message.result === undefined) {
            pending.resolve();
          } else if (message.error) {
            this.logger.error(`Command ${message.id} failed`, {
              error: message.error,
            });
            pending.reject(new Error(String(message.error)));
          } else {
            pending.resolve();
          }
        }
        return;
      }

      if (
        message.stream &&
        message.data &&
        typeof message.stream === 'string'
      ) {
        const tickerData = message.data as BinanceTickerData;
        const stream = message.stream;
        if (typeof tickerData.c === 'string') {
          this.logger.debug(`Received ticker data for ${stream}`, {
            price: tickerData.c,
          });
          this.emitQuote(stream, {
            price: String(tickerData.c),
            receivedAt: new Date(
              typeof tickerData.E === 'number' ? tickerData.E : Date.now(),
            ),
          });
        }
      } else if (
        message.e === '24hrMiniTicker' &&
        typeof message.s === 'string' &&
        typeof message.c === 'string'
      ) {
        const stream = `${message.s.toLowerCase()}@miniTicker`;
        this.logger.debug(`Received mini ticker for ${message.s}`, {
          price: message.c,
        });
        this.emitQuote(stream, {
          price: String(message.c),
          receivedAt: new Date(
            typeof message.E === 'number' ? message.E : Date.now(),
          ),
        });
      } else {
        this.logger.debug('Unhandled message format', { message });
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
    }
  }

  protected onDisconnect(): void {
    this.pendingCommands.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingCommands.clear();
  }

  async disconnect(): Promise<void> {
    this.onDisconnect();
    return super.disconnect();
  }
}
