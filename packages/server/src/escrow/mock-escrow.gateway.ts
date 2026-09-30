import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { multiplyStroops } from '../amount';
import {
  EscrowGateway,
  OpenPotOutcome,
  OpenPotParams,
  PotState,
  SubmitOutcome,
  UnsignedStake,
} from './escrow.gateway';
import { MockPot } from './mock-pot.entity';

/** Seconds per ledger, used to turn wall-clock time into a mock ledger number. */
const SECONDS_PER_LEDGER = 5;

export function currentMockLedger(now = Date.now()): number {
  return Math.floor(now / 1000 / SECONDS_PER_LEDGER);
}

/**
 * Settlement without a blockchain: pots live in `pvp_mock_pots` and follow
 * the same rules as `contracts/pvp-escrow` (only players can stake, only a
 * player of the pot can win, refunds go back to whoever staked).
 * No tokens move; this is for development and tests.
 */
@Injectable()
export class MockEscrowGateway implements EscrowGateway {
  readonly mode = 'mock' as const;
  private readonly logger = new Logger(MockEscrowGateway.name);

  constructor(@InjectRepository(MockPot) private readonly pots: Repository<MockPot>) {}

  async openPot(params: OpenPotParams): Promise<OpenPotOutcome> {
    const existing = await this.pots.findOne({ where: { id: params.potId } });
    if (existing) {
      // Opening is idempotent for the same match, so a retry after a crash
      // is safe. A different match under the same id is a real conflict.
      if (
        existing.playerA !== params.playerA ||
        existing.playerB !== params.playerB ||
        existing.stakeAmount !== params.stakeAmount
      ) {
        return failed('PotAlreadyExists');
      }
      return { ...confirmed(), deadlineLedger: existing.deadlineLedger };
    }
    if (params.playerA === params.playerB) {
      return failed('SamePlayer');
    }

    const pot = await this.pots.save(
      this.pots.create({
        id: params.potId,
        playerA: params.playerA,
        playerB: params.playerB,
        stakeAmount: params.stakeAmount,
        status: 'open',
        deadlineLedger: currentMockLedger() + params.timeoutLedgers,
        winner: null,
      }),
    );
    this.logger.debug(`[mock] open_pot ${pot.id} stake=${pot.stakeAmount}`);
    return { ...confirmed(), deadlineLedger: pot.deadlineLedger };
  }

  async buildStake(): Promise<UnsignedStake | null> {
    return null;
  }

  async submitStake(potId: string, player: string): Promise<SubmitOutcome> {
    const pot = await this.pots.findOne({ where: { id: potId } });
    if (!pot) return failed('PotNotFound');
    if (pot.status !== 'open') return failed('PotNotOpen');
    if (currentMockLedger() > pot.deadlineLedger) return failed('DeadlinePassed');

    const isA = player === pot.playerA;
    const isB = player === pot.playerB;
    if (!isA && !isB) return failed('NotAPlayerInPot');
    if ((isA && pot.playerAStaked) || (isB && pot.playerBStaked)) return failed('AlreadyStaked');

    if (isA) pot.playerAStaked = true;
    else pot.playerBStaked = true;
    if (pot.playerAStaked && pot.playerBStaked) pot.status = 'staked';
    await this.pots.save(pot);
    return confirmed();
  }

  async resolve(potId: string, winner: string): Promise<SubmitOutcome> {
    const pot = await this.pots.findOne({ where: { id: potId } });
    if (!pot) return failed('PotNotFound');
    if (pot.status !== 'staked' || !pot.playerAStaked || !pot.playerBStaked) {
      return failed('PotNotStaked');
    }
    if (winner !== pot.playerA && winner !== pot.playerB) return failed('InvalidWinner');

    pot.status = 'resolved';
    pot.winner = winner;
    await this.pots.save(pot);
    this.logger.debug(
      `[mock] resolve ${potId} winner=${winner} payout=${multiplyStroops(pot.stakeAmount, 2)}`,
    );
    return confirmed();
  }

  async refund(potId: string): Promise<SubmitOutcome> {
    const pot = await this.pots.findOne({ where: { id: potId } });
    if (!pot) return failed('PotNotFound');
    if (pot.status !== 'open' && pot.status !== 'staked') return failed('PotNotOpen');

    pot.status = 'refunded';
    pot.playerAStaked = false;
    pot.playerBStaked = false;
    await this.pots.save(pot);
    this.logger.debug(`[mock] refund ${potId}`);
    return confirmed();
  }

  async getPot(potId: string): Promise<PotState | null> {
    const pot = await this.pots.findOne({ where: { id: potId } });
    if (!pot) return null;
    return {
      playerA: pot.playerA,
      playerB: pot.playerB,
      stakeAmount: pot.stakeAmount,
      playerAStaked: pot.playerAStaked,
      playerBStaked: pot.playerBStaked,
      status: pot.status,
      deadlineLedger: pot.deadlineLedger,
    };
  }
}

function confirmed(): SubmitOutcome {
  return { status: 'confirmed', txHash: `mock:${randomUUID()}` };
}

function failed(error: string): SubmitOutcome {
  return { status: 'failed', txHash: null, error };
}
