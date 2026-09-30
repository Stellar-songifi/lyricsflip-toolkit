import { randomUUID } from 'crypto';
import { WagerStatus } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

describe('staking', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => h.gateway.reset());

  async function acceptedWager() {
    const players = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: players.alice.id,
      playerBId: players.bob.id,
      stakeAmount: STAKE,
    });
    await h.wagers.accept(wager.id, players.bob.id);
    return { ...players, wager };
  }

  it('needs no signature in mock mode', async () => {
    const { wager, alice } = await acceptedWager();
    expect(await h.wagers.buildStakeTransaction(wager.id, alice.id)).toBeNull();
  });

  it('stays awaiting_stakes with only one stake confirmed', async () => {
    const { wager, alice } = await acceptedWager();

    const after = await h.wagers.submitStake(wager.id, alice.id, null);

    expect(after.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(after.playerAStakedAt).toBeInstanceOf(Date);
    expect(after.playerBStakedAt).toBeNull();
  });

  it('becomes staked only once both stakes are confirmed', async () => {
    const { wager, alice, bob } = await acceptedWager();
    await h.wagers.submitStake(wager.id, alice.id, null);

    const after = await h.wagers.submitStake(wager.id, bob.id, null);

    expect(after.status).toBe(WagerStatus.STAKED);
    expect((await h.gateway.getPot(wager.id))?.status).toBe('staked');
    expect(h.events.filter((e) => e.type === 'wager.staked' && e.wager.id === wager.id)).toHaveLength(1);
  });

  it('does not count a stake whose submission never landed', async () => {
    const { wager, alice, bob } = await acceptedWager();
    await h.wagers.submitStake(wager.id, alice.id, null);
    h.gateway.inject('submitStake', 'drop');

    const after = await h.wagers.submitStake(wager.id, bob.id, null);

    expect(after.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(after.playerBStakedAt).toBeNull();
    expect(after.playerBStakeTxHash).toMatch(/^dropped:/);
    expect((await h.wagers.reconcile(wager.id)).status).toBe(WagerStatus.AWAITING_STAKES);
  });

  it('counts a stake whose confirmation was lost once the pot shows it', async () => {
    const { wager, alice, bob } = await acceptedWager();
    await h.wagers.submitStake(wager.id, alice.id, null);
    h.gateway.inject('submitStake', 'lose');

    const after = await h.wagers.submitStake(wager.id, bob.id, null);

    // The pot already holds the stake, so it counts even without a receipt.
    expect(after.status).toBe(WagerStatus.STAKED);
  });

  it('rejects a stake the escrow refused', async () => {
    const { wager, alice } = await acceptedWager();
    h.gateway.inject('submitStake', 'fail');

    await expect(h.wagers.submitStake(wager.id, alice.id, null)).rejects.toThrow(/Stake was not accepted/);
    expect((await h.wagers.findById(wager.id)).playerAStakedAt).toBeNull();
  });

  it('refuses a second stake from the same player', async () => {
    const { wager, alice } = await acceptedWager();
    await h.wagers.submitStake(wager.id, alice.id, null);

    await expect(h.wagers.submitStake(wager.id, alice.id, null)).rejects.toThrow(/already staked/);
  });

  it('refuses stakes from outsiders', async () => {
    const { wager } = await acceptedWager();
    await expect(h.wagers.submitStake(wager.id, 'mallory', null)).rejects.toThrow(/not a player/);
    await expect(h.wagers.buildStakeTransaction(wager.id, 'mallory')).rejects.toThrow(/not a player/);
  });

  it('marks staked exactly once when both stakes race', async () => {
    const { wager, alice, bob } = await acceptedWager();

    await Promise.all([
      h.wagers.submitStake(wager.id, alice.id, null),
      h.wagers.submitStake(wager.id, bob.id, null),
    ]);

    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.STAKED);
    expect(h.events.filter((e) => e.type === 'wager.staked' && e.wager.id === wager.id)).toHaveLength(1);
  });
});
