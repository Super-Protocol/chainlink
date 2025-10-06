import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { MetricsService } from '../../metrics/metrics.service';
import { SourceApiException, SourceException } from '../exceptions';

@Injectable()
@Catch(SourceException)
export class SourcesExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SourcesExceptionFilter.name);

  constructor(private readonly metricsService: MetricsService) {}

  catch(exception: SourceException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.httpStatus;
    const message = exception.message;

    this.trackErrorMetrics(request, exception);

    if (exception instanceof SourceApiException) {
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

  private trackErrorMetrics(
    request: Request,
    _exception: SourceException,
  ): void {
    const { source, baseCurrency, quoteCurrency } = request.params;

    if (source && baseCurrency && quoteCurrency) {
      const pair = `${baseCurrency}/${quoteCurrency}`;
      this.metricsService.quoteRequestErrors.inc({ source, pair });
    }
  }
}
