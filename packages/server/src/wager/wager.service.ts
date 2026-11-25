import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateWagerInput,
  MatchResult,
  WagerCore,
  WagerCoreDeps,
} from '@lyricsflip-toolkit/core';
import { ESCROW_GATEWAY, EscrowGateway, UnsignedStake } from '../escrow/escrow.gateway';
import { PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';
import { WalletLinkService } from '../wallet/wallet-link.service';
import { PvpEvent } from './wager.events';
import { Wager } from './wager.entity';
import { TypeOrmWagerRepository } from './typeorm-wager.repository';

export type { CreateWagerInput, MatchResult } from '@lyricsflip-toolkit/core';

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
/**
 * Thin NestJS adapter over the framework-agnostic {@link WagerCore}.
 *
 * All state-machine, settlement and reconciliation logic lives in
 * `@lyricsflip-toolkit/core`; this class only wires the core to NestJS
 * providers (the TypeORM repository, the escrow gateway, wallet links and
 * the module options) and keeps the public method surface existing
 * consumers already depend on.
 */
@Injectable()
export class WagerService {
  private readonly core: WagerCore;

  constructor(
    @InjectRepository(Wager) wagers: Repository<Wager>,
    @Inject(ESCROW_GATEWAY) escrow: EscrowGateway,
    walletLinks: WalletLinkService,
    @Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions,
  ) {
    const deps: WagerCoreDeps = {
      wagers: new TypeOrmWagerRepository(wagers),
      escrow,
      walletLinks,
      options,
      logger: new Logger(WagerService.name),
      emit: (event: PvpEvent) => options.onEvent?.(event),
    };
    this.core = new WagerCore(deps);
  }

  // --- proposing and accepting --------------------------------------------

  create(input: CreateWagerInput): Promise<Wager> {
    return this.core.create(input);
  }

  accept(wagerId: string, playerId: string): Promise<Wager> {
    return this.core.accept(wagerId, playerId);
  }

  decline(wagerId: string, playerId: string): Promise<Wager> {
    return this.core.decline(wagerId, playerId);
  }

  cancel(wagerId: string, playerId: string): Promise<Wager> {
    return this.core.cancel(wagerId, playerId);
  }

  // --- staking -----------------------------------------------------------

  buildStakeTransaction(wagerId: string, playerId: string): Promise<UnsignedStake | null> {
    return this.core.buildStakeTransaction(wagerId, playerId);
  }

  submitStake(
    wagerId: string,
    playerId: string,
    signedTransactionXdr: string | null,
  ): Promise<Wager> {
    return this.core.submitStake(wagerId, playerId, signedTransactionXdr);
  }

  // --- settlement (server only) -------------------------------------------

  settle(wagerId: string, result: MatchResult): Promise<Wager> {
    return this.core.settle(wagerId, result);
  }

  settleMatch(matchId: string, result: MatchResult): Promise<Wager | null> {
    return this.core.settleMatch(matchId, result);
  }

  abort(wagerId: string, reason: string): Promise<Wager> {
    return this.core.abort(wagerId, reason);
  }

  // --- reconciliation -----------------------------------------------------

  reconcile(wagerId: string): Promise<Wager> {
    return this.core.reconcile(wagerId);
  }

  // --- reads --------------------------------------------------------------

  findById(id: string): Promise<Wager> {
    return this.core.findById(id);
  }

  findByMatchId(matchId: string): Promise<Wager | null> {
    return this.core.findByMatchId(matchId);
  }

  getForPlayer(wagerId: string, playerId: string): Promise<Wager> {
    return this.core.getForPlayer(wagerId, playerId);
  }

  listForPlayer(playerId: string, limit = 50): Promise<Wager[]> {
    return this.core.listForPlayer(playerId, limit);
  }

  findNeedingAttention(olderThan: Date, limit = 100): Promise<Wager[]> {
    return this.core.findNeedingAttention(olderThan, limit);
  }
}
