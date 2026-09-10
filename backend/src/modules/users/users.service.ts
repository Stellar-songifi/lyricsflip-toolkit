import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LEVEL_THRESHOLDS, PlayerLevel, User } from './entities/user.entity';

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

  async findOrCreateByWallet(walletAddress: string): Promise<User> {
    let user = await this.usersRepository.findOne({ where: { walletAddress } });
    if (!user) {
      user = this.usersRepository.create({
        walletAddress,
        username: `player_${walletAddress.slice(0, 6).toLowerCase()}`,
      });
      user = await this.usersRepository.save(user);
    }
    return user;
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
