import { Module } from '@nestjs/common';

import { ProxyConfigService } from './proxy-config.service';
import { AppConfigModule } from '../../config';

@Module({
  imports: [AppConfigModule],
  providers: [ProxyConfigService],
  exports: [ProxyConfigService],
})
export class ProxyModule {}
