import { randomUUID } from 'crypto';
import { SettlementKind, Wager, WagerStatus } from '../src';
import { Harness, STAKE, createHarness, twoLinkedPlayers } from './harness';

/** Postgres refuses rows that break the wager invariants (#66). */
describe('wager database constraints', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  async function newWager() {
    const { alice, bob } = await twoLinkedPlayers(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    return { wager, alice, bob };
  }

  const repo = () => h.dataSource.getRepository(Wager);

  it.each([
    ['a non-integer stake', { stakeAmount: '1.5' }, 'CHK_pvp_wagers_stake_amount'],
    ['a zero stake', { stakeAmount: '0' }, 'CHK_pvp_wagers_stake_amount'],
    ['a won wager that was not a payout', { status: WagerStatus.WON, settlementKind: SettlementKind.REFUND }, 'CHK_pvp_wagers_won'],
    ['a settling wager with no settlement kind', { status: WagerStatus.SETTLING }, 'CHK_pvp_wagers_settlement_kind'],
    ['a refund with a winner', { settlementKind: SettlementKind.REFUND, winnerId: 'x' }, 'CHK_pvp_wagers_winner_kind'],
    ['negative reconcile attempts', { reconcileAttempts: -1 }, 'CHK_pvp_wagers_reconcile_attempts'],
  ])('rejects %s', async (_label, patch, constraint) => {
    const { wager } = await newWager();
    await expect(repo().update({ id: wager.id }, patch as Partial<Wager>)).rejects.toThrow(constraint);
  });

  it('rejects a winner who is not one of the players, and a self-wager', async () => {
    const { wager, alice } = await newWager();
    await expect(
      repo().update({ id: wager.id }, { settlementKind: SettlementKind.PAYOUT, winnerId: 'mallory' }),
    ).rejects.toThrow('CHK_pvp_wagers_winner_player');
    await expect(repo().update({ id: wager.id }, { playerBId: alice.id })).rejects.toThrow(
      'CHK_pvp_wagers_distinct_players',
    );
  });

  it('accepts the rows the service writes', async () => {
    const { wager, bob } = await newWager();
    await repo().update(
      { id: wager.id },
      { status: WagerStatus.WON, settlementKind: SettlementKind.PAYOUT, winnerId: bob.id },
    );
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.WON);
  });
});
