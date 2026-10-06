import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One row per SEP-10 challenge hash that has been redeemed. The primary
 * key enforces single-use even across horizontally-scaled instances and
 * process restarts: the redeem path is an atomic
 * `INSERT ... ON CONFLICT DO NOTHING`, and a no-op insert means the
 * challenge was already spent (issue #1).
 *
 * Rows are retained until `expiresAt` (the challenge's own maxTime bound),
 * then swept by `Sep10CleanupService`.
 */
@Entity('pvp_sep10_redeemed')
export class Sep10Redeemed {
  /** Hex-encoded transaction hash of the signed challenge. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  hash: string;

  /** Unix seconds at which the challenge's time bound lapses. */
  @Index('IDX_pvp_sep10_redeemed_expiresAt')
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}