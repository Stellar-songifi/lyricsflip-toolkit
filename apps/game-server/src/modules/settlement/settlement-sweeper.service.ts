import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { WagerService } from '@lyricsflip-toolkit/server';
import { headToHeadResult } from '../game/match-result';

/**
 * Arbitrary key for the Postgres advisory lock that serialises settlement
 * sweeps across multiple game-server instances.
 */
export const SETTLEMENT_SWEEPER_LOCK_KEY = 7_139_002;

/**
 * Periodically searches for finished head-to-head sessions whose wagers remain
 * in the `staked` state (e.g. because the process crashed between finishing the
 * session and emitting the finish event, or the listener encountered an error).
 *
 * Runs with a Postgres advisory lock to ensure only one instance sweeps at a time.
 * Every wager settled this way is counted and logged as a lost event.
 */
@Injectable()
export class SettlementSweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SettlementSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private totalSettledCount = 0;

  constructor(
    private readonly wagers: WagerService,
    private readonly dataSource: DataSource,
  ) {}

  /** Total number of wagers recovered and settled by this sweeper instance. */
  get settledCount(): number {
    return this.totalSettledCount;
  }

  onApplicationBootstrap(): void {
    if (process.env.SETTLEMENT_SWEEPER_ENABLED === 'false') return;
    const intervalSeconds = Number(process.env.SETTLEMENT_SWEEPER_INTERVAL_SECONDS ?? 15);
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /**
   * Sweeps once with an advisory lock. Returns the number of stuck wagers
   * settled during this pass.
   */
  sweep(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.sweepWithLock().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweepWithLock(): Promise<number> {
    let recovered = 0;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        SETTLEMENT_SWEEPER_LOCK_KEY,
      ]);
      if (!locked) return 0;
      try {
        recovered = await this.settleStuckWagers(runner);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [SETTLEMENT_SWEEPER_LOCK_KEY]);
      }
    } catch (err) {
      this.logger.error('Settlement sweeper sweep failed', (err as Error).stack);
    } finally {
      await runner.release();
    }
    return recovered;
  }

  private async settleStuckWagers(runner: QueryRunner): Promise<number> {
    let settledInPass = 0;
    const stuckRows: Array<{ id: string; playerIds: any; scores: any }> = await runner.query(`
      SELECT s.id, s."playerIds" AS "playerIds", s.scores
      FROM game_sessions s
      INNER JOIN pvp_wagers w ON w."matchId" = CAST(s.id AS varchar)
      WHERE s.mode = 'head_to_head'
        AND s.status = 'finished'
        AND w.status = 'staked'
    `);

    for (const row of stuckRows) {
      try {
        let playerIds: string[] = [];
        if (Array.isArray(row.playerIds)) {
          playerIds = row.playerIds;
        } else if (typeof row.playerIds === 'string') {
          playerIds = row.playerIds
            .replace(/^\{|\}$/g, '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        }

        let scores: Record<string, number> = {};
        if (typeof row.scores === 'string') {
          try {
            scores = JSON.parse(row.scores);
          } catch {
            scores = {};
          }
        } else if (row.scores && typeof row.scores === 'object') {
          scores = row.scores;
        }

        const result = headToHeadResult(playerIds, scores);
        const wager = await this.wagers.settleMatch(row.id, result);
        if (wager) {
          this.totalSettledCount++;
          settledInPass++;
          this.logger.warn(
            `Settlement sweeper settled stuck wager ${wager.id} for finished session ${row.id} ` +
              `(lost event detected; total settled: ${this.totalSettledCount})`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Settlement sweeper failed to settle match for session ${row.id}`,
          (err as Error).stack,
        );
      }
    }
    return settledInPass;
  }
}
