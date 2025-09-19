import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';

import { SourceApiException, SourceException } from '../exceptions';

@Catch(SourceException)
export class SourcesExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SourcesExceptionFilter.name);

  catch(exception: SourceException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = exception.httpStatus;
    const message = exception.message;

    if (exception instanceof SourceApiException) {
      this.logger.warn(
        `Source API error: ${message}`,
        exception.cause instanceof Error ? exception.cause.stack : undefined,
      );
      if (exception.statusCode) {
        status = exception.statusCode;
      }
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
