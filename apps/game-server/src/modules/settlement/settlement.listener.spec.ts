import { SettlementListener } from './settlement.listener';
import { GameMode } from '../game/entities/game-session.entity';

describe('SettlementListener', () => {
  const wagers = { settleMatch: jest.fn() };
  const games = { activate: jest.fn(), cancel: jest.fn() };
  const listener = new SettlementListener(wagers as never, games as never);

  beforeEach(() => jest.resetAllMocks());

  it('settles a finished head-to-head match with the higher scorer as winner', async () => {
    wagers.settleMatch.mockResolvedValue({ id: 'w', status: 'won' });
    await listener.onSessionFinished({
      sessionId: 's1',
      mode: GameMode.HEAD_TO_HEAD,
      playerIds: ['a', 'b'],
      scores: { a: 10, b: 40 },
    });
    expect(wagers.settleMatch).toHaveBeenCalledWith('s1', { winnerId: 'b' });
  });

  it('settles a tie as a draw', async () => {
    await listener.onSessionFinished({
      sessionId: 's2',
      mode: GameMode.HEAD_TO_HEAD,
      playerIds: ['a', 'b'],
      scores: { a: 5, b: 5 },
    });
    expect(wagers.settleMatch).toHaveBeenCalledWith('s2', { draw: true });
  });

  it('ignores solo and room sessions', async () => {
    for (const mode of [GameMode.SOLO, GameMode.ROOM]) {
      await listener.onSessionFinished({ sessionId: 's', mode, playerIds: ['a'], scores: { a: 1 } });
    }
    expect(wagers.settleMatch).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when settlement fails, leaving it to reconciliation', async () => {
    wagers.settleMatch.mockRejectedValue(new Error('rpc down'));
    await expect(
      listener.onSessionFinished({
        sessionId: 's3',
        mode: GameMode.HEAD_TO_HEAD,
        playerIds: ['a', 'b'],
        scores: { a: 1, b: 0 },
      }),
    ).resolves.toBeUndefined();
  });

  it('starts the match once the wager is staked, and cancels it if the wager ends first', async () => {
    const wager = { matchId: 'session-9' } as never;
    await listener.onWagerStaked({ type: 'wager.staked', wager });
    expect(games.activate).toHaveBeenCalledWith('session-9');
    await listener.onWagerEndedEarly({ type: 'wager.cancelled', wager });
    expect(games.cancel).toHaveBeenCalledWith('session-9');
  });
});
