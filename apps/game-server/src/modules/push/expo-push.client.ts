import { Injectable, Logger } from '@nestjs/common';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts up to 100 messages per request

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Delivered to the app; `url` is a deep link the app opens on tap. */
  data?: Record<string, unknown>;
}

export interface PushTicket {
  token: string;
  ok: boolean;
  /** `DeviceNotRegistered` means the token is dead and should be forgotten. */
  error?: string;
}

/** Sends pushes. Swappable so tests and local runs never reach Expo. */
export abstract class PushTransport {
  abstract send(messages: PushMessage[]): Promise<PushTicket[]>;
}

/** Delivers through Expo's push service (no credentials needed for Expo push tokens). */
@Injectable()
export class ExpoPushTransport extends PushTransport {
  private readonly logger = new Logger(ExpoPushTransport.name);

  constructor(private readonly accessToken?: string) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default' }))),
        });
        const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
        batch.forEach((m, idx) => {
          const t = json.data?.[idx];
          tickets.push({ token: m.to, ok: t?.status === 'ok', error: t?.details?.error });
        });
      } catch (err) {
        this.logger.warn(`Expo push failed: ${(err as Error).message}`);
        batch.forEach((m) => tickets.push({ token: m.to, ok: false, error: 'NetworkError' }));
      }
    }
    return tickets;
  }
}

/** Records messages instead of sending them. Used when push is disabled. */
export class RecordingPushTransport extends PushTransport {
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.to, ok: true }));
  }
}
