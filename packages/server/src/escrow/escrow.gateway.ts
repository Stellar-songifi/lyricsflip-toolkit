import { Stroops } from '../amount';

/** DI token for the active {@link EscrowGateway}. */
export const ESCROW_GATEWAY = Symbol('ESCROW_GATEWAY');

export type SettlementMode = 'mock' | 'stellar';

/**
 * What a submission is known to have done.
 *
 * - `confirmed`: included in a ledger and succeeded.
 * - `pending`: sent, but the outcome is not known yet. Never treat this as
 *   success or failure — reconcile it against the pot instead.
 * - `failed`: definitely did not change anything on-chain.
 */
export type SubmitStatus = 'confirmed' | 'pending' | 'failed';

export interface SubmitOutcome {
  status: SubmitStatus;
  txHash: string | null;
  ledger?: number;
  error?: string;
}

/** Mirrors the contract's `PotStatus`. */
export type PotStatus = 'open' | 'staked' | 'resolved' | 'refunded';

export interface PotState {
  playerA: string;
  playerB: string;
  stakeAmount: Stroops;
  playerAStaked: boolean;
  playerBStaked: boolean;
  status: PotStatus;
  deadlineLedger: number;
}

export interface OpenPotParams {
  potId: string;
  playerA: string;
  playerB: string;
  stakeAmount: Stroops;
  timeoutLedgers: number;
}

export interface OpenPotOutcome extends SubmitOutcome {
  deadlineLedger?: number;
}

/** A stake transaction for a player's wallet to sign. */
export interface UnsignedStake {
  /** Base64 transaction envelope XDR. */
  transactionXdr: string;
  networkPassphrase: string;
}

/**
 * The on-chain side of settlement: one method per `pvp-escrow` call.
 *
 * `potId` is the wager id, a UUID, which maps onto the contract's 16-byte
 * session key. Implementations must never throw for an outcome that is
 * merely unknown; they return `pending` so the wager can be reconciled.
 */
export interface EscrowGateway {
  readonly mode: SettlementMode;

  openPot(params: OpenPotParams): Promise<OpenPotOutcome>;

  /**
   * Builds the stake transaction for `player`. Returns `null` when the
   * gateway needs no signature from the player (mock or custodial mode).
   */
  buildStake(potId: string, player: string, playerId: string): Promise<UnsignedStake | null>;

  /**
   * Submits `player`'s stake. `signedTransactionXdr` is the envelope the
   * wallet signed; it is `null` when {@link buildStake} returned `null`.
   */
  submitStake(
    potId: string,
    player: string,
    playerId: string,
    signedTransactionXdr: string | null,
  ): Promise<SubmitOutcome>;

  resolve(potId: string, winner: string): Promise<SubmitOutcome>;

  refund(potId: string): Promise<SubmitOutcome>;

  /** Reads the pot straight from the source of truth; `null` if absent. */
  getPot(potId: string): Promise<PotState | null>;
}
