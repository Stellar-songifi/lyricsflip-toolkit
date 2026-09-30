import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
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

  async markRead(id: string): Promise<void> {
    await this.notificationsRepository.update({ id }, { read: true });
  }

  @OnEvent('guess.submitted')
  handleGuessSubmitted(payload: { sessionId: string; userId: string; outcome: string }) {
    if (payload.outcome === 'correct') {
      void this.push(payload.userId, 'guess.correct', 'Nice — that one was correct.');
    }
  }

  @OnEvent('wager.settled')
  handleWagerSettled(payload: { winnerId: string; loserId: string; stakeAmount: string }) {
    void this.push(payload.winnerId, 'wager.won', `You won the pot — ${payload.stakeAmount} stroops.`);
    void this.push(payload.loserId, 'wager.lost', 'Your opponent took the pot this time.');
  }
}
