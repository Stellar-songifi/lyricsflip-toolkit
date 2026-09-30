import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PushMessage, PushTransport } from './expo-push.client';
import { PushToken } from './push-token.entity';

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushToken) private readonly tokens: Repository<PushToken>,
    private readonly transport: PushTransport,
  ) {}

  static isExpoToken(token: string): boolean {
    return EXPO_TOKEN.test(token);
  }

  /** Registers a device for `userId`, moving it off any previous user. */
  async register(userId: string, token: string, platform: string): Promise<PushToken> {
    await this.tokens.delete({ token });
    return this.tokens.save(this.tokens.create({ userId, token, platform }));
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.tokens.delete({ userId, token });
  }

  /** Pushes to every device of `userId`. Never throws; forgets dead tokens. */
  async sendToUser(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    const devices = await this.tokens.find({ where: { userId } });
    if (devices.length === 0) return;
    const messages: PushMessage[] = devices.map((d) => ({ to: d.token, title, body, data }));
    try {
      const tickets = await this.transport.send(messages);
      const dead = tickets.filter((t) => t.error === 'DeviceNotRegistered').map((t) => t.token);
      if (dead.length) await this.tokens.delete({ token: In(dead) });
    } catch (err) {
      this.logger.warn(`Push to ${userId} failed: ${(err as Error).message}`);
    }
  }
}
