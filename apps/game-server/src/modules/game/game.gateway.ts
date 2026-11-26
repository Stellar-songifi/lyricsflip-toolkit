import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

interface SessionPayload {
  sessionId: string;
}

interface SubmitGuessPayload {
  sessionId: string;
  guess: string;
}

/**
 * Real-time play. Every connection must present the game's JWT (as
 * `auth.token` in the Socket.IO handshake, or a bearer header); the player
 * is always the token's subject, never a field in a message.
 *
 * The session payloads mirror the HTTP ones and include `totalRounds`, the
 * round the session finishes at. `guessResult` carries it too, and
 * `sessionFinished` repeats it so a client can show the final "round N of N".
 *
 * CORS is enforced in `handleConnection` from the same `corsOrigin` value the
 * HTTP API uses: handshakes from a disallowed `Origin` are refused, while
 * native clients (which send no `Origin`) are allowed.
 * In head-to-head and room sessions a round only advances once every player
 * has answered. `guessResult` and `scoreUpdate` therefore carry a
 * `waitingForOpponent` flag so a client that has already answered knows the
 * round is not over yet and it should wait for the next `lyric`.
 */
@WebSocketGateway({
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection {
  private readonly logger = new Logger(GameGateway.name);
  private readonly allowedOrigins: string[];

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.allowedOrigins = (config.get<string>('corsOrigin') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  handleConnection(client: Socket): void {
    if (!this.isOriginAllowed(client)) {
      this.logger.debug(`Rejected a socket from disallowed origin: ${client.handshake.headers?.origin}`);
      client.emit('error', { message: 'Origin not allowed' });
      client.disconnect(true);
      return;
    }
    const userId = this.authenticate(client);
    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
  }

  private isOriginAllowed(client: Socket): boolean {
    const origin = client.handshake.headers?.origin;
    // Native apps send no Origin header; allow them.
    if (!origin) return true;
    return this.allowedOrigins.includes(origin);
  }

  @SubscribeMessage('requestLyric')
  async handleRequestLyric(@MessageBody() payload: SessionPayload, @ConnectedSocket() client: Socket) {
    await this.requireParticipant(payload.sessionId, client);
    const lyric = await this.gameService.getCurrentLyric(payload.sessionId);
    await client.join(payload.sessionId);
    client.emit('lyric', lyric);
    return lyric;
  }

  @SubscribeMessage('submitGuess')
  async handleSubmitGuess(@MessageBody() payload: SubmitGuessPayload, @ConnectedSocket() client: Socket) {
    const userId = this.userId(client);
    const result = await this.gameService.submitGuess(payload.sessionId, userId, payload.guess);
    const waitingForOpponent = result.waitingForOpponent === true;
    client.emit('guessResult', { ...result, waitingForOpponent });
    this.server.to(payload.sessionId).emit('scoreUpdate', {
      sessionId: payload.sessionId,
      userId,
      pointsAwarded: result.pointsAwarded,
      waitingForOpponent,
    });
    if (result.nextLyric) {
      this.server.to(payload.sessionId).emit('lyric', result.nextLyric);
    }
    if (result.sessionStatus === 'finished') {
      this.server.to(payload.sessionId).emit('sessionFinished', {
        sessionId: payload.sessionId,
        totalRounds: result.totalRounds,
      });
    }
    return result;
  }

  @SubscribeMessage('getSession')
  async handleGetSession(@MessageBody() payload: SessionPayload, @ConnectedSocket() client: Socket) {
    const session = await this.gameService.getSession(payload.sessionId);
    client.emit('session', session);
    return session;
  }

  private authenticate(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    const header = client.handshake.headers?.authorization;
    const token =
      typeof fromAuth === 'string'
        ? fromAuth
        : typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
          ? header.slice(7)
          : null;
    if (!token) return null;
    try {
      return this.jwt.verify<JwtPayload>(token).sub;
    } catch {
      this.logger.debug('Rejected a socket with an invalid token');
      return null;
    }
  }

  private userId(client: Socket): string {
    const userId = client.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthorized');
    return userId;
  }

  private async requireParticipant(sessionId: string, client: Socket): Promise<void> {
    const session = await this.gameService.getSession(sessionId);
    if (!session.playerIds.includes(this.userId(client))) {
      throw new WsException('You are not a player in this session');
    }
  }
}
