import { ForbiddenException } from '@nestjs/common';
import { GameService } from './game.service';
import { GameMode, GameSessionStatus } from './entities/game-session.entity';
import { Difficulty } from '../lyrics/entities/lyric.entity';

const LYRIC = {
  id: 'lyric-1',
  snippet: 'what what, what what',
  artist: 'Macklemore',
  title: 'Thrift Shop',
  genre: 'hip hop',
  decade: 2010,
  difficulty: Difficulty.EASY,
};

/**
 * An in-memory stand-in for the TypeORM repository, so this needs no Postgres.
 * `manager.transaction` queues callbacks instead of running them concurrently,
 * standing in for the pessimistic row lock `GameService.submitGuess` takes in
 * production (issue #27): two "concurrent" calls in a test still run one at a
 * time, in the order they were issued.
 */
function createMockSessionsRepo() {
  const rows = new Map<string, { id: string; [key: string]: unknown }>();
  let seq = 0;

  const findOne = async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null;
  const save = async (session: { id?: string }) => {
    if (!session.id) session.id = `session-${(seq += 1)}`;
    rows.set(session.id, session as never);
    return session;
  };
  const update = async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
    let affected = 0;
    for (const row of rows.values()) {
      if (Object.entries(where).every(([key, value]) => row[key] === value)) {
        Object.assign(row, patch);
        affected += 1;
      }
    }
    return { affected };
  };

  let queue: Promise<unknown> = Promise.resolve();
  const manager = {
    findOne: jest.fn((_entity: unknown, opts: { where: { id: string } }) => findOne(opts)),
    save: jest.fn((_entity: unknown, session: { id?: string }) => save(session)),
    update: jest.fn(
      (_entity: unknown, where: Record<string, unknown>, patch: Record<string, unknown>) =>
        update(where, patch),
    ),
    transaction: jest.fn((cb: (manager: unknown) => Promise<unknown>): Promise<unknown> => {
      const run: Promise<unknown> = queue.then(() => cb(manager));
      queue = run.catch(() => undefined);
      return run;
    }),
  };

  return {
    create: jest.fn((input: Record<string, unknown>) => ({ ...input })),
    save: jest.fn(save),
    find: jest.fn(async () => []),
    findOne: jest.fn(findOne),
    update: jest.fn(update),
    manager,
  };
}

/** An in-memory stand-in for the TypeORM repository, so this needs no Postgres. */
function setup(roundsPerSession: number, requestId?: string) {
function setup(roundsPerSession: number, roundSeconds = 20) {
  const repo = createMockSessionsRepo();
  const lyrics = {
    getRandom: jest.fn(async () => LYRIC),
    findById: jest.fn(async () => LYRIC),
    count: jest.fn(async () => 100),
  };
  const users = { awardXp: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'roundsPerSession') return roundsPerSession;
      if (key === 'roundSeconds') return roundSeconds;
      return undefined;
    }),
  };

  const service = new GameService(
    repo as never,
    lyrics as never,
    users as never,
    events as never,
    config as never,
    { requestId } as never,
  );
  return { service, repo, lyrics, users, events, config };
}

describe('GameService session length', () => {
  it('takes the session length from configuration, not a hardcoded constant', async () => {
    const { service, config } = setup(7);

    const session = await service.createSession('host', GameMode.SOLO);

    expect(session.totalRounds).toBe(7);
    expect(config.get).toHaveBeenCalledWith('roundsPerSession', { infer: true });
  });

  it('exposes totalRounds on the session it returns', async () => {
    const { service } = setup(10);

    const session = await service.createSession('host', GameMode.SOLO);

    expect(session.totalRounds).toBe(10);
    expect(await service.getSession(session.id)).toBe(session);
  });

  it('finishes a session configured for five rounds after exactly five guesses', async () => {
    const { service, events } = setup(10);

    const session = await service.createSession('host', GameMode.SOLO, { rounds: 5 });
    expect(session.totalRounds).toBe(5);

    for (let guess = 1; guess <= 4; guess += 1) {
      const result = await service.submitGuess(session.id, 'host', 'definitely not the answer');
      expect(result.sessionStatus).toBe(GameSessionStatus.ACTIVE);
      expect(result.nextLyric).not.toBeNull();
      expect(result.totalRounds).toBe(5);
    }

    const last = await service.submitGuess(session.id, 'host', 'definitely not the answer');
    expect(last.sessionStatus).toBe(GameSessionStatus.FINISHED);
    expect(last.nextLyric).toBeNull();
    expect(last.totalRounds).toBe(5);

    expect(events.emit).toHaveBeenCalledWith(
      'game.session.finished',
      expect.objectContaining({ sessionId: session.id }),
    );
  });

  it('keeps the configured default when a caller passes no override', async () => {
    const { service } = setup(3);

    const session = await service.createSession('host', GameMode.SOLO, { waitForStakes: true });
    expect(session.totalRounds).toBe(3);

    // A three-round session ends on the third guess, not the tenth.
    await service.activate(session.id);
    await service.submitGuess(session.id, 'host', 'wrong');
    await service.submitGuess(session.id, 'host', 'wrong');
    const third = await service.submitGuess(session.id, 'host', 'wrong');
    expect(third.sessionStatus).toBe(GameSessionStatus.FINISHED);
  });

  it('lists only finished sessions the player played, newest first', async () => {
    const { service, repo } = setup(10);
    await service.historyForUser('host');

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.anything(),
          playerIds: expect.anything(),
        }),
        order: { createdAt: 'DESC' },
        take: 50,
      }),
    );
  });

  it('refuses a per-session round count that is not a positive integer', async () => {
    const { service } = setup(10);

    for (const rounds of [0, -1, 2.5]) {
      await expect(service.createSession('host', GameMode.SOLO, { rounds })).rejects.toThrow(
        /positive integer/,
      );
    }
  });

  it('refuses a session with more rounds than the lyric pool can supply (issue #37)', async () => {
    const { service, lyrics } = setup(10);
    lyrics.count.mockResolvedValueOnce(3);

    await expect(service.createSession('host', GameMode.SOLO, { rounds: 5 })).rejects.toThrow(
      /not enough lyrics/i,
    );
  });

  it('finishes early when the lyric pool runs dry mid-game (issue #37)', async () => {
    const { service, lyrics, events } = setup(10);
    // Only two lyrics exist, but the session is configured for five rounds.
    lyrics.count.mockResolvedValueOnce(5);
    let served = 0;
    lyrics.getRandom.mockImplementation(async () => {
      served += 1;
      if (served > 2) {
        const { NotFoundException } = await import('@nestjs/common');
        throw new NotFoundException('No lyrics available');
      }
      return { ...LYRIC, id: `lyric-${served}` };
    });

    const session = await service.createSession('host', GameMode.SOLO, { rounds: 5 });

    const first = await service.submitGuess(session.id, 'host', 'wrong');
    expect(first.sessionStatus).toBe(GameSessionStatus.ACTIVE);

    const second = await service.submitGuess(session.id, 'host', 'wrong');
    expect(second.sessionStatus).toBe(GameSessionStatus.ACTIVE);

    // Third round has no unseen lyric left: finish cleanly instead of throwing.
    const third = await service.submitGuess(session.id, 'host', 'wrong');
    expect(third.sessionStatus).toBe(GameSessionStatus.FINISHED);
    expect(third.nextLyric).toBeNull();

    expect(events.emit).toHaveBeenCalledWith(
      'game.session.finished',
      expect.objectContaining({ sessionId: session.id }),
    );
  });
});

describe('GameService restart persistence (issue #2)', () => {
  it('keeps per-player streak across a service restart', async () => {
    // One shared repo, two service instances: instance B simulates a process
    // restart that kept the database.
    const repo = createMockSessionsRepo();
    const lyrics = {
      getRandom: jest.fn(async () => LYRIC),
      findById: jest.fn(async () => LYRIC),
      count: jest.fn(async () => 100),
    };
    const users = { awardXp: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'roundsPerSession') return 10;
        if (key === 'roundSeconds') return 20;
        return undefined;
      }),
    };

    const serviceA = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );
    const serviceB = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );

    const session = await serviceA.createSession('host', GameMode.SOLO);
    const first = await serviceA.submitGuess(session.id, 'host', 'Thrift Shop');
    expect(first.outcome).toBe('correct');
    expect(first.streak).toBe(1);

    // "Restart": instance B reads the session from the shared store.
    const second = await serviceB.submitGuess(session.id, 'host', 'Thrift Shop');
    expect(second.outcome).toBe('correct');
    expect(second.streak).toBe(2);

    const third = await serviceB.submitGuess(session.id, 'host', 'wrong');
    expect(third.streak).toBe(0);
  });

  it('does not re-show a lyric the session already saw, across a restart', async () => {
    const repo = createMockSessionsRepo();
    let n = 0;
    const lyrics = {
      getRandom: jest.fn(async (exclude: string[] = []) => {
        n += 1;
        const id = `lyric-${n}`;
        // Refuse to return an excluded id, so a bug surfaces as a throw.
        if (exclude.includes(id)) throw new Error(`re-showed ${id}`);
        return { ...LYRIC, id };
      }),
      findById: jest.fn(async () => LYRIC),
      count: jest.fn(async () => 100),
    };
    const users = { awardXp: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'roundsPerSession') return 5;
        if (key === 'roundSeconds') return 20;
        return undefined;
      }),
    };

    const serviceA = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );
    const serviceB = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );

    const session = await serviceA.createSession('host', GameMode.SOLO, { rounds: 4 });
    const seenAfterA = new Set<string>([session.currentLyricId!]);

    // Two guesses on A, then a restart and two more on B.
    await serviceA.submitGuess(session.id, 'host', 'wrong');
    await serviceA.submitGuess(session.id, 'host', 'wrong');
    const afterA = await serviceA.getSession(session.id);
    for (const id of afterA.seenLyricIds) seenAfterA.add(id);

    await serviceB.submitGuess(session.id, 'host', 'wrong');
    await serviceB.submitGuess(session.id, 'host', 'wrong');
    const afterB = await serviceB.getSession(session.id);

    // Every lyric the session saw is unique: no repeats across the restart.
    expect(new Set(afterB.seenLyricIds).size).toBe(afterB.seenLyricIds.length);
    expect(afterB.seenLyricIds.length).toBeGreaterThanOrEqual(seenAfterA.size);
  });
});

describe('GameService submitGuess concurrency (issues #27, #28)', () => {
  it('threads the request id into both asynchronous domain events', async () => {
    const { service, events } = setup(1, 'request-123');
    const session = await service.createSession('host', GameMode.SOLO, { rounds: 1 });

    await service.submitGuess(session.id, 'host', 'Thrift Shop');

    expect(events.emit).toHaveBeenCalledWith(
      'game.session.finished',
      expect.objectContaining({ requestId: 'request-123' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'guess.submitted',
      expect.objectContaining({ requestId: 'request-123' }),
    );
  });

  it('sums every awarded point exactly once under 20 concurrent guesses', async () => {
    const { service, repo, events } = setup(20);
    const session = await service.createSession('host', GameMode.SOLO, { rounds: 20 });
describe('GameService round deadline', () => {
  /**
   * Returns a fake clock. `tick(ms)` advances the virtual time and nothing
   * more — no real timers fire. Use `service.now = clock.now` to wire it in.
   */
  function makeClock(start = 1_000_000) {
    let t = start;
    return {
      now: () => t,
      tick: (ms: number) => { t += ms; },
    };
  }

  it('roundEndsAt on a fresh lyric equals roundStartedAt + roundSeconds * 1000', async () => {
    const clock = makeClock();
    const { service } = setup(5, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);
    const lyric = await service.getCurrentLyric(session.id);

    expect(lyric.roundEndsAt).toBe(clock.now() + 20_000);
  });

  it('a guess before the deadline scores normally', async () => {
    const clock = makeClock();
    const { service } = setup(5, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);

    // 1 second in — well inside the 20-second window.
    clock.tick(1_000);
    const result = await service.submitGuess(session.id, 'host', 'Thrift Shop');

    expect(result.outcome).toBe('correct');
    expect(result.pointsAwarded).toBeGreaterThan(0);
  });

  it('a guess after the deadline scores 0 and counts as a miss', async () => {
    const clock = makeClock();
    const { service } = setup(5, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);

    // 21 seconds later — deadline was at 20 s.
    clock.tick(21_000);
    const result = await service.submitGuess(session.id, 'host', 'Thrift Shop');

    expect(result.outcome).toBe('miss');
    expect(result.pointsAwarded).toBe(0);
  });

  it('a late guess still advances the round', async () => {
    const clock = makeClock();
    const { service } = setup(5, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO, { rounds: 2 });

    clock.tick(21_000);
    const r1 = await service.submitGuess(session.id, 'host', 'Thrift Shop');
    expect(r1.sessionStatus).toBe(GameSessionStatus.ACTIVE);
    expect(r1.nextLyric).not.toBeNull();

    // The new round resets the clock (roundStartedAt is "now"), so the next
    // guess within 20 s scores normally.
    clock.tick(1_000);
    const r2 = await service.submitGuess(session.id, 'host', 'Thrift Shop');
    expect(r2.sessionStatus).toBe(GameSessionStatus.FINISHED);
    expect(r2.outcome).toBe('correct');
  });

  it('nextLyric carries a fresh roundEndsAt after each round advance', async () => {
    const clock = makeClock(0);
    const { service } = setup(5, 30);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO, { rounds: 3 });

    clock.tick(5_000);
    const r1 = await service.submitGuess(session.id, 'host', 'wrong');
    // The next round started at t=5000, so its deadline is at t=35000.
    expect(r1.nextLyric!.roundEndsAt).toBe(5_000 + 30_000);

    clock.tick(10_000); // t=15000, still within round 2
    const r2 = await service.submitGuess(session.id, 'host', 'wrong');
    expect(r2.nextLyric!.roundEndsAt).toBe(15_000 + 30_000);
  });

  it('closeExpiredRound is a no-op before the deadline', async () => {
    const clock = makeClock();
    const { service } = setup(3, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);

    clock.tick(10_000); // 10 s — still inside the 20-second window
    const advanced = await service.closeExpiredRound(session.id);

    expect(advanced).toBe(false);
    const reloaded = await service.getSession(session.id);
    expect(reloaded.currentRound).toBe(1);
  });

    const awardedTotal = results.reduce((sum, result) => sum + result.pointsAwarded, 0);
    const finishEmissions = events.emit.mock.calls.filter(
      ([eventName]) => eventName === 'game.session.finished',
    );
    expect(finishEmissions).toHaveLength(1);
    expect(repo.manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      { where: { id: session.id }, lock: { mode: 'pessimistic_write' } },
    );
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: session.id } });

    const finalSession = await service.getSession(session.id);
    expect(finalSession.scores.host).toBe(awardedTotal);
    expect(finalSession.status).toBe(GameSessionStatus.FINISHED);
    expect(finishEmissions[0][1].scores).toEqual(finalSession.scores);
  it('closeExpiredRound advances the round after the deadline passes', async () => {
    const clock = makeClock();
    const { service, events } = setup(3, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);

    clock.tick(21_000);
    const advanced = await service.closeExpiredRound(session.id);

    expect(advanced).toBe(true);
    const reloaded = await service.getSession(session.id);
    expect(reloaded.currentRound).toBe(2);
    // No game.session.finished yet — only round 1 of 3 closed.
    expect(events.emit).not.toHaveBeenCalledWith('game.session.finished', expect.anything());
  });

  it('closeExpiredRound finishes the session on the last expired round', async () => {
    const clock = makeClock();
    const { service, events } = setup(3, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO, { rounds: 1 });

    clock.tick(21_000);
    const advanced = await service.closeExpiredRound(session.id);

    expect(advanced).toBe(true);
    const reloaded = await service.getSession(session.id);
    expect(reloaded.status).toBe(GameSessionStatus.FINISHED);
    expect(events.emit).toHaveBeenCalledWith(
      'game.session.finished',
      expect.objectContaining({ sessionId: session.id }),
    );
  });

  it('closeExpiredRound is idempotent — calling twice does not double-advance', async () => {
    const clock = makeClock();
    const { service } = setup(3, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO);

    clock.tick(21_000);
    await service.closeExpiredRound(session.id);
    const secondCall = await service.closeExpiredRound(session.id);

    // After the first call the new round hasn't expired yet, so the second
    // call must be a no-op.
    expect(secondCall).toBe(false);
    const reloaded = await service.getSession(session.id);
    expect(reloaded.currentRound).toBe(2);
  });

  it('a per-session roundSeconds override is respected', async () => {
    const clock = makeClock();
    // Config default is 20 s; session overrides to 10 s.
    const { service } = setup(5, 20);
    service.now = clock.now;

    const session = await service.createSession('host', GameMode.SOLO, { roundSeconds: 10 });

    clock.tick(11_000); // 11 s — expired under the 10-s override, not the 20-s default
    const result = await service.submitGuess(session.id, 'host', 'Thrift Shop');

    expect(result.outcome).toBe('miss');
    expect(result.pointsAwarded).toBe(0);
  });
});

describe('GameService.requireParticipant (issue #29)', () => {
  it('returns the session for an authorized player', async () => {
    const { service } = setup(5);
    const session = await service.createSession('player1', GameMode.SOLO);
    const result = await service.requireParticipant(session.id, 'player1');
    expect(result.id).toBe(session.id);
  });

  it('throws ForbiddenException when user is not a participant', async () => {
    const { service } = setup(5);
    const session = await service.createSession('player1', GameMode.SOLO);
    await expect(service.requireParticipant(session.id, 'intruder')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
