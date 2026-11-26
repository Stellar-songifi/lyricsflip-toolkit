import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { PvpSettlementOptions, WagerStatus, toStroops } from '../src';
import { Harness, createHarness } from './harness';
import {
  Deployment,
  LOCAL,
  createAccount,
  deploy,
  fund,
  giveTokens,
  sendXlm,
  tokenBalance,
  xlmBalance,
} from './local-network';

/**
 * Settlement hardening against a local network (#58, #59, #60). Start one with
 * `docker run --rm -p 8000:8000 stellar/quickstart --local --enable core,rpc`.
 */
const STAKE = toStroops('10');
const TIMEOUT_LEDGERS = 120;

describe('settlement hardening (local network)', () => {
  let d: Deployment;

  beforeAll(async () => {
    d = await deploy();
  }, 120_000);

  function stellarOptions(extra: Partial<NonNullable<PvpSettlementOptions['stellar']>> = {}): Partial<PvpSettlementOptions> {
    return {
      mode: 'stellar',
      potTimeoutLedgers: TIMEOUT_LEDGERS,
      stellar: {
        network: 'local',
        rpcUrl: LOCAL.rpcUrl,
        networkPassphrase: LOCAL.networkPassphrase,
        escrowContractId: d.escrowContractId,
        tokenContractId: d.tokenContractId,
        resolverSecret: d.resolver.secret(),
        ...extra,
      },
    };
  }

  async function players(h: Harness) {
    const alice = { id: `alice-${randomUUID()}`, key: Keypair.random() };
    const bob = { id: `bob-${randomUUID()}`, key: Keypair.random() };
    await fund(alice.key, bob.key);
    await giveTokens(d, [alice.key, bob.key], '100');
    await h.links.link(alice.id, alice.key.publicKey());
    await h.links.link(bob.id, bob.key.publicKey());
    return { alice, bob };
  }

  async function stakeFromWallet(h: Harness, wagerId: string, player: { id: string; key: Keypair }) {
    const unsigned = await h.wagers.buildStakeTransaction(wagerId, player.id);
    const tx = TransactionBuilder.fromXDR(unsigned!.transactionXdr, unsigned!.networkPassphrase);
    tx.sign(player.key);
    return h.wagers.submitStake(wagerId, player.id, tx.toXDR());
  }

  describe('#58 boot-time contract check', () => {
    it('refuses to boot against a contract whose resolver is a different key', async () => {
      await expect(
        createHarness(stellarOptions({ resolverSecret: Keypair.random().secret() }), { scripted: false }),
      ).rejects.toThrow(/its resolver is G[A-Z2-7]{55}, but this server signs as/);
    }, 60_000);

    it('refuses to boot when tokenContractId is not the contract token', async () => {
      await expect(
        createHarness(stellarOptions({ tokenContractId: d.escrowContractId }), { scripted: false }),
      ).rejects.toThrow(/its token is .*, but tokenContractId is/);
    }, 60_000);
  });

  describe('#59 concurrent resolver transactions', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness(stellarOptions(), { scripted: false });
    }, 60_000);
    afterAll(() => h.close());

    it('settles 20 wagers at once with no txBAD_SEQ failures', async () => {
      // Fund players one pair at a time: friendbot itself can't take 40 at once.
      const pairs = [];
      for (let i = 0; i < 20; i++) pairs.push(await players(h));

      const staked = await Promise.all(
        pairs.map(async ({ alice, bob }) => {
          const wager = await h.wagers.create({
            matchId: randomUUID(),
            playerAId: alice.id,
            playerBId: bob.id,
            stakeAmount: STAKE,
          });
          // 20 concurrent open_pot calls from the resolver.
          await h.wagers.accept(wager.id, bob.id);
          await stakeFromWallet(h, wager.id, alice);
          const after = await stakeFromWallet(h, wager.id, bob);
          expect(after.status).toBe(WagerStatus.STAKED);
          return { wager, alice };
        }),
      );

      // 20 concurrent resolve calls from the resolver.
      const settled = await Promise.all(staked.map(({ wager, alice }) => h.wagers.settle(wager.id, { winnerId: alice.id })));

      expect(settled.map((w) => w.status)).toEqual(Array(20).fill(WagerStatus.WON));
      expect(settled.every((w) => w.reconcileAttempts === 0)).toBe(true);
    }, 600_000);
  });

  describe('#60 sponsored stake fees', () => {
    let h: Harness;
    const sponsor = Keypair.random();
    beforeAll(async () => {
      await fund(sponsor);
      h = await createHarness(stellarOptions({ feeSponsorSecret: sponsor.secret() }), { scripted: false });
    }, 60_000);
    afterAll(() => h.close());

    it('stakes from an account that holds the stake token but no spare XLM', async () => {
      const rich = { id: `rich-${randomUUID()}`, key: Keypair.random() };
      const broke = { id: `broke-${randomUUID()}`, key: Keypair.random() };
      await fund(rich.key);
      // 2 XLM covers the account and trustline reserves (1.5 XLM) plus the
      // trustline fee; then everything above the reserve is sent away.
      await createAccount(d.server, rich.key, broke.key, '2');
      await giveTokens(d, [rich.key, broke.key], '100');
      const minimum = 15_000_000n; // (2 base + 1 trustline) × 0.5 XLM
      // The payment's fee is charged at the 100-stroop base rate.
      const spare = (await xlmBalance(d.server, broke.key.publicKey())) - minimum - 100n;
      await sendXlm(d.server, broke.key, rich.key.publicKey(), (Number(spare) / 1e7).toFixed(7));
      const xlmBefore = await xlmBalance(d.server, broke.key.publicKey());
      expect(xlmBefore).toBeLessThanOrEqual(minimum);

      await h.links.link(rich.id, rich.key.publicKey());
      await h.links.link(broke.id, broke.key.publicKey());
      const wager = await h.wagers.create({
        matchId: randomUUID(),
        playerAId: rich.id,
        playerBId: broke.id,
        stakeAmount: STAKE,
      });
      await h.wagers.accept(wager.id, broke.id);
      const sponsorBefore = await xlmBalance(d.server, sponsor.publicKey());

      await stakeFromWallet(h, wager.id, rich);
      const staked = await stakeFromWallet(h, wager.id, broke);

      expect(staked.status).toBe(WagerStatus.STAKED);
      expect(await tokenBalance(d, broke.key.publicKey())).toBe(100n * 10_000_000n - BigInt(STAKE));
      // The player paid no fee; the sponsor did.
      expect(await xlmBalance(d.server, broke.key.publicKey())).toBe(xlmBefore);
      expect(await xlmBalance(d.server, sponsor.publicKey())).toBeLessThan(sponsorBefore);
    }, 180_000);
  });
});
