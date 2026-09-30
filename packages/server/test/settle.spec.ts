import { randomUUID } from 'crypto';
import { SettlementKind, WagerStatus } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

describe('settlement', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ reconcile: { enabled: false, maxAttempts: 3 } });
  });
  afterAll(() => h.close());
  beforeEach(() => h.gateway.reset());

  async function stakedWager() {
    const players = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: players.alice.id,
      playerBId: players.bob.id,
      stakeAmount: STAKE,
    });
    await h.wagers.accept(wager.id, players.bob.id);
    await h.wagers.submitStake(wager.id, players.alice.id, null);
    await h.wagers.submitStake(wager.id, players.bob.id, null);
    return { ...players, wager };
  }

  it('pays the winner', async () => {
    const { wager, bob } = await stakedWager();

    const settled = await h.wagers.settle(wager.id, { winnerId: bob.id });

    expect(settled.status).toBe(WagerStatus.WON);
    expect(settled.winnerId).toBe(bob.id);
    expect(settled.settlementTxHash).toMatch(/^mock:/);
    expect((await h.gateway.getPot(wager.id))?.status).toBe('resolved');
  });

  it('refunds a draw', async () => {
    const { wager } = await stakedWager();

    const settled = await h.wagers.settle(wager.id, { draw: true });

    expect(settled.status).toBe(WagerStatus.REFUNDED);
    expect(settled.winnerId).toBeNull();
    expect((await h.gateway.getPot(wager.id))?.status).toBe('refunded');
  });

  it('settles by match id', async () => {
    const { wager, alice } = await stakedWager();
    const settled = await h.wagers.settleMatch(wager.matchId, { winnerId: alice.id });
    expect(settled?.status).toBe(WagerStatus.WON);
    expect(await h.wagers.settleMatch('no-such-match', { draw: true })).toBeNull();
  });

  it('refuses a winner who is not in the match', async () => {
    const { wager } = await stakedWager();
    await expect(h.wagers.settle(wager.id, { winnerId: 'mallory' })).rejects.toThrow(/one of the two players/);
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.STAKED);
  });

  it('refuses to settle before both stakes are in', async () => {
    const players = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: players.alice.id,
      playerBId: players.bob.id,
      stakeAmount: STAKE,
    });
    await h.wagers.accept(wager.id, players.bob.id);
    await h.wagers.submitStake(wager.id, players.alice.id, null);

    await expect(h.wagers.settle(wager.id, { winnerId: players.alice.id })).rejects.toThrow(
      /Only a staked wager/,
    );
  });

  it('is idempotent for the same result and refuses a different one', async () => {
    const { wager, alice, bob } = await stakedWager();
    await h.wagers.settle(wager.id, { winnerId: alice.id });
    h.gateway.calls.length = 0;

    expect((await h.wagers.settle(wager.id, { winnerId: alice.id })).status).toBe(WagerStatus.WON);
    expect(h.gateway.calls).toEqual([]);
    await expect(h.wagers.settle(wager.id, { winnerId: bob.id })).rejects.toThrow(/settled differently/);
    await expect(h.wagers.settle(wager.id, { draw: true })).rejects.toThrow(/settled differently/);
  });

  it('pays out once when two settle calls race', async () => {
    const { wager, alice } = await stakedWager();
    h.gateway.calls.length = 0;

    await Promise.all([
      h.wagers.settle(wager.id, { winnerId: alice.id }),
      h.wagers.settle(wager.id, { winnerId: alice.id }),
    ]);

    expect(h.gateway.calls.filter((c) => c === 'resolve')).toHaveLength(1);
    expect(h.events.filter((e) => e.type === 'wager.won' && e.wager.id === wager.id)).toHaveLength(1);
  });

  it('records the payout intent before submitting it', async () => {
    const { wager, bob } = await stakedWager();
    h.gateway.inject('resolve', 'drop');

    const settling = await h.wagers.settle(wager.id, { winnerId: bob.id });

    expect(settling.status).toBe(WagerStatus.SETTLING);
    expect(settling.settlementKind).toBe(SettlementKind.PAYOUT);
    expect(settling.winnerId).toBe(bob.id);
  });

  describe('reconciling an interrupted settlement', () => {
    it('marks an interrupted payout that landed as won, never refunded', async () => {
      const { wager, bob } = await stakedWager();
      h.gateway.inject('resolve', 'lose');

      const settling = await h.wagers.settle(wager.id, { winnerId: bob.id });
      // `lose` still resolves the pot; the mock is immediate, so settle's
      // own pot check already sees it.
      expect([WagerStatus.SETTLING, WagerStatus.WON]).toContain(settling.status);

      const reconciled = await h.wagers.reconcile(wager.id);
      expect(reconciled.status).toBe(WagerStatus.WON);
      expect(reconciled.winnerId).toBe(bob.id);
    });

    it('retries a payout that never landed and then marks it won', async () => {
      const { wager, alice } = await stakedWager();
      h.gateway.inject('resolve', 'drop');
      expect((await h.wagers.settle(wager.id, { winnerId: alice.id })).status).toBe(WagerStatus.SETTLING);
      expect((await h.gateway.getPot(wager.id))?.status).toBe('staked');

      const reconciled = await h.wagers.reconcile(wager.id);

      expect(reconciled.status).toBe(WagerStatus.WON);
      expect(reconciled.winnerId).toBe(alice.id);
      expect((await h.gateway.getPot(wager.id))?.status).toBe('resolved');
    });

    it('marks an interrupted refund as refunded', async () => {
      const { wager } = await stakedWager();
      h.gateway.inject('refund', 'drop');
      expect((await h.wagers.settle(wager.id, { draw: true })).status).toBe(WagerStatus.SETTLING);

      expect((await h.wagers.reconcile(wager.id)).status).toBe(WagerStatus.REFUNDED);
    });

    it('marks a payout refunded only when the pot really was refunded', async () => {
      const { wager, alice } = await stakedWager();
      h.gateway.inject('resolve', 'drop');
      await h.wagers.settle(wager.id, { winnerId: alice.id });
      // The players reclaim their stakes on-chain (simulated with a refund).
      await h.gateway.inner.refund(wager.id);

      const reconciled = await h.wagers.reconcile(wager.id);

      expect(reconciled.status).toBe(WagerStatus.REFUNDED);
    });

    it('fails a refund intent whose pot was paid out, instead of calling it refunded', async () => {
      const { wager, alice } = await stakedWager();
      h.gateway.inject('refund', 'drop');
      await h.wagers.settle(wager.id, { draw: true });
      await h.gateway.inner.resolve(wager.id, alice.address);

      const reconciled = await h.wagers.reconcile(wager.id);

      expect(reconciled.status).toBe(WagerStatus.FAILED);
      expect(reconciled.failureReason).toMatch(/refund was intended/);
    });

    it('gives up after the maximum attempts and asks for an operator', async () => {
      const { wager, alice } = await stakedWager();
      h.gateway.inject('resolve', 'drop', 'drop', 'drop', 'drop', 'drop');
      await h.wagers.settle(wager.id, { winnerId: alice.id });

      let current = await h.wagers.findById(wager.id);
      for (let i = 0; i < 5 && current.status === WagerStatus.SETTLING; i++) {
        current = await h.wagers.reconcile(wager.id);
      }

      expect(current.status).toBe(WagerStatus.FAILED);
      expect(current.failureReason).toMatch(/did not land/);
      expect((await h.gateway.getPot(wager.id))?.status).toBe('staked');
    });

    it('leaves a failed submission for the next sweep instead of retrying in a loop', async () => {
      const { wager, bob } = await stakedWager();
      h.gateway.inject('resolve', 'fail');

      const settling = await h.wagers.settle(wager.id, { winnerId: bob.id });

      expect(settling.status).toBe(WagerStatus.SETTLING);
      expect(settling.reconcileAttempts).toBe(1);
      expect((await h.wagers.reconcile(wager.id)).status).toBe(WagerStatus.WON);
    });
  });

  describe('aborting', () => {
    it('refunds the stakes that were made when a wager is aborted', async () => {
      const players = await twoLinkedPlayers(h);
      const wager = await h.wagers.create({
        matchId: randomUUID(),
        playerAId: players.alice.id,
        playerBId: players.bob.id,
        stakeAmount: STAKE,
      });
      await h.wagers.accept(wager.id, players.bob.id);
      await h.wagers.submitStake(wager.id, players.alice.id, null);

      const aborted = await h.wagers.abort(wager.id, 'match abandoned');

      expect(aborted.status).toBe(WagerStatus.REFUNDED);
      expect(aborted.settlementKind).toBe(SettlementKind.REFUND);
    });

    it('cancels a wager that was never accepted', async () => {
      const players = await twoLinkedPlayers(h);
      const wager = await h.wagers.create({
        matchId: randomUUID(),
        playerAId: players.alice.id,
        playerBId: players.bob.id,
        stakeAmount: STAKE,
      });
      expect((await h.wagers.abort(wager.id, 'host left')).status).toBe(WagerStatus.CANCELLED);
    });
  });
});
