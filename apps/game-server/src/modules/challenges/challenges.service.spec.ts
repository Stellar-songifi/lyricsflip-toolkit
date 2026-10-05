import { InternalServerErrorException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { ChallengesService } from './challenges.service';
import { Challenge, ChallengeStatus } from './entities/challenge.entity';

/** The driver error PostgreSQL raises when `UQ_challenges_code` is violated. */
function uniqueViolation(shape: 'driverError' | 'top-level' = 'driverError'): Error {
  const error = new Error('duplicate key value violates unique constraint "UQ_challenges_code"');
  return shape === 'driverError'
    ? Object.assign(error, { driverError: { code: '23505' } })
    : Object.assign(error, { code: '23505' });
}

function setup() {
  /** Rows the repository actually accepted — a rejected `save` lands in none. */
  const persisted: Array<Record<string, unknown>> = [];
  const repo = {
    create: jest.fn((input: Record<string, unknown>) => ({ ...input })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      persisted.push(row);
      return row;
    }),
    findOne: jest.fn(async () => null),
  };
  const users = {
    findByUsername: jest.fn(async () => null as { id: string; username: string } | null),
    findById: jest.fn(async () => ({ id: 'host', username: 'hostie' })),
  };
  const notifications = { push: jest.fn(async () => undefined) };

  const service = new ChallengesService(
    repo as never,
    {} as never, // gameService
    {} as never, // wagerService
    {} as never, // walletLinks — not reached without a stakeAmount
    users as never,
    notifications as never,
  );
  return { service, repo, users, notifications, persisted };
}

const codeOfCall = (call: unknown[] | undefined) => (call?.[0] as { code: string }).code;

describe('ChallengesService unique challenge codes', () => {
  it('retries once with a new code when the insert collides', async () => {
    const { service, repo, persisted } = setup();
    repo.save.mockRejectedValueOnce(uniqueViolation());

    const summary = await service.create('host');

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(persisted).toHaveLength(1);
    const [first, second] = repo.create.mock.calls.map(codeOfCall);
    expect(second).not.toBe(first);
    expect(summary.code).toBe(second);
  });

  it('fails as a 500, not a plain Error, when two inserts collide in a row', async () => {
    const { service, repo } = setup();
    repo.save.mockRejectedValue(uniqueViolation());

    const error = await service.create('host').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getStatus()).toBe(500);
    // One attempt plus exactly one retry — no unbounded looping.
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('neither retries nor swallows a failure that is not a collision', async () => {
    const { service, repo } = setup();
    const connectionLost = Object.assign(new Error('connection terminated'), { code: '08006' });
    repo.save.mockRejectedValue(connectionLost);

    await expect(service.create('host')).rejects.toBe(connectionLost);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('recognises the violation whether the code sits on the error or its driverError', async () => {
    const { service, repo } = setup();
    repo.save.mockRejectedValueOnce(uniqueViolation('top-level'));

    await expect(service.create('host')).resolves.toMatchObject({
      status: ChallengeStatus.PENDING,
    });
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('never probes for a free code, so no check can race the insert', async () => {
    const { service, repo } = setup();

    await service.create('host');

    // The old loop's `findOne`-then-`save` proved nothing: two requests could
    // both read a code as free. Uniqueness is the constraint's job now.
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('generates readable six-character codes with no look-alike characters', async () => {
    const { service, repo } = setup();

    for (let i = 0; i < 25; i += 1) {
      await service.create('host');
    }

    const codes = repo.create.mock.calls.map(codeOfCall);
    expect(codes).toHaveLength(25);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it('pushes the code that was actually persisted, after a retry', async () => {
    const { service, repo, users, notifications } = setup();
    users.findByUsername.mockResolvedValue({ id: 'friend', username: 'friend' });
    repo.save.mockRejectedValueOnce(uniqueViolation());

    await service.create('host', undefined, 'friend');

    const persistedCode = codeOfCall(repo.create.mock.calls[1]);
    expect(notifications.push).toHaveBeenCalledWith(
      'friend',
      'challenge.invite',
      expect.stringContaining(persistedCode),
      expect.objectContaining({
        code: persistedCode,
        url: `lyricsflip://challenge/${persistedCode}`,
      }),
    );
  });
});

describe('challenges schema', () => {
  it('keeps the unique index on code the insert retry depends on', () => {
    // Without this constraint a colliding insert succeeds as a duplicate code
    // instead of raising 23505, and the retry above never fires.
    const onCode = getMetadataArgsStorage().indices.find(
      (index) => index.target === Challenge && (index.columns as string[]).includes('code'),
    );

    expect(onCode).toBeDefined();
    expect(onCode?.unique).toBe(true);
  });
});
