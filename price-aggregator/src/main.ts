import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors();
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Price Proxy API')
    .setDescription('Chainlink Price Proxy Service API')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('port');
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger UI: http://localhost:${port}/docs`);
}

process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('UnhandledRejection');
  logger.error(
    { err: reason, promise },
    'Unhandled promise rejection detected',
  );
});

process.on('uncaughtException', (error) => {
  const logger = new Logger('UncaughtException');
  logger.error({ err: error }, 'Uncaught exception detected');
});

bootstrap().catch((error) => {
  new Logger('Bootstrap').error({ err: error }, 'Failed to start application');
  process.exit(1);
});
