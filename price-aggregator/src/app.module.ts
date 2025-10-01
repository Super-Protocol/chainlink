import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetricsInterceptor } from './common/interceptors';
import { AppConfigModule, AppConfigService } from './config';
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
