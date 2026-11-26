import { UsersService } from './users.service';

/** The driver error PostgreSQL raises on a unique-constraint violation. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
}

describe('UsersService.findOrCreateByWallet (issue #100)', () => {
  it('reuses the existing user for a known wallet without inserting', async () => {
    const existing = { id: 'u1', walletAddress: 'GABC', username: 'player_gabc' };
    const repo = {
      findOne: jest.fn(async () => existing),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new UsersService(repo as never);

    await expect(service.findOrCreateByWallet('GABC')).resolves.toBe(existing);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('gives two wallets sharing a 6-char prefix distinct usernames', async () => {
    const saved: Array<{ username: string }> = [];
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((u: Record<string, unknown>) => ({ ...u })),
      save: jest.fn(async (u: { username: string }) => {
        // The short, collision-prone candidate is always taken.
        if (u.username === 'player_abcdef') throw uniqueViolation();
        saved.push(u);
        return u;
      }),
    };
    const service = new UsersService(repo as never);

    const a = await service.findOrCreateByWallet('ABCDEF1111');
    const b = await service.findOrCreateByWallet('ABCDEF2222');

    expect(a.username).not.toBe(b.username);
    expect(new Set(saved.map((s) => s.username)).size).toBe(2);
  });

  it('propagates a failure that is not a unique violation', async () => {
    const connectionLost = Object.assign(new Error('connection terminated'), { code: '08006' });
    const repo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((u: Record<string, unknown>) => ({ ...u })),
      save: jest.fn(async () => {
        throw connectionLost;
      }),
    };
    const service = new UsersService(repo as never);

    await expect(service.findOrCreateByWallet('GXYZ')).rejects.toBe(connectionLost);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });
});