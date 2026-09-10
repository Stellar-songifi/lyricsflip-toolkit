import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';

interface RequestLyricPayload {
  sessionId: string;
}

interface SubmitGuessPayload {
  sessionId: string;
  userId: string;
  guess: string;
}

interface GetSessionPayload {
  sessionId: string;
}

@WebSocketGateway({
  namespace: '/game',
  cors: { origin: true, credentials: true },
})
export class GameGateway {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly gameService: GameService) {}

  @SubscribeMessage('requestLyric')
  async handleRequestLyric(
    @MessageBody() payload: RequestLyricPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const lyric = await this.gameService.getCurrentLyric(payload.sessionId);
    client.join(payload.sessionId);
    client.emit('lyric', lyric);
    return lyric;
  }

  @SubscribeMessage('submitGuess')
  async handleSubmitGuess(
    @MessageBody() payload: SubmitGuessPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const result = await this.gameService.submitGuess(
      payload.sessionId,
      payload.userId,
      payload.guess,
    );
    client.emit('guessResult', result);
    this.server.to(payload.sessionId).emit('scoreUpdate', {
      sessionId: payload.sessionId,
      userId: payload.userId,
      pointsAwarded: result.pointsAwarded,
    });
    if (result.nextLyric) {
      this.server.to(payload.sessionId).emit('lyric', result.nextLyric);
    }
    return result;
  }

  @SubscribeMessage('getSession')
  async handleGetSession(
    @MessageBody() payload: GetSessionPayload,
    @ConnectedSocket() client: Socket,
  ) {
    const session = await this.gameService.getSession(payload.sessionId);
    client.emit('session', session);
    return session;
  }
}
