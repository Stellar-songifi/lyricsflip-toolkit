import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PvpEvent, WagerService, WagerStatus } from '@lyricsflip-toolkit/server';
import { GameMode } from '../game/entities/game-session.entity';
import { GameService, SessionFinishedEvent } from '../game/game.service';
import { headToHeadResult } from '../game/match-result';
import { MetricsService, SettlementOutcome } from '../../metrics/metrics.service';

/**
 * Connects LyricsFlip matches to the toolkit's wagers. A wager's `matchId`
 * is the game session id.
 *
 * - When the server finishes a head-to-head session, it settles the wager
 *   from the scores it recorded. No client can trigger or influence this.
 * - A staked session only becomes playable once both stakes are confirmed.
 * - A session whose wager ends before play (cancelled or refunded) is
 *   cancelled.
 */
@Injectable()
export class SettlementListener {
  private readonly logger = new Logger(SettlementListener.name);

  constructor(
    private readonly wagers: WagerService,
    private readonly games: GameService,
    private readonly metrics: MetricsService,
  ) {}

  @OnEvent('game.session.finished', { async: true, promisify: true })
  async onSessionFinished(event: SessionFinishedEvent): Promise<void> {
    if (event.mode !== GameMode.HEAD_TO_HEAD) return;
    const startedAt = process.hrtime.bigint();
    try {
      const result = headToHeadResult(event.playerIds, event.scores);
      const wager = await this.wagers.settleMatch(event.sessionId, result);
      if (wager) {
        const outcome = settlementOutcome(wager.status);
        if (outcome) this.recordSettlement(outcome, startedAt);
        this.logger.log(`Session ${event.sessionId} settled: wager ${wager.id} is ${wager.status}`);
      }
    } catch (err) {
      this.recordSettlement('failed', startedAt);
      // The wager stays as it was; the reconciler and operators take over.
      this.logger.error(`Could not settle session ${event.sessionId}`, (err as Error).stack);
    }
  }

  private recordSettlement(outcome: SettlementOutcome, startedAt: bigint): void {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    this.metrics.observeSettlement(outcome, durationSeconds);
  }

  @OnEvent('pvp.wager.staked', { async: true, promisify: true })
  async onWagerStaked(event: PvpEvent): Promise<void> {
    await this.games.activate(event.wager.matchId);
  }

  @OnEvent('pvp.wager.cancelled', { async: true, promisify: true })
  @OnEvent('pvp.wager.refunded', { async: true, promisify: true })
  @OnEvent('pvp.wager.failed', { async: true, promisify: true })
  async onWagerEndedEarly(event: PvpEvent): Promise<void> {
    // Only cancels a session still waiting; a played match is untouched.
    await this.games.cancel(event.wager.matchId);
  }
}

function settlementOutcome(status: WagerStatus): SettlementOutcome | null {
  switch (status) {
    case WagerStatus.WON:
      return 'won';
    case WagerStatus.REFUNDED:
      return 'refunded';
    case WagerStatus.FAILED:
      return 'failed';
    default:
      return null;
  }
}
