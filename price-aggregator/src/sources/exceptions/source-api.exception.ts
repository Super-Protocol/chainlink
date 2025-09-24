import { HttpStatus } from '@nestjs/common';

import { SourceException } from './source.exception';

export class SourceApiException extends SourceException {
  readonly httpStatus: HttpStatus;
  readonly statusCode?: number;

  constructor(sourceName: string, originalError: Error, statusCode?: number) {
    super(
      `API error from ${sourceName}: ${originalError.message}`,
      'SourceApiException',
    );
    this.cause = originalError;
    this.statusCode = statusCode;
    this.httpStatus = this.mapStatusCode(statusCode);
  }

  private mapStatusCode(statusCode?: number): HttpStatus {
    if (!statusCode) {
      return HttpStatus.BAD_GATEWAY;
    }
    if (statusCode >= 400 && statusCode < 500) {
      return statusCode === 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
    }
    if (statusCode >= 500) {
      return HttpStatus.BAD_GATEWAY;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
