import { Injectable, Logger } from '@nestjs/common';

import { BinanceTickerData, WebSocketCommand } from './binance.types';
import { BaseStreamService } from '../../base-stream.service';
import { StreamServiceOptions } from '../../quote-stream.interface';
import { Pair } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://stream.binance.com:9443';
const SUBSCRIBE_METHOD = 'SUBSCRIBE';
const UNSUBSCRIBE_METHOD = 'UNSUBSCRIBE';

@Injectable()
export class BinanceStreamService extends BaseStreamService {
  protected readonly logger = new Logger(BinanceStreamService.name);
  private commandId = 1;
  private pendingCommands = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(options?: StreamServiceOptions) {
    super(options);
  }

  protected getWsUrl(): string {
    return `${WS_BASE_URL}/ws`;
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

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        this.logger.warn(
          `Subscribe timeout for streams: ${streams.join(', ')}`,
        );
        resolve();
      }, 10000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          this.logger.debug(`Subscribed to: ${streams.join(', ')}`);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          reject(error);
        },
        timeout,
      });

      this.wsClient?.send(command);
    });
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
        this.emitQuote(stream, {
          price: String(message.c),
          receivedAt: new Date(
            typeof message.E === 'number' ? message.E : Date.now(),
          ),
        });
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
