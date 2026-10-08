import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { StructuredLogger } from '../logging/structured-logger';
import { InvalidAmountError, assertPositiveStroops } from '@lyricsflip-toolkit/sdk';
import { ESCROW_GATEWAY, EscrowGateway, SubmitOutcome, UnsignedStake } from '../escrow/escrow.gateway';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';
import { WalletLinkService } from '../wallet/wallet-link.service';
import { PvpEvent } from './wager.events';
import { SettlementKind, Wager, WagerStatus } from './wager.entity';

export interface CreateWagerInput {
  /** The game's id for the match. One wager per match. */
  matchId: string;
  /** The player proposing the stake. */
  playerAId: string;
  /** The invited player. Nothing is requested from them until they accept. */
  playerBId: string;
  /** Stroops each player stakes, as a string. */
  stakeAmount: string;
}

/** The result of a finished match, as decided by the game server. */
export type MatchResult = { winnerId: string } | { draw: true };

/**
 * Drives a wager through
 * `pending → awaiting_stakes → staked → settling → won | refunded`,
 * with `cancelled` (nothing moved) and `failed` (needs an operator).
 *
 * Two rules shape every method:
 *
 * 1. **No network call inside a database transaction.** A rollback can't
 *    undo a submitted Stellar transaction. Each step records its intent
 *    and commits, calls the escrow, then records what actually happened.
 * 2. **The pot is the source of truth.** A stake counts once the pot says
 *    so; a settlement is final once the pot says so. When a submission's
 *    outcome is unknown, the wager waits in its current state and
 *    `reconcile` reads the pot rather than guessing.
 *
 * Status changes use conditional updates (`WHERE status = ...`), so two
 * requests racing on the same wager can't both win a transition.
 */
@Injectable()
export class WagerService {
  private readonly logger = new StructuredLogger(WagerService.name);

  constructor(
    @InjectRepository(Wager) private readonly wagers: Repository<Wager>,
    @Inject(ESCROW_GATEWAY) private readonly escrow: EscrowGateway,
    private readonly walletLinks: WalletLinkService,
    @Inject(PVP_SETTLEMENT_OPTIONS) private readonly options: PvpSettlementOptions,
  ) {}

  // --- proposing and accepting --------------------------------------------

  /** Proposes a wager. Only records it: no pot, no stake requests. */
  async create(input: CreateWagerInput): Promise<Wager> {
    if (input.playerAId === input.playerBId) {
      throw new BadRequestException("A player can't wager against themselves");
    }
    let stakeAmount: string;
    try {
      stakeAmount = assertPositiveStroops(input.stakeAmount, 'stakeAmount');
    } catch (err) {
      if (err instanceof InvalidAmountError) throw new BadRequestException(err.message);
      throw err;
    }
    if (!(await this.walletLinks.getAddress(input.playerAId))) {
      throw new BadRequestException('Link and verify a wallet before proposing a wager');
    }
    if (await this.wagers.exist({ where: { matchId: input.matchId } })) {
      throw new ConflictException(`Match ${input.matchId} already has a wager`);
    }

    const wager = await this.wagers.save(
      this.wagers.create({
        matchId: input.matchId,
        playerAId: input.playerAId,
        playerBId: input.playerBId,
        stakeAmount,
        status: WagerStatus.PENDING,
      }),
    );
    this.emit({ type: 'wager.created', wager });
    return wager;
  }

  /**
   * Player two accepts. This is the only way a pot gets opened, so no stake
   * is ever requested from someone who hasn't agreed to it.
   */
  async accept(wagerId: string, playerId: string): Promise<Wager> {
    let wager = await this.findById(wagerId);
    if (playerId !== wager.playerBId) {
      throw new ForbiddenException('Only the invited player can accept this wager');
    }
    if (wager.acceptedAt) {
      return wager; // already accepted; accepting again is a no-op
    }
    if (wager.status !== WagerStatus.PENDING) {
      throw new BadRequestException(`This wager can't be accepted (status: ${wager.status})`);
    }
    if (this.acceptWindowPassed(wager)) {
      await this.transition(wager.id, WagerStatus.PENDING, { status: WagerStatus.CANCELLED });
      throw new BadRequestException('This wager has expired');
    }

    const [addressA, addressB] = await Promise.all([
      this.walletLinks.getAddress(wager.playerAId),
      this.walletLinks.getAddress(wager.playerBId),
    ]);
    if (!addressA || !addressB) {
      throw new BadRequestException('Both players need a linked, verified wallet');
    }

    // Record the acceptance and the payout addresses first, then open the pot.
    const claimed = await this.wagers.update(
      { id: wager.id, status: WagerStatus.PENDING, acceptedAt: IsNull() },
      { acceptedAt: new Date(), playerAAddress: addressA, playerBAddress: addressB },
    );
    wager = await this.findById(wager.id);
    if (!claimed.affected) {
      return wager; // a concurrent accept got there first
    }
    return this.openPot(wager);
  }

  /** Player two says no. Only before accepting; nothing has moved. */
  async decline(wagerId: string, playerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (playerId !== wager.playerBId) {
      throw new ForbiddenException('Only the invited player can decline this wager');
    }
    return this.cancelPending(wager);
  }

  /** Either player withdraws a wager that hasn't been accepted yet. */
  async cancel(wagerId: string, playerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    this.requirePlayer(wager, playerId);
    return this.cancelPending(wager);
  }

  // --- staking -----------------------------------------------------------

  /**
   * The transaction `playerId` must sign to stake, or `null` when no
   * signature is needed (mock or custodial mode — call `submitStake`).
   */
  async buildStakeTransaction(wagerId: string, playerId: string): Promise<UnsignedStake | null> {
    const wager = await this.findById(wagerId);
    const side = this.requireStakeable(wager, playerId);
    return this.escrow.buildStake(wager.id, this.addressOf(wager, side), playerId);
  }

  /**
   * Submits a player's stake. The stake only counts once the pot confirms
   * it, and the wager only becomes `staked` once the pot holds both.
   */
  async submitStake(
    wagerId: string,
    playerId: string,
    signedTransactionXdr: string | null,
  ): Promise<Wager> {
    const wager = await this.findById(wagerId);
    const side = this.requireStakeable(wager, playerId);

    const outcome = await this.escrow.submitStake(
      wager.id,
      this.addressOf(wager, side),
      playerId,
      signedTransactionXdr,
    );
    if (outcome.txHash) {
      await this.wagers.update(
        { id: wager.id },
        side === 'A' ? { playerAStakeTxHash: outcome.txHash } : { playerBStakeTxHash: outcome.txHash },
      );
    }
    if (outcome.status === 'failed') {
      throw new BadRequestException(`Stake was not accepted: ${outcome.error ?? 'unknown error'}`);
    }
    // Confirmed or still pending: either way, the pot decides.
    return this.syncStakesFromPot(wager.id);
  }

  // --- settlement (server only) -------------------------------------------

  /**
   * Settles a finished match. **Only the game server calls this**, once it
   * has decided the result; no HTTP route exposes it.
   *
   * The intent (payout to whom, or refund) is committed before anything is
   * submitted, so an interrupted payout is always recognisable as a payout.
   * Calling again with the same result is a no-op.
   */
  async settle(wagerId: string, result: MatchResult): Promise<Wager> {
    const wager = await this.findById(wagerId);
    const kind = 'draw' in result ? SettlementKind.REFUND : SettlementKind.PAYOUT;
    const winnerId = 'winnerId' in result ? result.winnerId : null;
    if (winnerId !== null && winnerId !== wager.playerAId && winnerId !== wager.playerBId) {
      throw new BadRequestException('The winner must be one of the two players');
    }

    if (wager.settlementKind) {
      if (wager.settlementKind === kind && wager.winnerId === winnerId) {
        return wager; // already settling or settled this way
      }
      throw new ConflictException('This wager is already being settled differently');
    }
    if (wager.status !== WagerStatus.STAKED) {
      throw new BadRequestException(`Only a staked wager can be settled (status: ${wager.status})`);
    }

    const claimed = await this.transition(wager.id, WagerStatus.STAKED, {
      status: WagerStatus.SETTLING,
      settlementKind: kind,
      winnerId,
    });
    if (!claimed) {
      return this.settle(wagerId, result); // lost a race; re-read and re-check
    }
    return this.submitSettlement(await this.findById(wager.id));
  }

  /** `settle`, looked up by the game's match id. */
  async settleMatch(matchId: string, result: MatchResult): Promise<Wager | null> {
    const wager = await this.findByMatchId(matchId);
    return wager ? this.settle(wager.id, result) : null;
  }

  /**
   * Abandons a wager that can't be played: refunds whatever was staked, or
   * cancels it if the pot was never opened. Server only.
   */
  async abort(wagerId: string, reason: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status === WagerStatus.PENDING && !wager.acceptedAt) {
      return this.cancelPending(wager);
    }
    if (wager.status !== WagerStatus.AWAITING_STAKES && wager.status !== WagerStatus.STAKED) {
      throw new BadRequestException(`This wager can't be aborted (status: ${wager.status})`);
    }
    this.logger.log(`Aborting wager ${wager.id}: ${reason}`);
    const claimed = await this.transition(wager.id, wager.status, {
      status: WagerStatus.SETTLING,
      settlementKind: SettlementKind.REFUND,
      winnerId: null,
    });
    if (!claimed) return this.findById(wager.id);
    return this.submitSettlement(await this.findById(wager.id));
  }

  // --- reconciliation -----------------------------------------------------

  /**
   * Moves a wager whose last step had an unknown outcome to its true state,
   * by reading the pot. Safe to call at any time and from any instance.
   *
   * A `settling` wager ends as `won` only if the pot was paid out, and as
   * `refunded` only if the pot was actually refunded — never by guessing.
   */
  async reconcile(wagerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    switch (wager.status) {
      case WagerStatus.PENDING:
        if (wager.acceptedAt) return this.openPot(wager);
        if (this.acceptWindowPassed(wager)) return this.cancelPending(wager);
        return wager;
      case WagerStatus.AWAITING_STAKES: {
        const synced = await this.syncStakesFromPot(wager.id);
        if (synced.status === WagerStatus.AWAITING_STAKES && this.stakeWindowPassed(synced)) {
          return this.abort(synced.id, 'players did not both stake in time');
        }
        return synced;
      }
      case WagerStatus.SETTLING:
        return this.reconcileSettlement(wager);
      default:
        return wager;
    }
  }

  // --- reads --------------------------------------------------------------

  async findById(id: string): Promise<Wager> {
    const wager = await this.wagers.findOne({ where: { id } });
    if (!wager) throw new NotFoundException(`Wager ${id} not found`);
    return wager;
  }

  async findByMatchId(matchId: string): Promise<Wager | null> {
    return this.wagers.findOne({ where: { matchId } });
  }

  /** A wager, for one of its own players only. */
  async getForPlayer(wagerId: string, playerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    this.requirePlayer(wager, playerId);
    return wager;
  }

  async listForPlayer(playerId: string, limit = 50): Promise<Wager[]> {
    return this.wagers.find({
      where: [{ playerAId: playerId }, { playerBId: playerId }],
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  /** Wagers the background sweep should look at. */
  async findNeedingAttention(olderThan: Date, limit = 100): Promise<Wager[]> {
    return this.wagers
      .createQueryBuilder('w')
      .where('w.status IN (:...statuses)', {
        statuses: [WagerStatus.PENDING, WagerStatus.AWAITING_STAKES, WagerStatus.SETTLING],
      })
      .andWhere('w.updatedAt < :olderThan', { olderThan })
      .orderBy('w.updatedAt', 'ASC')
      .take(limit)
      .getMany();
  }

  // --- internals ------------------------------------------------------------

  private async openPot(wager: Wager): Promise<Wager> {
    const outcome = await this.escrow.openPot({
      potId: wager.id,
      playerA: wager.playerAAddress as string,
      playerB: wager.playerBAddress as string,
      stakeAmount: wager.stakeAmount,
      timeoutLedgers: this.options.potTimeoutLedgers ?? DEFAULTS.potTimeoutLedgers,
    });

    if (outcome.status === 'failed') {
      await this.transition(wager.id, WagerStatus.PENDING, {
        status: WagerStatus.FAILED,
        failureReason: `open_pot failed: ${outcome.error ?? 'unknown error'}`,
      });
      return this.findById(wager.id);
    }

    // Pending or confirmed: only move on once the pot exists.
    const pot = outcome.status === 'confirmed' ? null : await this.escrow.getPot(wager.id);
    if (outcome.status === 'confirmed' || pot) {
      await this.transition(wager.id, WagerStatus.PENDING, {
        status: WagerStatus.AWAITING_STAKES,
        potDeadlineLedger: outcome.deadlineLedger ?? pot?.deadlineLedger ?? null,
      });
      const opened = await this.findById(wager.id);
      this.emit({ type: 'wager.accepted', wager: opened });
      return opened;
    }
    return this.findById(wager.id);
  }

  /** Copies confirmed stakes from the pot, and marks `staked` once both are in. */
  private async syncStakesFromPot(wagerId: string): Promise<Wager> {
    const wager = await this.findById(wagerId);
    if (wager.status !== WagerStatus.AWAITING_STAKES) return wager;

    const pot = await this.escrow.getPot(wager.id);
    if (!pot) return wager;
    const now = new Date();
    if (pot.playerAStaked && !wager.playerAStakedAt) {
      await this.wagers.update({ id: wager.id, playerAStakedAt: IsNull() }, { playerAStakedAt: now });
    }
    if (pot.playerBStaked && !wager.playerBStakedAt) {
      await this.wagers.update({ id: wager.id, playerBStakedAt: IsNull() }, { playerBStakedAt: now });
    }

    const staked = await this.wagers.update(
      {
        id: wager.id,
        status: WagerStatus.AWAITING_STAKES,
        playerAStakedAt: Not(IsNull()),
        playerBStakedAt: Not(IsNull()),
      },
      { status: WagerStatus.STAKED },
    );
    const updated = await this.findById(wager.id);
    if (staked.affected) {
      this.emit({ type: 'wager.staked', wager: updated });
    }
    return updated;
  }

  /** Submits the recorded settlement intent and records what happened. */
  private async submitSettlement(wager: Wager): Promise<Wager> {
    let outcome: SubmitOutcome;
    if (wager.settlementKind === SettlementKind.PAYOUT) {
      const winnerAddress =
        wager.winnerId === wager.playerAId ? wager.playerAAddress : wager.playerBAddress;
      outcome = await this.escrow.resolve(wager.id, winnerAddress as string);
    } else {
      outcome = await this.escrow.refund(wager.id);
    }

    if (outcome.txHash) {
      await this.wagers.update(
        { id: wager.id, status: WagerStatus.SETTLING },
        { settlementTxHash: outcome.txHash, settlementLedger: outcome.ledger ?? null },
      );
    }
    if (outcome.status === 'pending') {
      this.logger.warn(`Wager ${wager.id} settlement submitted but unconfirmed; will reconcile`);
      return this.findById(wager.id);
    }
    if (outcome.status === 'failed') {
      this.logger.warn(`Wager ${wager.id} settlement failed (${outcome.error}); checking the pot`);
    }
    // Confirmed or failed: the pot says what really happened.
    return this.reconcileSettlement(await this.findById(wager.id), outcome.status === 'failed');
  }

  private async reconcileSettlement(wager: Wager, justFailed = false): Promise<Wager> {
    const pot = await this.escrow.getPot(wager.id);
    const payout = wager.settlementKind === SettlementKind.PAYOUT;

    if (pot?.status === 'resolved') {
      if (!payout) {
        return this.fail(wager, 'The pot was paid out, but a refund was intended');
      }
      return this.finish(wager, WagerStatus.WON);
    }
    if (pot?.status === 'refunded') {
      if (payout) {
        // A refund really happened (the players reclaimed their stakes after
        // the pot timed out), so `refunded` is the true state.
        this.logger.warn(`Wager ${wager.id}: payout intended but the pot was refunded on-chain`);
      }
      return this.finish(wager, WagerStatus.REFUNDED);
    }
    if (!pot) {
      return this.fail(wager, 'The escrow has no pot for this wager');
    }
    if (payout && !(pot.playerAStaked && pot.playerBStaked)) {
      return this.fail(
        wager,
        'A player reclaimed their stake after the pot timed out; the payout can no longer happen',
      );
    }

    // The intended call hasn't landed. Retry it: the contract refuses a
    // second payout, so a retry can never pay twice.
    const attempts = wager.reconcileAttempts + 1;
    const max = this.options.reconcile?.maxAttempts ?? DEFAULTS.reconcileMaxAttempts;
    if (attempts >= max) {
      return this.fail(wager, `Settlement did not land after ${attempts} attempts`);
    }
    await this.wagers.update({ id: wager.id, status: WagerStatus.SETTLING }, { reconcileAttempts: attempts });
    if (justFailed) {
      return this.findById(wager.id); // leave the retry to the next sweep
    }
    return this.submitSettlement(await this.findById(wager.id));
  }

  private async finish(wager: Wager, status: WagerStatus.WON | WagerStatus.REFUNDED): Promise<Wager> {
    const moved = await this.transition(wager.id, WagerStatus.SETTLING, { status });
    const finished = await this.findById(wager.id);
    if (moved) {
      this.emit({ type: status === WagerStatus.WON ? 'wager.won' : 'wager.refunded', wager: finished });
    }
    return finished;
  }

  private async fail(wager: Wager, reason: string): Promise<Wager> {
    this.logger.error('Wager needs an operator', {
      wagerId: wager.id,
      reason,
      status: wager.status,
    });
    const moved = await this.transition(wager.id, wager.status, {
      status: WagerStatus.FAILED,
      failureReason: reason,
    });
    const failed = await this.findById(wager.id);
    if (moved) this.emit({ type: 'wager.failed', wager: failed });
    return failed;
  }

  private async cancelPending(wager: Wager): Promise<Wager> {
    if (wager.status === WagerStatus.CANCELLED) return wager;
    if (wager.status !== WagerStatus.PENDING || wager.acceptedAt) {
      throw new BadRequestException(`This wager can no longer be cancelled (status: ${wager.status})`);
    }
    const moved = await this.wagers.update(
      { id: wager.id, status: WagerStatus.PENDING, acceptedAt: IsNull() },
      { status: WagerStatus.CANCELLED },
    );
    const cancelled = await this.findById(wager.id);
    if (moved.affected) this.emit({ type: 'wager.cancelled', wager: cancelled });
    return cancelled;
  }

  /** Conditional status change; returns false if the wager had moved on. */
  private async transition(id: string, from: WagerStatus, changes: Partial<Wager>): Promise<boolean> {
    const result = await this.wagers.update({ id, status: from }, changes);
    return Boolean(result.affected);
  }

  private requirePlayer(wager: Wager, playerId: string): 'A' | 'B' {
    if (playerId === wager.playerAId) return 'A';
    if (playerId === wager.playerBId) return 'B';
    throw new ForbiddenException('You are not a player in this wager');
  }

  private requireStakeable(wager: Wager, playerId: string): 'A' | 'B' {
    const side = this.requirePlayer(wager, playerId);
    if (wager.status !== WagerStatus.AWAITING_STAKES) {
      throw new BadRequestException(`This wager is not taking stakes (status: ${wager.status})`);
    }
    if (side === 'A' ? wager.playerAStakedAt : wager.playerBStakedAt) {
      throw new BadRequestException('You have already staked');
    }
    return side;
  }

  private addressOf(wager: Wager, side: 'A' | 'B'): string {
    return (side === 'A' ? wager.playerAAddress : wager.playerBAddress) as string;
  }

  private acceptWindowPassed(wager: Wager): boolean {
    const windowMs = (this.options.acceptWindowSeconds ?? DEFAULTS.acceptWindowSeconds) * 1000;
    return wager.createdAt.getTime() + windowMs < Date.now();
  }

  private stakeWindowPassed(wager: Wager): boolean {
    if (!wager.acceptedAt) return false;
    const windowMs = (this.options.stakeWindowSeconds ?? DEFAULTS.stakeWindowSeconds) * 1000;
    return wager.acceptedAt.getTime() + windowMs < Date.now();
  }

  private emit(event: PvpEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch (err) {
      this.logger.error('onEvent handler threw', {
        eventType: event.type,
        error: (err as Error)?.message,
        stack: (err as Error)?.stack,
      });
    }
  }
}
