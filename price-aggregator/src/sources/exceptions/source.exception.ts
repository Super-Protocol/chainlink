import { HttpStatus } from '@nestjs/common';

export abstract class SourceException extends Error {
  abstract readonly httpStatus: HttpStatus;

  protected constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}
