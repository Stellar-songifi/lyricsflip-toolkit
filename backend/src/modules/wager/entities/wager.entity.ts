import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * `pending` -> `awaiting_stakes` -> `staked` -> `settling` -> `won` | `refunded`,
 * with `failed` for anything that needs an operator to reconcile against the
 * ledger. See README.md#wagers-and-settlement.
 */
export enum WagerStatus {
  PENDING = 'pending',
  AWAITING_STAKES = 'awaiting_stakes',
  STAKED = 'staked',
  SETTLING = 'settling',
  WON = 'won',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

@Entity('wagers')
export class Wager {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  gameSessionId: string;

  @Column({ type: 'uuid' })
  playerAId: string;

  @Column({ type: 'uuid' })
  playerBId: string;

  /** Stroops, carried as a string — never a float. 7 decimal places. */
  @Column({ type: 'varchar' })
  stakeAmount: string;

  @Column({ type: 'enum', enum: WagerStatus, default: WagerStatus.PENDING })
  status: WagerStatus;

  @Column({ default: false })
  playerAStaked: boolean;

  @Column({ default: false })
  playerBStaked: boolean;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  settlementTxHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
