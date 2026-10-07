import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';
import { Sep10Service } from './sep10.service';

/** How often to sweep expired redeemed challenges, in seconds. */
const CLEANUP_INTERVAL_SECONDS = 60;

/**
 * Periodically deletes rows from `pvp_sep10_redeemed` whose challenge time
 * bound has lapsed. Runs on every instance; the DELETE is idempotent, so
 * concurrent sweeps only contend on row locks for a moment and are safe.
 *
 * If `options.sep10` is unset the service is inert — a deployment without
 * SEP-10 has nothing to clean up.
 */
@Injectable()
export class Sep10CleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(Sep10CleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sep10: Sep10Service,
    @Inject(PVP_SETTLEMENT_OPTIONS) private readonly options: PvpSettlementOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.options.sep10) return;
    const intervalMs = CLEANUP_INTERVAL_SECONDS * 1000;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs one sweep. Public so tests can drive it deterministically. */
  async sweep(): Promise<number> {
    try {
      const removed = await this.sep10.forgetExpired();
      if (removed > 0) {
        this.logger.debug(`Removed ${removed} expired SEP-10 challenge(s)`);
      }
      return removed;
    } catch (err) {
      this.logger.error('SEP-10 cleanup sweep failed', (err as Error).stack);
      return 0;
    }
  }
}