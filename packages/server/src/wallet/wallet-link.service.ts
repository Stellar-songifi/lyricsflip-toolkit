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
   */
  async link(playerId: string, address: string): Promise<WalletLink> {
    const owner = await this.findPlayerByAddress(address);
    if (owner && owner !== playerId) {
      throw new ConflictException('This wallet is already linked to another account');
    }
    const existing = await this.links.findOne({ where: { playerId } });
    if (existing?.address === address) {
      return existing;
    }
    if (existing) {
      const inFlight = await this.wagers.count({
        where: [
          { playerAId: playerId, status: In(IN_FLIGHT) },
          { playerBId: playerId, status: In(IN_FLIGHT) },
        ],
      });
      if (inFlight > 0) {
        throw new ConflictException("You can't change wallets while a wager is in progress");
      }
      await this.links.delete({ playerId });
    }
    return this.links.save(this.links.create({ playerId, address }));
  }
}
