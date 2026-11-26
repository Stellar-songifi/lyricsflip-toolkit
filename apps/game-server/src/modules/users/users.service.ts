import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LEVEL_THRESHOLDS, PlayerLevel, User } from './entities/user.entity';
import { isUniqueViolation } from '../../common/db-errors';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { username } });
    if (!user) {
      throw new NotFoundException(`No player called ${username}`);
    }
    return user;
  }

  async rename(id: string, username: string): Promise<User> {
    const taken = await this.usersRepository.findOne({ where: { username } });
    if (taken && taken.id !== id) {
      throw new ConflictException('That username is taken');
    }
    await this.usersRepository.update({ id }, { username });
    return this.findById(id);
  }

  /**
   * Finds the user for a wallet, creating one on first sign-in.
   *
   * The username is derived deterministically from the wallet. Two different
   * wallets can share a short prefix, so a plain `player_<first 6>` is not
   * guaranteed unique; on a unique-constraint violation we retry with a longer,
   * still-deterministic slice of the same wallet until one is free.
   */
  async findOrCreateByWallet(walletAddress: string): Promise<User> {
    const existing = await this.usersRepository.findOne({ where: { walletAddress } });
    if (existing) {
      return existing;
    }

    const candidates = this.usernameCandidates(walletAddress);
    let lastError: unknown;
    for (const username of candidates) {
      const user = this.usersRepository.create({ walletAddress, username });
      try {
        return await this.usersRepository.save(user);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        lastError = err;
      }
    }
    // Every deterministic candidate collided (e.g. a concurrent sign-in for the
    // same wallet); surface the last violation rather than a plain Error.
    throw lastError;
  }

  /** Deterministic usernames to try, shortest (most collision-prone) first. */
  private usernameCandidates(walletAddress: string): string[] {
    const lower = walletAddress.toLowerCase();
    return [
      `player_${lower.slice(0, 6)}`,
      `player_${lower.slice(0, 10)}`,
      `player_${lower.slice(0, 14)}`,
      `player_${lower}`,
    ];
  }

  async getLeaderboard(limit = 20): Promise<User[]> {
    return this.usersRepository.find({
      order: { xp: 'DESC' },
      take: limit,
    });
  }

  /** Awards XP/score for a guess and recomputes the player's level. */
  async awardXp(userId: string, xpGained: number, wasCorrect: boolean): Promise<User> {
    const user = await this.findById(userId);
    user.xp += xpGained;
    user.score += xpGained;
    if (wasCorrect) {
      user.correctGuesses += 1;
    }
    user.level = levelForXp(user.xp);
    return this.usersRepository.save(user);
  }
}

export function levelForXp(xp: number): PlayerLevel {
  let level = PlayerLevel.GOSSIP_ROOKIE;
  for (const threshold of LEVEL_THRESHOLDS) {
    if (xp >= threshold.minXp) {
      level = threshold.level;
    }
  }
  return level;
}
