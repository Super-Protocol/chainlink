import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetricsInterceptor } from './common/interceptors';
import { AppConfigModule, AppConfigService } from './config';
import { MarketDataModule } from './market-data';
import { MetricsModule } from './metrics/metrics.module';
import { QuotesModule } from './quotes';
import { SourcesModule } from './sources';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (configService: AppConfigService) => {
        const { level, isPrettyEnabled } = configService.get('logger');

        return {
          pinoHttp: {
            level,
            customLevels: {
              verbose: 10,
            },
            useOnlyCustomLevels: false,
            customLogLevel: (_req, res, err) => {
              if (err) return 'error';
              if (res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'debug';
            },
            customSuccessMessage: (req) => {
              return `request completed - ${req.method} ${req.url}`;
            },
            customErrorMessage: (req, res, err) => {
              return `request failed - ${req.method} ${req.url}: ${err.message}`;
            },
            serializers: {
              req: () => undefined,
            },
            ...(isPrettyEnabled && { transport: { target: 'pino-pretty' } }),
          },
        };
      },
    }),
    SourcesModule,
    QuotesModule,
    MetricsModule,
    MarketDataModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
