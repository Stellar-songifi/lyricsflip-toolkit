import { randomUUID } from 'crypto';
import { Wager, WagerReconcilerService, WagerStatus } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

describe('expiry and the background sweep', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      acceptWindowSeconds: 600,
      stakeWindowSeconds: 600,
      reconcile: { enabled: false, minAgeSeconds: 0 },
    });
  });
  afterAll(() => h.close());
  beforeEach(() => h.gateway.reset());

  const HOUR_AGO = () => new Date(Date.now() - 3_600_000);

  async function proposed() {
    const players = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: players.alice.id,
      playerBId: players.bob.id,
      stakeAmount: STAKE,
    });
    return { ...players, wager };
  }

  async function backdate(id: string, changes: Partial<Wager>) {
    await h.dataSource.getRepository(Wager).update({ id }, changes);
  }

  it('cancels an invitation that was not accepted in time', async () => {
    const { wager, bob } = await proposed();
    await backdate(wager.id, { createdAt: HOUR_AGO() });

    await expect(h.wagers.accept(wager.id, bob.id)).rejects.toThrow(/expired/);
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.CANCELLED);
    expect(await h.gateway.getPot(wager.id)).toBeNull();
  });

  it('refunds whatever was staked when the stake window passes', async () => {
    const { wager, alice, bob } = await proposed();
    await h.wagers.accept(wager.id, bob.id);
    await h.wagers.submitStake(wager.id, alice.id, null);
    await backdate(wager.id, { acceptedAt: HOUR_AGO() });

    const after = await h.wagers.reconcile(wager.id);

    expect(after.status).toBe(WagerStatus.REFUNDED);
    expect((await h.gateway.getPot(wager.id))?.status).toBe('refunded');
  });

  it('does not refund a wager that became staked in time', async () => {
    const { wager, alice, bob } = await proposed();
    await h.wagers.accept(wager.id, bob.id);
    await h.wagers.submitStake(wager.id, alice.id, null);
    await h.wagers.submitStake(wager.id, bob.id, null);
    await backdate(wager.id, { acceptedAt: HOUR_AGO() });

    expect((await h.wagers.reconcile(wager.id)).status).toBe(WagerStatus.STAKED);
  });

  it('sweeps expired invitations and stuck settlements in one pass', async () => {
    const expired = await proposed();
    await backdate(expired.wager.id, { createdAt: HOUR_AGO() });

    const stuck = await proposed();
    await h.wagers.accept(stuck.wager.id, stuck.bob.id);
    await h.wagers.submitStake(stuck.wager.id, stuck.alice.id, null);
    await h.wagers.submitStake(stuck.wager.id, stuck.bob.id, null);
    h.gateway.inject('resolve', 'drop');
    await h.wagers.settle(stuck.wager.id, { winnerId: stuck.alice.id });
    await backdate(stuck.wager.id, { updatedAt: HOUR_AGO() });
    await backdate(expired.wager.id, { updatedAt: HOUR_AGO() });

    await h.app.get(WagerReconcilerService).sweep();

    expect((await h.wagers.findById(expired.wager.id)).status).toBe(WagerStatus.CANCELLED);
    expect((await h.wagers.findById(stuck.wager.id)).status).toBe(WagerStatus.WON);
  });

  it('runs one sweep at a time', async () => {
    const reconciler = h.app.get(WagerReconcilerService);
    const first = reconciler.sweep();
    const second = reconciler.sweep();
    expect(second).toBe(first);
    await first;
  });
});
