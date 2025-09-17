import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';

import { SourceException } from '../exceptions';

@Catch(SourceException)
export class SourcesExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SourcesExceptionFilter.name);

  catch(exception: SourceException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception.httpStatus;
    const message = exception.message;

    if (exception.name === 'SourceApiException') {
      this.logger.warn(
        `Source API error: ${message}`,
        exception.cause instanceof Error ? exception.cause.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
