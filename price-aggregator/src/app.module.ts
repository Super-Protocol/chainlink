import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule, AppConfigService } from './config';
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
