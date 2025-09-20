import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { AppConfigService } from '../config';
import { PairService } from './pair.service';

@Injectable()
export class PairCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PairCleanupService.name);
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly configService: AppConfigService,
    private readonly pairService: PairService,
  ) {}

  onModuleInit(): void {
    this.startCleanupScheduler();
  }

  onModuleDestroy(): void {
    this.stopCleanupScheduler();
  }

  private startCleanupScheduler(): void {
    const enabled = this.configService.get('pairCleanup.enabled');

    if (!enabled) {
      this.logger.log('Pair cleanup is disabled in configuration');
      return;
    }

    const cleanupIntervalMs = this.configService.get(
      'pairCleanup.cleanupIntervalMs',
    );

    this.logger.log(
      `Starting pair cleanup scheduler with ${cleanupIntervalMs}ms interval`,
    );

    this.cleanupInterval = setInterval(() => {
      try {
        this.pairService.cleanupInactivePairs();
      } catch (error) {
        this.logger.error('Error during pair cleanup:', error);
      }
    }, cleanupIntervalMs);
  }

  private stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      this.logger.log('Stopped pair cleanup scheduler');
    }
  }

  manualCleanup(): number {
    this.logger.log('Manual cleanup triggered');
    return this.pairService.cleanupInactivePairs();
  }
}
