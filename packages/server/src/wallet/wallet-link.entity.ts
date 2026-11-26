import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

/**
 * Links one player account to exactly one wallet, proven with SEP-10.
 * Both columns are unique: a wallet can't back two accounts, and an account
 * can't switch wallets while it has a wager in flight (see WalletLinkService).
 *
 * `playerId` is the primary key so the service's upsert can target
 * `ON CONFLICT (playerId)`. `address` carries a named unique constraint
 * (`UQ_pvp_wallet_links_address`) so the service can reliably detect the
 * address unique violation (Postgres error code `23505`) and map it to
 * 409 Conflict. `WalletLinkService.link` runs in a transaction that locks the
 * player's link row and uses an upsert rather than delete-then-insert.
 */
@Entity('pvp_wallet_links')
@Unique('UQ_pvp_wallet_links_address', ['address'])
export class WalletLink {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  playerId: string;

  @Column({ type: 'varchar', length: 64 })
  address: string;

  @CreateDateColumn({ type: 'timestamptz' })
  verifiedAt: Date;
}