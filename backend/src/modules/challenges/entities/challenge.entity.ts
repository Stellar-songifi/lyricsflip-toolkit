import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum ChallengeStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
}

/**
 * A short-lived invite code for a head-to-head match. Carries the intended
 * stake (if any) so the joiner doesn't need to negotiate it separately —
 * accepting the code creates the game session and, when a stake was set,
 * the wager in one step. See README.md#wagers-and-settlement.
 */
@Entity('challenges')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 8 })
  code: string;

  @Column({ type: 'uuid' })
  hostUserId: string;

  /** Stroops, as a string. Null means an unstaked match. */
  @Column({ type: 'varchar', nullable: true })
  stakeAmount: string | null;

  @Column({ type: 'enum', enum: ChallengeStatus, default: ChallengeStatus.PENDING })
  status: ChallengeStatus;

  @Column({ type: 'uuid', nullable: true })
  gameSessionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  wagerId: string | null;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
