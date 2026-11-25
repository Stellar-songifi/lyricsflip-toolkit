import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';
import { WagerStatus } from '../wager/wager.entity';
import { WagerService } from '../wager/wager.service';

/** Arbitrary key for the Postgres advisory lock that serialises sweeps. */
export const RECONCILE_LOCK_KEY = 7_139_001;

/**
 * Periodically calls `WagerService.reconcile` on wagers that have sat in a
 * non-terminal state: accepted-but-unopened pots, stakes submitted without
 * a confirmation, expired invitations and stake windows, and settlements
 * whose outcome was unknown. A Postgres advisory lock keeps it to one
 * instance at a time.
 *
 * Adapted from Lyricsflip_server `src/tokens/services/wager-reconcile.job.ts`;
 * attempts now live on the wager row, so a restart doesn't reset them.
 */
@Injectable()
export class WagerReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WagerReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly wagers: WagerService,
    private readonly dataSource: DataSource,
    @Inject(PVP_SETTLEMENT_OPTIONS) private readonly options: PvpSettlementOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.reconcile?.enabled === false) return;
    const intervalMs =
      (this.options.reconcile?.intervalSeconds ?? DEFAULTS.reconcileIntervalSeconds) * 1000;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // Let an in-flight sweep finish so a settlement isn't cut off mid-write.
    await this.running;
  }

  /** Runs one sweep unless another instance (or this one) is already sweeping. */
  sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.sweepWithLock().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweepWithLock(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'failed' | 'skipped' = 'failed';
    try {
      await runner.connect();
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        RECONCILE_LOCK_KEY,
      ]);
      if (!locked) {
        outcome = 'skipped';
        return;
      }
      try {
        await this.reconcileDue();
        outcome = 'success';
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [RECONCILE_LOCK_KEY]);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error({
        message: 'Wager reconcile sweep failed',
        event: 'reconciliation.sweep.failed',
        error: { name: error.name, message: error.message, stack: error.stack },
      });
    } finally {
      if (!runner.isReleased) await runner.release();
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      try {
        this.options.observability?.onReconcileSweep?.({ outcome, durationSeconds });
      } catch (err) {
        this.logger.warn(`Reconcile metrics observer threw: ${(err as Error).message}`);
      }
    }
  }

  private async reconcileDue(): Promise<void> {
    const minAgeMs =
      (this.options.reconcile?.minAgeSeconds ?? DEFAULTS.reconcileMinAgeSeconds) * 1000;
    const due = await this.wagers.findNeedingAttention(new Date(Date.now() - minAgeMs));
    for (const wager of due) {
      try {
        const after = await this.wagers.reconcile(wager.id);
        if (after.status !== wager.status) {
          this.logger.log(`Wager ${wager.id}: ${wager.status} → ${after.status}`);
        }
        const exhausted =
          after.status === WagerStatus.FAILED
            ? /^Settlement did not land after (\d+) attempts$/.exec(after.failureReason ?? '')
            : null;
        if (exhausted) {
          const attempts = Number(exhausted[1]);
          this.logger.error({
            message: 'Wager exhausted reconciliation attempts',
            event: 'reconciliation.exhausted',
            wagerId: after.id,
            attempts,
            failureReason: after.failureReason,
          });
          try {
            this.options.observability?.onReconcileExhausted?.({
              wagerId: after.id,
              attempts,
              failureReason: after.failureReason as string,
            });
          } catch (err) {
            this.logger.warn(`Reconcile exhaustion observer threw: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Reconcile of wager ${wager.id} threw: ${(err as Error).message}`);
      }
    }
  }
}
