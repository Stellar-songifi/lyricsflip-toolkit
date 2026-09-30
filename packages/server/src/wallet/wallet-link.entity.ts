import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Links one player account to exactly one wallet, proven with SEP-10.
 * Both columns are unique: a wallet can't back two accounts, and an account
 * can't switch wallets while it has a wager in flight (see WalletLinkService).
 */
@Entity('pvp_wallet_links')
export class WalletLink {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  playerId: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  address: string;

  @CreateDateColumn({ type: 'timestamptz' })
  verifiedAt: Date;
}
