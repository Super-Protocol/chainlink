import { EventEmitter } from 'events';

import { Logger } from '@nestjs/common';
import * as WebSocket from 'ws';

export interface WebSocketClientOptions {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
  parseJson?: boolean;
}

export class WebSocketClient extends EventEmitter {
  private readonly logger = new Logger(WebSocketClient.name);
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private isClosing = false;
  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;

  constructor(private readonly options: WebSocketClientOptions) {
    super();
    this.options = {
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      pingInterval: 30000,
      pongTimeout: 10000,
      parseJson: true,
      ...options,
    };
  }

  private redactUrl(input: string): string {
    try {
      const u = new URL(input);
      u.search = '';
      u.hash = '';
      if (u.username) u.username = '***';
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return '[redacted-url]';
    }
  }

  private toReasonString(reason: Buffer | string): string {
    return Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason);
  }

  private safeEmitError(error: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
  }

  connect(): void {
    this.isClosing = false;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.logger.log(
          `WebSocket connected to ${this.redactUrl(this.options.url)}`,
        );
        const wasReconnecting = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        this.emit('open');
        if (wasReconnecting) {
          this.emit('reconnect');
        }
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const rawString = data.toString();

          if (!rawString || rawString.trim() === '') {
            return;
          }

          if (this.options.parseJson) {
            const message = JSON.parse(rawString);
            this.emit('message', message);
          } else {
            this.emit('message', rawString);
          }
        } catch (error) {
          if (this.options.parseJson) {
            this.logger.error(
              { rawData: data.toString(), error },
              'Failed to parse WebSocket message',
            );
          } else {
            this.emit('message', data.toString());
          }
        }
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error(
          { error: error.message, code: (error as NodeJS.ErrnoException).code },
          `WebSocket error: ${error.message}`,
        );
        this.safeEmitError(error);
      });

      this.ws.on('unexpected-response', (request, response) => {
        this.logger.error(
          {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
          },
          'Unexpected response from server',
        );
        response.resume();
        const error = new Error(
          `Unexpected server response: ${response.statusCode} ${response.statusMessage}`,
        );
        this.safeEmitError(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.logger.log(
          `WebSocket closed: ${code} - ${this.toReasonString(reason)}`,
        );
        this.stopHeartbeat();
        this.emit('close', code, reason);

        if (!this.isClosing && this.options.reconnect) {
          this.attemptReconnect();
        }
      });

      this.ws.on('pong', (data: Buffer) => {
        this.logger.verbose(`Pong received: ${this.toReasonString(data)}`);
        this.clearPongTimeout();
      });

      this.ws.on('ping', (data: Buffer) => {
        this.logger.verbose(`Ping received: ${this.toReasonString(data)}`);
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to create WebSocket: ${err.message}`,
        err.stack,
      );
      this.safeEmitError(err);
      if (this.options.reconnect) {
        this.attemptReconnect();
      }
    }
  }

  private startHeartbeat(): void {
    if (this.options.pingInterval) {
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.ping();
          this.setPongTimeout();
        }
      }, this.options.pingInterval);
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    this.clearPongTimeout();
  }

  private setPongTimeout(): void {
    if (this.options.pongTimeout) {
      this.clearPongTimeout();
      this.pongTimer = setTimeout(() => {
        this.logger.warn('Pong timeout, closing connection');
        this.ws?.terminate();
      }, this.options.pongTimeout);
    }
  }

  private clearPongTimeout(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= (this.options.maxReconnectAttempts ?? 10)) {
      this.logger.error('Max reconnect attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval ?? 5000;

    this.logger.log(
      `Attempting reconnect ${this.reconnectAttempts} after ${delay}ms`,
    );

    setTimeout(() => {
      if (!this.isClosing) {
        this.connect();
      }
    }, delay);
  }

  send<T>(data: T): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
    } else {
      this.logger.warn('WebSocket is not open, cannot send message');
    }
  }

  close(): void {
    this.isClosing = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
