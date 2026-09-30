import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * `pending` → `awaiting_stakes` → `staked` → `settling` → `won` | `refunded`.
 *
 * - `cancelled`: ended before any money moved (declined, or never accepted).
 * - `failed`: needs an operator; `failureReason` says why.
 */
export enum WagerStatus {
  PENDING = 'pending',
  AWAITING_STAKES = 'awaiting_stakes',
  STAKED = 'staked',
  SETTLING = 'settling',
  WON = 'won',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

/** What a settlement is trying to do. Recorded before any network call. */
export enum SettlementKind {
  PAYOUT = 'payout',
  REFUND = 'refund',
}

export const TERMINAL_STATUSES: readonly WagerStatus[] = [
  WagerStatus.WON,
  WagerStatus.REFUNDED,
  WagerStatus.CANCELLED,
  WagerStatus.FAILED,
];

/**
 * One staked head-to-head match. The wager's own `id` is the escrow pot key
 * (a UUID is exactly the contract's 16-byte session id), so the game's match
 * id can be any string.
 */
@Entity('pvp_wagers')
export class Wager {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The game's identifier for the match this wager is attached to. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  matchId: string;

  /** The player who proposed the wager. */
  @Column({ type: 'varchar', length: 128 })
  playerAId: string;

  /** The invited player. Nothing is asked of them until they accept. */
  @Column({ type: 'varchar', length: 128 })
  playerBId: string;

  /** Stroops each player stakes, as a string — never a float. */
  @Column({ type: 'varchar', length: 40 })
  stakeAmount: string;

  @Index()
  @Column({ type: 'enum', enum: WagerStatus, enumName: 'pvp_wager_status', default: WagerStatus.PENDING })
  status: WagerStatus;

  /** Wallets fixed when the pot is opened. Payouts go to these, not to a later link. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  playerAAddress: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  playerBAddress: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  /** Ledger after which players can reclaim their own stakes on-chain. */
  @Column({ type: 'integer', nullable: true })
  potDeadlineLedger: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  playerAStakeTxHash: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  playerBStakeTxHash: string | null;

  /** Set only once the stake is confirmed (on-chain, or recorded in mock mode). */
  @Column({ type: 'timestamptz', nullable: true })
  playerAStakedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  playerBStakedAt: Date | null;

  @Column({ type: 'enum', enum: SettlementKind, enumName: 'pvp_settlement_kind', nullable: true })
  settlementKind: SettlementKind | null;

  /** Recorded with the settlement intent, before the payout is submitted. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  winnerId: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  settlementTxHash: string | null;

  @Column({ type: 'integer', nullable: true })
  settlementLedger: number | null;

  @Column({ type: 'integer', default: 0 })
  reconcileAttempts: number;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
