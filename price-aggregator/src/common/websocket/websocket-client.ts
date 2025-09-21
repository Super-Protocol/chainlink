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
      ...options,
    };
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.logger.log(`WebSocket connected to ${this.options.url}`);
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
          const message = JSON.parse(data.toString());
          this.emit('message', message);
        } catch (error) {
          this.logger.error('Failed to parse WebSocket message', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error('WebSocket error', error);
        this.emit('error', error);
      });

      this.ws.on('close', (code: number, reason: string) => {
        this.logger.log(`WebSocket closed: ${code} - ${reason}`);
        this.stopHeartbeat();
        this.emit('close', code, reason);

        if (!this.isClosing && this.options.reconnect) {
          this.attemptReconnect();
        }
      });

      this.ws.on('pong', () => {
        this.clearPongTimeout();
      });
    } catch (error) {
      this.logger.error('Failed to create WebSocket', error);
      this.emit('error', error);
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
