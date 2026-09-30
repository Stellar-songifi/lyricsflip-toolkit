import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { PvpEvent, fromStroops } from '@lyricsflip-toolkit/server';
import { Notification } from './entities/notification.entity';
import { PushService } from '../push/push.service';
import { GameMode } from '../game/entities/game-session.entity';
import type { SessionFinishedEvent } from '../game/game.service';
import { deepLink } from './deep-links';

/** Notification types that also go to the user's phone. */
const PUSHED = new Set(['challenge.invite', 'match.finished', 'wager.stake_requested', 'wager.won', 'wager.lost', 'wager.refunded']);

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly pushService: PushService,
  ) {}

  /** Stores a notification and, for the types in PUSHED, sends it to the user's devices. */
  async push(
    userId: string,
    type: string,
    message: string,
    data: Record<string, unknown> | null = null,
  ): Promise<Notification> {
    const saved = await this.notificationsRepository.save(
      this.notificationsRepository.create({ userId, type, message, data }),
    );
    if (PUSHED.has(type)) {
      await this.pushService.sendToUser(userId, 'LyricsFlip', message, { type, ...(data ?? {}) });
    }
    return saved;
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

  @OnEvent('game.session.finished')
  handleSessionFinished(event: SessionFinishedEvent) {
    if (event.mode !== GameMode.HEAD_TO_HEAD) return;
    const data = { url: deepLink.results(event.sessionId), sessionId: event.sessionId };
    for (const userId of event.playerIds) {
      const mine = event.scores[userId] ?? 0;
      const theirs = event.playerIds.filter((id) => id !== userId).map((id) => event.scores[id] ?? 0)[0] ?? 0;
      const verdict = mine > theirs ? 'You won' : mine < theirs ? 'You lost' : "It's a draw";
      void this.push(userId, 'match.finished', `${verdict}, ${mine}–${theirs}.`, data);
    }
  }

  @OnEvent('pvp.wager.accepted')
  handleWagerAccepted({ wager }: PvpEvent) {
    const stake = fromStroops(wager.stakeAmount);
    const message = `Your match is on. Stake ${stake} to start playing.`;
    const data = { url: deepLink.match(wager.matchId), sessionId: wager.matchId, wagerId: wager.id };
    void this.push(wager.playerAId, 'wager.stake_requested', message, data);
    void this.push(wager.playerBId, 'wager.stake_requested', message, data);
  }

  @OnEvent('pvp.wager.won')
  handleWagerWon({ wager }: PvpEvent) {
    const loserId = wager.winnerId === wager.playerAId ? wager.playerBId : wager.playerAId;
    const pot = fromStroops((BigInt(wager.stakeAmount) * 2n).toString());
    const data = { url: deepLink.results(wager.matchId), sessionId: wager.matchId, wagerId: wager.id };
    void this.push(wager.winnerId as string, 'wager.won', `You won the pot: ${pot}.`, data);
    void this.push(loserId, 'wager.lost', 'Your opponent took the pot this time.', data);
  }

  @OnEvent('pvp.wager.refunded')
  handleWagerRefunded({ wager }: PvpEvent) {
    const message = 'Your stake was returned.';
    const data = { url: deepLink.results(wager.matchId), sessionId: wager.matchId, wagerId: wager.id };
    void this.push(wager.playerAId, 'wager.refunded', message, data);
    void this.push(wager.playerBId, 'wager.refunded', message, data);
  }
}
