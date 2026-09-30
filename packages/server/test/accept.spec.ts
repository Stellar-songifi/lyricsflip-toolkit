import { randomUUID } from 'crypto';
import { WagerStatus } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

describe('proposing and accepting a wager', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.gateway.reset());

  it('records a proposal without opening a pot or asking anyone to stake', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });

    expect(wager.status).toBe(WagerStatus.PENDING);
    expect(await h.gateway.getPot(wager.id)).toBeNull();
    await expect(h.wagers.buildStakeTransaction(wager.id, bob.id)).rejects.toThrow(/not taking stakes/);
    await expect(h.wagers.submitStake(wager.id, bob.id, null)).rejects.toThrow(/not taking stakes/);
    await expect(h.wagers.submitStake(wager.id, alice.id, null)).rejects.toThrow(/not taking stakes/);
  });

  it('opens the pot only when player two accepts', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });

    const accepted = await h.wagers.accept(wager.id, bob.id);

    expect(accepted.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.playerAAddress).toBe(alice.address);
    expect(accepted.playerBAddress).toBe(bob.address);
    const pot = await h.gateway.getPot(wager.id);
    expect(pot).toMatchObject({ playerA: alice.address, playerB: bob.address, stakeAmount: STAKE });
  });

  it('lets only player two accept', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });

    await expect(h.wagers.accept(wager.id, alice.id)).rejects.toThrow(/Only the invited player/);
    await expect(h.wagers.accept(wager.id, 'mallory')).rejects.toThrow(/Only the invited player/);
    expect(await h.gateway.getPot(wager.id)).toBeNull();
  });

  it('treats a repeated accept as a no-op', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    await h.wagers.accept(wager.id, bob.id);
    h.gateway.calls.length = 0;

    const again = await h.wagers.accept(wager.id, bob.id);

    expect(again.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(h.gateway.calls).toEqual([]);
  });

  it('opens only one pot when two accepts race', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    h.gateway.calls.length = 0;

    await Promise.all([h.wagers.accept(wager.id, bob.id), h.wagers.accept(wager.id, bob.id)]);

    expect(h.gateway.calls.filter((c) => c === 'openPot')).toHaveLength(1);
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.AWAITING_STAKES);
  });

  it('refuses to accept without a linked wallet', async () => {
    const { alice } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: 'no-wallet-player',
      stakeAmount: STAKE,
    });
    await expect(h.wagers.accept(wager.id, 'no-wallet-player')).rejects.toThrow(/linked, verified wallet/);
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.PENDING);
  });

  it('cancels on decline, after which it cannot be accepted', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    await expect(h.wagers.decline(wager.id, alice.id)).rejects.toThrow(/Only the invited player/);

    const declined = await h.wagers.decline(wager.id, bob.id);

    expect(declined.status).toBe(WagerStatus.CANCELLED);
    await expect(h.wagers.accept(wager.id, bob.id)).rejects.toThrow(/can't be accepted/);
  });

  it('lets either player cancel before acceptance but not after', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const first = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    expect((await h.wagers.cancel(first.id, alice.id)).status).toBe(WagerStatus.CANCELLED);

    const second = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    await h.wagers.accept(second.id, bob.id);
    await expect(h.wagers.cancel(second.id, alice.id)).rejects.toThrow(/can no longer be cancelled/);
  });

  it('validates proposals', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const base = { playerAId: alice.id, playerBId: bob.id, stakeAmount: STAKE };

    await expect(h.wagers.create({ ...base, matchId: randomUUID(), playerBId: alice.id })).rejects.toThrow(
      /against themselves/,
    );
    for (const stakeAmount of ['0', '-5', '1.5', 'ten']) {
      await expect(h.wagers.create({ ...base, matchId: randomUUID(), stakeAmount })).rejects.toThrow();
    }
    await expect(
      h.wagers.create({ ...base, matchId: randomUUID(), playerAId: 'no-wallet' }),
    ).rejects.toThrow(/Link and verify a wallet/);

    const matchId = randomUUID();
    await h.wagers.create({ ...base, matchId });
    await expect(h.wagers.create({ ...base, matchId })).rejects.toThrow(/already has a wager/);
  });

  it('opens the pot on reconcile when the open_pot outcome was lost', async () => {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    h.gateway.inject('openPot', 'drop');

    const accepted = await h.wagers.accept(wager.id, bob.id);
    expect(accepted.status).toBe(WagerStatus.PENDING);
    expect(accepted.acceptedAt).not.toBeNull();

    const reconciled = await h.wagers.reconcile(wager.id);
    expect(reconciled.status).toBe(WagerStatus.AWAITING_STAKES);
  });
});
