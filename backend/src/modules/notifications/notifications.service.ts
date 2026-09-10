import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  message: string;
  createdAt: Date;
  read: boolean;
}

/**
 * Held in memory only — cleared on every restart. Fine for local dev, not
 * for production. See README.md#known-gaps.
 */
@Injectable()
export class NotificationsService {
  private readonly notifications: Notification[] = [];
  private counter = 0;

  push(userId: string, type: string, message: string): Notification {
    const notification: Notification = {
      id: String(++this.counter),
      userId,
      type,
      message,
      createdAt: new Date(),
      read: false,
    };
    this.notifications.push(notification);
    return notification;
  }

  findForUser(userId: string): Notification[] {
    return this.notifications.filter((n) => n.userId === userId);
  }

  markRead(id: string): void {
    const notification = this.notifications.find((n) => n.id === id);
    if (notification) {
      notification.read = true;
    }
  }

  @OnEvent('guess.submitted')
  handleGuessSubmitted(payload: { sessionId: string; userId: string; outcome: string }) {
    if (payload.outcome === 'correct') {
      this.push(payload.userId, 'guess.correct', `Nice — that one was correct.`);
    }
  }
}
