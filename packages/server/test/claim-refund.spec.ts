import { randomUUID } from 'crypto';
import { WagerStatus, setMockLedgerClock } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

/** Seconds per mock ledger (see mock-escrow.gateway.ts). */
const SECONDS_PER_LEDGER = 5;
const TIMEOUT_LEDGERS = 60;

describe('players reclaiming stakes from a timed-out pot (#63)', () => {
  let h: Harness;
  let now: number;

  beforeAll(async () => {
    h = await createHarness({ reconcile: { enabled: false, maxAttempts: 3 }, potTimeoutLedgers: TIMEOUT_LEDGERS });
  });
  afterAll(async () => {
    setMockLedgerClock();
    await h.close();
  });
  beforeEach(() => {
    h.gateway.reset();
    now = Date.now();
    setMockLedgerClock(() => now);
  });

  /** Moves the mock ledger past every pot opened so far. */
  function passDeadline() {
    now += (TIMEOUT_LEDGERS + 2) * SECONDS_PER_LEDGER * 1000;
  }

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

  describe('the mock gateway follows the contract rules', () => {
    it('refuses a claim before the deadline', async () => {
      const { wager, alice } = await stakedWager();
      const outcome = await h.gateway.inner.claimRefund(wager.id, alice.address);
      expect(outcome).toMatchObject({ status: 'failed', error: 'DeadlineNotReached' });
    });

    it('refuses a non-player and a second claim, and refunds once both claimed', async () => {
      const { wager, alice, bob } = await stakedWager();
      passDeadline();

      expect(await h.gateway.inner.claimRefund(wager.id, 'GSTRANGER')).toMatchObject({
        status: 'failed',
        error: 'NotAPlayerInPot',
      });
      expect((await h.gateway.inner.claimRefund(wager.id, alice.address)).status).toBe('confirmed');
      expect(await h.gateway.inner.claimRefund(wager.id, alice.address)).toMatchObject({
        status: 'failed',
        error: 'NothingToClaim',
      });

      let pot = await h.gateway.getPot(wager.id);
      expect(pot).toMatchObject({ status: 'staked', playerAStaked: false, playerBStaked: true });

      expect((await h.gateway.inner.claimRefund(wager.id, bob.address)).status).toBe('confirmed');
      pot = await h.gateway.getPot(wager.id);
      expect(pot).toMatchObject({ status: 'refunded', playerAStaked: false, playerBStaked: false });

      expect(await h.gateway.inner.claimRefund(wager.id, bob.address)).toMatchObject({
        status: 'failed',
        error: 'PotNotOpen',
      });
    });
  });

  describe('reconciling a payout after players reclaimed', () => {
    it('fails the wager when one player reclaimed before the payout', async () => {
      const { wager, alice, bob } = await stakedWager();
      passDeadline();
      await h.gateway.inner.claimRefund(wager.id, alice.address);

      const settled = await h.wagers.settle(wager.id, { winnerId: bob.id });

      expect(settled.status).toBe(WagerStatus.FAILED);
      expect(settled.failureReason).toBe(
        'A player reclaimed their stake after the pot timed out; the payout can no longer happen',
      );
      expect((await h.gateway.getPot(wager.id))?.status).toBe('staked');
    });

    it('marks the wager refunded when both players reclaimed before the payout', async () => {
      const { wager, alice, bob } = await stakedWager();
      passDeadline();
      await h.gateway.inner.claimRefund(wager.id, alice.address);
      await h.gateway.inner.claimRefund(wager.id, bob.address);

      const settled = await h.wagers.settle(wager.id, { winnerId: bob.id });

      expect(settled.status).toBe(WagerStatus.REFUNDED);
      expect((await h.gateway.getPot(wager.id))?.status).toBe('refunded');
    });
  });
});
