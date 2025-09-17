import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule, AppConfigService } from './config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
              verbose: 10
            },
            useOnlyCustomLevels: false,
            ...(isPrettyEnabled && { transport: { target: 'pino-pretty' } })
          }
        };
      }
    })
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
