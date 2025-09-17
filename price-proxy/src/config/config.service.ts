import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService, Path, PathValue } from '@nestjs/config';
import { Config } from './types';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService<Config, true>) {}

  get<P extends Path<Config>, R = PathValue<Config, P>>(key: P): R {
    return this.config.get(key, { infer: true });
  }

  getOrThrow<P extends Path<Config>, R = PathValue<Config, P>>(
    key: P
  ): Exclude<R, undefined> {
    return this.config.getOrThrow(key, { infer: true });
  }
}
