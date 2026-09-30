import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A minimal signed session token: `<playerId>.<expiry>.<hmac>`. Real games
 * will use their own auth (LyricsFlip uses JWTs); the toolkit only needs an
 * `authenticate(request)` that returns the player id.
 */
export class Tokens {
  constructor(private readonly secret: string) {}

  issue(playerId: string, ttlSeconds = 86_400): string {
    const payload = `${playerId}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [playerId, expiry, mac] = parts;
    const expected = this.sign(`${playerId}.${expiry}`);
    if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    if (Number(expiry) < Date.now() / 1000) return null;
    return playerId;
  }

  fromRequest(request: { headers?: Record<string, unknown> }): string | null {
    const header = request.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    return this.verify(header.slice(7));
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
