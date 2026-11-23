import { BadRequestException, Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ArgumentsHost,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { IsString, IsUUID, MaxLength } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

class SessionPayload {
  @IsUUID()
  sessionId: string;
}

class SubmitGuessPayload {
  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(200)
  guess: string;
}

class AuthPayload {
  @IsString()
  token: string;
}

/**
 * Real-time play. Every connection must present the game's JWT (as
 * `auth.token` in the Socket.IO handshake, or a bearer header); the player
 * is always the token's subject, never a field in a message.
 *
 * The token's `exp` is stored on the socket and re-checked on every message,
 * so a long-lived socket cannot outlive its JWT. A client can re-authenticate
 * over an existing socket by sending an `auth` message with a fresh token.
 *
 * The session payloads mirror the HTTP ones and include `totalRounds`, the
 * round the session finishes at. `guessResult` carries it too, and
 * `sessionFinished` repeats it so a client can show the final "round N of N".
 */
@WebSocketGateway({
  namespace: '/game',
  cors: { origin: true, credentials: true },
})
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseFilters(new WsValidationExceptionFilter())
export class GameGateway implements OnGatewayConnection {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(client: Socket): void {
    const auth = this.authenticate(client);
    if (!auth) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.userId = auth.userId;
    client.data.exp = auth.exp;
  }

  @SubscribeMessage('auth')
  handleAuth(@MessageBody() payload: AuthPayload, @ConnectedSocket() client: Socket) {
    const auth = this.verifyToken(payload.token);
    if (!auth) {
      this.reject(client);
      return { ok: false };
    }
    client.data.userId = auth.userId;
    client.data.exp = auth.exp;
    client.emit('authenticated', { userId: auth.userId });
    return { ok: true };
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
    client.emit('guessResult', result);
    this.server.to(payload.sessionId).emit('scoreUpdate', {
      sessionId: payload.sessionId,
      userId,
      pointsAwarded: result.pointsAwarded,
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

  private authenticate(client: Socket): { userId: string; exp: number } | null {
    const fromAuth = client.handshake.auth?.token;
    const header = client.handshake.headers?.authorization;
    const token =
      typeof fromAuth === 'string'
        ? fromAuth
        : typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
          ? header.slice(7)
          : null;
    if (!token) return null;
    return this.verifyToken(token);
  }

  private verifyToken(token: string): { userId: string; exp: number } | null {
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      if (!payload.sub || typeof payload.exp !== 'number') return null;
      return { userId: payload.sub, exp: payload.exp };
    } catch {
      this.logger.debug('Rejected a socket with an invalid token');
      return null;
    }
  }

  private userId(client: Socket): string {
    const userId = client.data.userId as string | undefined;
    const exp = client.data.exp as number | undefined;
    if (!userId || typeof exp !== 'number' || this.isExpired(exp)) {
      this.reject(client);
      throw new WsException('Unauthorized');
    }
    return userId;
  }

  private isExpired(exp: number): boolean {
    return exp * 1000 <= Date.now();
  }

  private reject(client: Socket): void {
    client.emit('unauthorized', { message: 'Unauthorized' });
    client.disconnect(true);
  }

  private async requireParticipant(sessionId: string, client: Socket): Promise<void> {
    const session = await this.gameService.getSession(sessionId);
    if (!session.playerIds.includes(this.userId(client))) {
      throw new WsException('You are not a player in this session');
    }
  }
}

/**
 * Turns `ValidationPipe` failures on socket payloads into a `WsException`
 * with a readable message, so clients get a validation error instead of a
 * generic exception (or a downstream database error).
 */
class WsValidationExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: unknown }).message)
            ? ((response as { message: string[] }).message).join('; ')
            : ((response as { message?: string }).message ?? exception.message);
      super.catch(new WsException(message), host);
      return;
    }
    super.catch(exception, host);
  }
}
