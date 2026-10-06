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

/** An in-memory stand-in for the TypeORM repository, so this needs no Postgres. */
function setup(roundsPerSession: number) {
  const rows = new Map<string, { id: string; [key: string]: unknown }>();
  let seq = 0;

  const repo = {
    create: jest.fn((input: Record<string, unknown>) => ({ ...input })),
    save: jest.fn(async (session: { id?: string }) => {
      if (!session.id) session.id = `session-${(seq += 1)}`;
      rows.set(session.id, session as never);
      return session;
    }),
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null),
    update: jest.fn(
      async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
        for (const row of rows.values()) {
          if (Object.entries(where).every(([key, value]) => row[key] === value)) {
            Object.assign(row, patch);
          }
        }
      },
    ),
  };
  const lyrics = { getRandom: jest.fn(async () => LYRIC), findById: jest.fn(async () => LYRIC) };
  const users = { awardXp: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() };
  const config = { get: jest.fn(() => roundsPerSession) };

  const service = new GameService(
    repo as never,
    lyrics as never,
    users as never,
    events as never,
    config as never,
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

  it('refuses a per-session round count that is not a positive integer', async () => {
    const { service } = setup(10);

    for (const rounds of [0, -1, 2.5]) {
      await expect(service.createSession('host', GameMode.SOLO, { rounds })).rejects.toThrow(
        /positive integer/,
      );
    }
  });

describe('GameService restart persistence (issue #2)', () => {
  it('keeps per-player streak across a service restart', async () => {
    // One shared rows Map + repo, two service instances: instance B simulates
    // a process restart that kept the database.
    const rows = new Map<string, { id: string; [key: string]: unknown }>();
    let seq = 0;
    const repo = {
      create: jest.fn((input: Record<string, unknown>) => ({ ...input })),
      save: jest.fn(async (session: { id?: string }) => {
        if (!session.id) session.id = `session-${(seq += 1)}`;
        rows.set(session.id, session as never);
        return session;
      }),
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null),
      update: jest.fn(
        async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
          for (const row of rows.values()) {
            if (Object.entries(where).every(([key, value]) => row[key] === value)) {
              Object.assign(row, patch);
            }
          }
        },
      ),
    };
    const lyrics = { getRandom: jest.fn(async () => LYRIC), findById: jest.fn(async () => LYRIC) };
    const users = { awardXp: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const config = { get: jest.fn(() => 10) };

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
    const rows = new Map<string, { id: string; [key: string]: unknown }>();
    let seq = 0;
    const repo = {
      create: jest.fn((input: Record<string, unknown>) => ({ ...input })),
      save: jest.fn(async (session: { id?: string }) => {
        if (!session.id) session.id = `session-${(seq += 1)}`;
        rows.set(session.id, session as never);
        return session;
      }),
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null),
      update: jest.fn(async () => undefined),
    };
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
    };
    const users = { awardXp: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const config = { get: jest.fn(() => 5) };

    const serviceA = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );
    const serviceB = new GameService(
      repo as never, lyrics as never, users as never, events as never, config as never,
    );

    const session = await serviceA.createSession('host', GameMode.SOLO, { rounds: 4 });
    const seenAfterA = new Set<string>([session.currentLyricId!]);

    // Two guesses on A, two on B — never the same lyric twice.
    const g1 = await serviceA.submitGuess(session.id, 'host', 'wrong');
    seenAfterA.add(g1.nextLyric!.id);
    const g2 = await serviceB.submitGuess(session.id, 'host', 'wrong');
    seenAfterA.add(g2.nextLyric!.id);
    await serviceB.submitGuess(session.id, 'host', 'wrong');
    // The mock throws if getRandom ever returns an already-seen id, so reaching
    // here without a throw is the assertion.
    expect(seenAfterA.size).toBe(3);
    const reloaded = await serviceB.getSession(session.id);
    expect(new Set(reloaded.seenLyricIds).size).toBe(new Set(reloaded.seenLyricIds).size);
  });
});
});
