import { SettlementSweeperService } from './settlement-sweeper.service';

describe('SettlementSweeperService (issue #30)', () => {
  let sweeper: SettlementSweeperService;
  let mockWagers: any;
  let mockRunner: any;
  let mockDataSource: any;

  beforeEach(() => {
    mockWagers = {
      settleMatch: jest.fn(),
    };
    mockRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockRunner),
    };
    sweeper = new SettlementSweeperService(mockWagers, mockDataSource);
  });

  it('skips sweep if advisory lock cannot be acquired', async () => {
    mockRunner.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ locked: false }]);
      }
      return Promise.resolve([]);
    });

    const count = await sweeper.sweep();
    expect(count).toBe(0);
    expect(mockWagers.settleMatch).not.toHaveBeenCalled();
    expect(mockRunner.release).toHaveBeenCalled();
  });

  it('finds and settles stuck staked wagers for finished sessions', async () => {
    mockRunner.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ locked: true }]);
      }
      if (sql.includes('SELECT s.id')) {
        return Promise.resolve([
          {
            id: 'session-1',
            playerIds: ['player-a', 'player-b'],
            scores: { 'player-a': 100, 'player-b': 50 },
          },
        ]);
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    mockWagers.settleMatch.mockResolvedValue({ id: 'wager-1', status: 'won' });

    const count = await sweeper.sweep();
    expect(count).toBe(1);
    expect(sweeper.settledCount).toBe(1);
    expect(mockWagers.settleMatch).toHaveBeenCalledWith('session-1', {
      winnerId: 'player-a',
    });
  });

  it('handles draws when scores are equal', async () => {
    mockRunner.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ locked: true }]);
      }
      if (sql.includes('SELECT s.id')) {
        return Promise.resolve([
          {
            id: 'session-2',
            playerIds: ['player-a', 'player-b'],
            scores: { 'player-a': 50, 'player-b': 50 },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    mockWagers.settleMatch.mockResolvedValue({ id: 'wager-2', status: 'refunded' });

    const count = await sweeper.sweep();
    expect(count).toBe(1);
    expect(mockWagers.settleMatch).toHaveBeenCalledWith('session-2', { draw: true });
  });

  it('running twice when wagers are already settled does nothing on second pass', async () => {
    let callCount = 0;
    mockRunner.query.mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ locked: true }]);
      }
      if (sql.includes('SELECT s.id')) {
        callCount++;
        // First run returns 1 stuck session; second run returns 0 (already settled)
        if (callCount === 1) {
          return Promise.resolve([
            {
              id: 'session-1',
              playerIds: ['player-a', 'player-b'],
              scores: { 'player-a': 10, 'player-b': 0 },
            },
          ]);
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    mockWagers.settleMatch.mockResolvedValue({ id: 'wager-1', status: 'won' });

    const count1 = await sweeper.sweep();
    expect(count1).toBe(1);

    const count2 = await sweeper.sweep();
    expect(count2).toBe(0);
  });
});
