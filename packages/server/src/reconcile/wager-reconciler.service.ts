import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';
import { StellarService } from '../stellar/stellar.service';
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
  /** Number of wagers that were due at the start of the last sweep. */
  private backlog = 0;
  /** Wall-clock duration of the last completed sweep, in milliseconds. */
  private lastSweepDurationMs = 0;

  constructor(
    private readonly wagers: WagerService,
    private readonly dataSource: DataSource,
    private readonly stellar: StellarService,
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

  /** Backlog size (due wagers) observed at the start of the last sweep. */
  getBacklogSize(): number {
    return this.backlog;
  }

  /** Duration of the last completed sweep, in milliseconds. */
  getLastSweepDurationMs(): number {
    return this.lastSweepDurationMs;
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
    await runner.connect();
    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        RECONCILE_LOCK_KEY,
      ]);
      if (!locked) return;
      try {
        await this.reconcileDue();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [RECONCILE_LOCK_KEY]);
      }
    } catch (err) {
      this.logger.error('Wager reconcile sweep failed', (err as Error).stack);
    } finally {
      await runner.release();
    }
  }

  private async reconcileDue(): Promise<void> {
    const startedAt = Date.now();
    const minAgeMs =
      (this.options.reconcile?.minAgeSeconds ?? DEFAULTS.reconcileMinAgeSeconds) * 1000;
    const concurrency = Math.max(
      1,
      this.options.reconcile?.concurrency ?? DEFAULTS.reconcileConcurrency,
    );
    const budgetMs =
      (this.options.reconcile?.timeBudgetSeconds ?? DEFAULTS.reconcileTimeBudgetSeconds) * 1000;
    const deadline = startedAt + budgetMs;

    const due = await this.wagers.findNeedingAttention(new Date(startedAt - minAgeMs));
    this.backlog = due.length;
    this.logger.log(`Wager reconcile sweep: ${due.length} due wager(s), concurrency ${concurrency}`);

    let next = 0;
    let processed = 0;
    const worker = async (): Promise<void> => {
      while (next < due.length) {
        // Stop picking new wagers once the budget is spent; in-flight ones finish.
        if (Date.now() >= deadline) return;
        const wager = due[next++];
        processed++;
        try {
          const after = await this.wagers.reconcile(wager.id);
          if (after.status !== wager.status) {
            this.logger.log(`Wager ${wager.id}: ${wager.status} → ${after.status}`);
          }
        } catch (err) {
          this.logger.warn(`Reconcile of wager ${wager.id} threw: ${(err as Error).message}`);
    const abortBeforeDeadlineLedgers =
      this.options.reconcile?.abortBeforeDeadlineLedgers ??
      DEFAULTS.abortBeforeDeadlineLedgers;
    const currentLedger = await this.currentLedger();
    const due = await this.wagers.findNeedingAttention(new Date(Date.now() - minAgeMs), {
      currentLedger,
      abortBeforeDeadlineLedgers,
    });
    for (const wager of due) {
      try {
        const after = await this.wagers.reconcile(wager.id, {
          currentLedger,
          abortBeforeDeadlineLedgers,
        });
        if (after.status !== wager.status) {
          this.logger.log(`Wager ${wager.id}: ${wager.status} → ${after.status}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, () => worker()));

    this.lastSweepDurationMs = Date.now() - startedAt;
    this.logger.log(
      `Wager reconcile sweep finished: ${processed}/${due.length} processed in ` +
        `${this.lastSweepDurationMs}ms (budget ${budgetMs}ms)`,
    );
  }

  /**
   * Current ledger sequence: the latest ledger from the RPC in stellar mode,
   * or `currentMockLedger` in mock mode. Returns null when it can't be
   * determined, in which case deadline-based aborts are skipped.
   */
  private async currentLedger(): Promise<number | null> {
    try {
      return await this.stellar.getCurrentLedger();
    } catch (err) {
      this.logger.warn(`Could not determine current ledger: ${(err as Error).message}`);
      return null;
    }
  }
}
