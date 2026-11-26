import { WsException } from '@nestjs/websockets';
import { GameGateway } from './game.gateway';
import { GameSession, GameSessionStatus, GameMode } from './entities/game-session.entity';

describe('GameGateway (issue #29)', () => {
  let gateway: GameGateway;
  let mockGameService: any;
  let mockJwtService: any;

  const mockSession: Partial<GameSession> = {
    id: 'session-123',
    mode: GameMode.HEAD_TO_HEAD,
    status: GameSessionStatus.ACTIVE,
    playerIds: ['user-player-1', 'user-player-2'],
  };

  beforeEach(() => {
    mockGameService = {
      getSession: jest.fn().mockImplementation((id: string) => {
        if (id === 'session-123') return Promise.resolve(mockSession);
        throw new Error('Not found');
      }),
      getCurrentLyric: jest.fn().mockResolvedValue({
        id: 'lyric-1',
        snippet: 'some lyrics',
        genre: 'pop',
        decade: 2020,
      }),
    };
    mockJwtService = {
      verify: jest.fn(),
    };
    gateway = new GameGateway(mockGameService, mockJwtService);
  });

  it('allows a participant to call getSession', async () => {
    const client: any = {
      data: { userId: 'user-player-1' },
      emit: jest.fn(),
    };
    const session = await gateway.handleGetSession({ sessionId: 'session-123' }, client);
    expect(session).toEqual(mockSession);
    expect(client.emit).toHaveBeenCalledWith('session', mockSession);
  });

  it('throws WsException when non-participant calls getSession', async () => {
    const client: any = {
      data: { userId: 'eavesdropper' },
      emit: jest.fn(),
    };
    await expect(gateway.handleGetSession({ sessionId: 'session-123' }, client)).rejects.toThrow(
      WsException,
    );
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('throws WsException when non-participant calls requestLyric', async () => {
    const client: any = {
      data: { userId: 'eavesdropper' },
      emit: jest.fn(),
      join: jest.fn(),
    };
    await expect(gateway.handleRequestLyric({ sessionId: 'session-123' }, client)).rejects.toThrow(
      WsException,
    );
  });
});
