import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { PvpEvent, fromStroops } from '@lyricsflip-toolkit/server';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
  ) {}

  push(userId: string, type: string, message: string): Promise<Notification> {
    return this.notificationsRepository.save(
      this.notificationsRepository.create({ userId, type, message }),
    );
  }

  findForUser(userId: string): Promise<Notification[]> {
    return this.notificationsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Marks one of the user's own notifications read. */
  async markRead(id: string, userId: string): Promise<void> {
    await this.notificationsRepository.update({ id, userId }, { read: true });
  }

  @OnEvent('guess.submitted')
  handleGuessSubmitted(payload: { sessionId: string; userId: string; outcome: string }) {
    if (payload.outcome === 'correct') {
      void this.push(payload.userId, 'guess.correct', 'Nice — that one was correct.');
    }
  }

  @OnEvent('pvp.wager.accepted')
  handleWagerAccepted({ wager }: PvpEvent) {
    const stake = fromStroops(wager.stakeAmount);
    const message = `Your match is on. Stake ${stake} to start playing.`;
    void this.push(wager.playerAId, 'wager.stake_requested', message);
    void this.push(wager.playerBId, 'wager.stake_requested', message);
  }

  @OnEvent('pvp.wager.won')
  handleWagerWon({ wager }: PvpEvent) {
    const loserId = wager.winnerId === wager.playerAId ? wager.playerBId : wager.playerAId;
    const pot = fromStroops((BigInt(wager.stakeAmount) * 2n).toString());
    void this.push(wager.winnerId as string, 'wager.won', `You won the pot: ${pot}.`);
    void this.push(loserId, 'wager.lost', 'Your opponent took the pot this time.');
  }

  @OnEvent('pvp.wager.refunded')
  handleWagerRefunded({ wager }: PvpEvent) {
    const message = 'Your stake was returned.';
    void this.push(wager.playerAId, 'wager.refunded', message);
    void this.push(wager.playerBId, 'wager.refunded', message);
  }
}
