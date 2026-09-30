import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { randomInt, randomUUID } from 'crypto';
import { PvpEvent, WagerService } from '@lyricsflip-toolkit/server';
import { pvpEvents } from './events';

/**
 * The whole game. A flip is a wager; once both stakes are confirmed the
 * server flips a coin and settles. The toolkit does everything else:
 * accepting, staking, escrow, reconciliation.
 */
@Injectable()
export class CoinFlipService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoinFlipService.name);
  private subscription?: Subscription;

  constructor(private readonly wagers: WagerService) {}

  onModuleInit() {
    this.subscription = pvpEvents.subscribe((event) => void this.onEvent(event));
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  /** Player A proposes a flip against player B. B accepts via the toolkit's routes. */
  propose(playerAId: string, playerBId: string, stakeAmount: string) {
    return this.wagers.create({ matchId: randomUUID(), playerAId, playerBId, stakeAmount });
  }

  /** Flips as soon as both stakes are in. */
  async onEvent(event: PvpEvent): Promise<void> {
    if (event.type !== 'wager.staked') return;
    const { wager } = event;
    const winnerId = randomInt(2) === 0 ? wager.playerAId : wager.playerBId;
    this.logger.log(`Flip ${wager.id}: ${winnerId} wins`);
    await this.wagers.settle(wager.id, { winnerId });
  }
}
