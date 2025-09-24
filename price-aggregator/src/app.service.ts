import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): object {
    return {
      message: 'Price Proxy Service is running',
      timestamp: new Date().toISOString(),
    };
  }
}
