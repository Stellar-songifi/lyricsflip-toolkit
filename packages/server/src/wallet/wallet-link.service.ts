import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Wager, WagerStatus } from '../wager/wager.entity';
import { WalletLink } from './wallet-link.entity';

const IN_FLIGHT: WagerStatus[] = [
  WagerStatus.PENDING,
  WagerStatus.AWAITING_STAKES,
  WagerStatus.STAKED,
  WagerStatus.SETTLING,
];

/** One player account ↔ one wallet. Only call `link` with a SEP-10-verified address. */
@Injectable()
export class WalletLinkService {
  constructor(
    @InjectRepository(WalletLink) private readonly links: Repository<WalletLink>,
    @InjectRepository(Wager) private readonly wagers: Repository<Wager>,
  ) {}

  async getAddress(playerId: string): Promise<string | null> {
    const link = await this.links.findOne({ where: { playerId } });
    return link?.address ?? null;
  }

  async findPlayerByAddress(address: string): Promise<string | null> {
    const link = await this.links.findOne({ where: { address } });
    return link?.playerId ?? null;
  }

  /**
   * Links `address` to `playerId`. Refused if the wallet belongs to another
   * player, or if the player would switch wallets with a wager in flight.
   *
   * The whole operation runs in a single transaction that locks the player's
   * link row, so concurrent verifies serialize and a failed upsert never
   * leaves the player without a wallet.
   */
  async link(playerId: string, address: string): Promise<WalletLink> {
    return this.links.manager.transaction(async (manager) => {
      // Lock the player's link row (no-op if none exists yet; the upsert below
      // serializes on the unique playerId constraint).
      const existing = await manager
        .createQueryBuilder(WalletLink, 'l')
        .setLock('pessimistic_write')
        .where('l.playerId = :playerId', { playerId })
        .getOne();

      const owner = await manager.findOne(WalletLink, { where: { address } });
      if (owner && owner.playerId !== playerId) {
        throw new ConflictException('This wallet is already linked to another account');
      }

      if (existing?.address === address) {
        return existing;
      }

      if (existing) {
        const inFlight = await manager.count(Wager, {
          where: [
            { playerAId: playerId, status: In(IN_FLIGHT) },
            { playerBId: playerId, status: In(IN_FLIGHT) },
          ],
        });
        if (inFlight > 0) {
          throw new ConflictException("You can't change wallets while a wager is in progress");
        }
      }

      try {
        await manager
          .createQueryBuilder()
          .insert()
          .into(WalletLink)
          .values({ playerId, address })
          .orUpdate(['address'], ['playerId'])
          .execute();
      } catch (error) {
        if ((error as { code?: string })?.code === '23505') {
          throw new ConflictException('This wallet is already linked to another account');
        }
        throw error;
      }

      const linked = await manager.findOne(WalletLink, { where: { playerId } });
      if (!linked) {
        throw new ConflictException('Failed to link wallet');
      }
      return linked;
    });
  }
}
