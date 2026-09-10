import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wager, WagerStatus } from './entities/wager.entity';
import { UsersService } from '../users/users.service';
import { StellarService, UnsignedStakeTransaction } from '../stellar/stellar.service';

export interface CreateWagerResult {
  wager: Wager;
  unsignedStakeTransactions: UnsignedStakeTransaction[] | null;
}

/**
 * Drives a wager through `pending -> awaiting_stakes -> staked -> settling ->
 * won | refunded`, with `failed` for anything that needs an operator.
 *
 * Network calls to Stellar/Soroban never happen inside a database
 * transaction — a Postgres rollback can't un-submit a transaction that's
 * already on the ledger. Each step commits its DB state, then makes the
 * network call, then commits the result of that call in a second write.
 */
@Injectable()
export class WagerService {
  private readonly logger = new Logger(WagerService.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagersRepository: Repository<Wager>,
    private readonly usersService: UsersService,
    private readonly stellarService: StellarService,
  ) {}

  async createWager(
    gameSessionId: string,
    playerAId: string,
    playerBId: string,
    stakeAmount: string,
  ): Promise<CreateWagerResult> {
    const [playerA, playerB] = await Promise.all([
      this.usersService.findById(playerAId),
      this.usersService.findById(playerBId),
    ]);
    if (!playerA.walletAddress || !playerB.walletAddress) {
      throw new BadRequestException('Both players must link and verify a wallet to wager');
    }

    const wager = await this.wagersRepository.save(
      this.wagersRepository.create({
        gameSessionId,
        playerAId,
        playerBId,
        stakeAmount,
        status: WagerStatus.PENDING,
      }),
    );

    try {
      const unsignedTxs = await this.stellarService.openPot(
        wager.id,
        playerA.walletAddress,
        playerB.walletAddress,
        stakeAmount,
      );
      wager.status = WagerStatus.AWAITING_STAKES;
      const saved = await this.wagersRepository.save(wager);
      return { wager: saved, unsignedStakeTransactions: unsignedTxs };
    } catch (err) {
      wager.status = WagerStatus.FAILED;
      wager.failureReason = err instanceof Error ? err.message : 'open_pot failed';
      await this.wagersRepository.save(wager);
      throw err;
    }
  }

  /** Called once each player's wallet has posted its signed stake transaction. */
  async markPlayerStaked(wagerId: string, playerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status !== WagerStatus.AWAITING_STAKES) {
      throw new BadRequestException(`Wager ${wagerId} is not awaiting stakes`);
    }

    if (playerId === wager.playerAId) {
      wager.playerAStaked = true;
    } else if (playerId === wager.playerBId) {
      wager.playerBStaked = true;
    } else {
      throw new BadRequestException('Player is not part of this wager');
    }

    if (wager.playerAStaked && wager.playerBStaked) {
      wager.status = WagerStatus.STAKED;
    }

    return this.wagersRepository.save(wager);
  }

  async settle(wagerId: string, winnerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status !== WagerStatus.STAKED) {
      throw new BadRequestException(`Wager ${wagerId} is not staked`);
    }
    if (winnerId !== wager.playerAId && winnerId !== wager.playerBId) {
      throw new BadRequestException('Winner must be one of the two wagering players');
    }

    wager.status = WagerStatus.SETTLING;
    wager.winnerId = winnerId;
    await this.wagersRepository.save(wager);

    const winner = await this.usersService.findById(winnerId);
    if (!winner.walletAddress) {
      throw new BadRequestException('Winner has no linked wallet');
    }

    try {
      const txHash = await this.stellarService.resolve(wager.id, winner.walletAddress);
      wager.status = WagerStatus.WON;
      wager.settlementTxHash = txHash;
      return this.wagersRepository.save(wager);
    } catch (err) {
      // Left in `settling` with whatever we know — an admin reconciles this
      // against the ledger rather than guessing at the outcome.
      this.logger.error(`Settlement failed for wager ${wager.id}`, err as Error);
      throw err;
    }
  }

  async refund(wagerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status !== WagerStatus.STAKED && wager.status !== WagerStatus.AWAITING_STAKES) {
      throw new BadRequestException(`Wager ${wagerId} cannot be refunded from its current state`);
    }

    wager.status = WagerStatus.SETTLING;
    await this.wagersRepository.save(wager);

    try {
      const txHash = await this.stellarService.refund(wager.id);
      wager.status = WagerStatus.REFUNDED;
      wager.settlementTxHash = txHash;
      return this.wagersRepository.save(wager);
    } catch (err) {
      this.logger.error(`Refund failed for wager ${wager.id}`, err as Error);
      throw err;
    }
  }

  /** Admin-only: resolves a wager stuck in `settling` against ledger state. */
  async reconcile(wagerId: string, resolvedTxHash: string, outcome: 'won' | 'refunded'): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status !== WagerStatus.SETTLING) {
      throw new BadRequestException(`Wager ${wagerId} is not stuck in settling`);
    }

    wager.status = outcome === 'won' ? WagerStatus.WON : WagerStatus.REFUNDED;
    wager.settlementTxHash = resolvedTxHash;
    return this.wagersRepository.save(wager);
  }

  async findById(id: string): Promise<Wager> {
    const wager = await this.wagersRepository.findOne({ where: { id } });
    if (!wager) {
      throw new NotFoundException(`Wager ${id} not found`);
    }
    return wager;
  }
}
