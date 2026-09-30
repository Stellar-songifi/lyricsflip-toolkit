import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { PotStatus } from './escrow.gateway';

/**
 * A pot in `mock` settlement mode. Stored in Postgres so mock pots survive a
 * restart and reconciliation works the same way it does against the chain.
 */
@Entity('pvp_mock_pots')
export class MockPot {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  playerA: string;

  @Column({ type: 'varchar', length: 64 })
  playerB: string;

  @Column({ type: 'varchar', length: 40 })
  stakeAmount: string;

  @Column({ default: false })
  playerAStaked: boolean;

  @Column({ default: false })
  playerBStaked: boolean;

  @Column({ type: 'varchar', length: 16 })
  status: PotStatus;

  @Column({ type: 'integer' })
  deadlineLedger: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  winner: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
