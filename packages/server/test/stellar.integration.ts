import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import {
  ESCROW_GATEWAY,
  PvpSettlementOptions,
  SorobanRpc,
  StellarEscrowGateway,
  WagerStatus,
  toStroops,
} from '../src';
import { Harness, createHarness } from './harness';
import { Deployment, LOCAL, deploy, fund, giveTokens, latestLedger, tokenBalance } from './local-network';

/**
 * Real settlement against a local Stellar network. Start one with
 * `docker run --rm -p 8000:8000 stellar/quickstart --local --enable core,rpc`
 * and build the contract first. Run with `npm run test:integration`.
 */
const STAKE = toStroops('10');
const START = 100n * 10_000_000n;
const TIMEOUT_LEDGERS = 60;

describe('stellar settlement (local network)', () => {
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

  /** The wallet's side: fetch the unsigned stake, sign it, post it back. */
  async function stakeFromWallet(h: Harness, wagerId: string, player: { id: string; key: Keypair }) {
    const unsigned = await h.wagers.buildStakeTransaction(wagerId, player.id);
    expect(unsigned).not.toBeNull();
    const tx = TransactionBuilder.fromXDR(unsigned!.transactionXdr, unsigned!.networkPassphrase);
    tx.sign(player.key);
    return h.wagers.submitStake(wagerId, player.id, tx.toXDR());
  }

  async function stakedWager(h: Harness) {
    const { alice, bob } = await players(h);
    const wager = await h.wagers.create({
      matchId: randomUUID(),
      playerAId: alice.id,
      playerBId: bob.id,
      stakeAmount: STAKE,
    });
    const accepted = await h.wagers.accept(wager.id, bob.id);
    expect(accepted.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(accepted.potDeadlineLedger).toBeGreaterThan(0);
    const afterA = await stakeFromWallet(h, wager.id, alice);
    expect(afterA.status).toBe(WagerStatus.AWAITING_STAKES);
    const afterB = await stakeFromWallet(h, wager.id, bob);
    expect(afterB.status).toBe(WagerStatus.STAKED);
    return { wager, alice, bob };
  }

  describe('non-custodial', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness(stellarOptions(), { scripted: false });
    }, 60_000);
    afterAll(() => h.close());

    it('opens the pot on-chain only when player two accepts', async () => {
      const { alice, bob } = await players(h);
      const wager = await h.wagers.create({
        matchId: randomUUID(),
        playerAId: alice.id,
        playerBId: bob.id,
        stakeAmount: STAKE,
      });
      const gateway = h.app.get<StellarEscrowGateway>(ESCROW_GATEWAY);
      expect(await gateway.getPot(wager.id)).toBeNull();

      await h.wagers.accept(wager.id, bob.id);

      expect(await gateway.getPot(wager.id)).toMatchObject({
        playerA: alice.key.publicKey(),
        playerB: bob.key.publicKey(),
        stakeAmount: STAKE,
        status: 'open',
      });
    }, 120_000);

    it('moves real tokens: both stake, the server pays the winner', async () => {
      const { wager, alice, bob } = await stakedWager(h);
      expect(await tokenBalance(d, alice.key.publicKey())).toBe(START - BigInt(STAKE));
      expect(await tokenBalance(d, d.escrowContractId)).toBeGreaterThanOrEqual(2n * BigInt(STAKE));

      const settled = await h.wagers.settle(wager.id, { winnerId: bob.id });

      expect(settled.status).toBe(WagerStatus.WON);
      expect(settled.settlementTxHash).toMatch(/^[0-9a-f]{64}$/);
      expect(await tokenBalance(d, bob.key.publicKey())).toBe(START + BigInt(STAKE));
      expect(await tokenBalance(d, alice.key.publicKey())).toBe(START - BigInt(STAKE));
    }, 180_000);

    it('refunds both stakes on a draw', async () => {
      const { wager, alice, bob } = await stakedWager(h);

      expect((await h.wagers.settle(wager.id, { draw: true })).status).toBe(WagerStatus.REFUNDED);

      expect(await tokenBalance(d, alice.key.publicKey())).toBe(START);
      expect(await tokenBalance(d, bob.key.publicKey())).toBe(START);
    }, 180_000);

    it("rejects a signed envelope that isn't this wager's stake", async () => {
      const { alice, bob } = await players(h);
      const propose = () =>
        h.wagers.create({ matchId: randomUUID(), playerAId: alice.id, playerBId: bob.id, stakeAmount: STAKE });
      const [first, second] = [await propose(), await propose()];
      await h.wagers.accept(first.id, bob.id);
      await h.wagers.accept(second.id, bob.id);

      // Alice signs her stake for the second pot...
      const unsigned = await h.wagers.buildStakeTransaction(second.id, alice.id);
      const tx = TransactionBuilder.fromXDR(unsigned!.transactionXdr, unsigned!.networkPassphrase);
      tx.sign(alice.key);

      // ...and it can't be counted against the first pot, or as Bob's stake.
      await expect(h.wagers.submitStake(first.id, alice.id, tx.toXDR())).rejects.toThrow(
        /different pot or player/,
      );
      await expect(h.wagers.submitStake(second.id, bob.id, tx.toXDR())).rejects.toThrow(
        /different pot or player/,
      );
      expect((await h.wagers.findById(first.id)).playerAStakedAt).toBeNull();
    }, 180_000);

    it('lets players reclaim their stakes after the timeout if the server vanishes', async () => {
      const { wager, alice, bob } = await stakedWager(h);
      const gateway = h.app.get<StellarEscrowGateway>(ESCROW_GATEWAY);
      const deadline = (await gateway.getPot(wager.id))!.deadlineLedger;

      // The server never settles. Wait out the pot's timeout.
      while ((await latestLedger(d.server)) <= deadline) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Each player reclaims their own stake with no server involved.
      const rpc = new SorobanRpc({ rpcUrl: LOCAL.rpcUrl, networkPassphrase: LOCAL.networkPassphrase });
      for (const player of [alice, bob]) {
        const claim = await gateway.client.buildClaimRefund(wager.id, player.key.publicKey());
        const result = await rpc.signAndSubmit(claim, [player.key]);
        expect(result.status).toBe('confirmed');
        expect(await tokenBalance(d, player.key.publicKey())).toBe(START);
      }

      // When the server comes back and tries to pay out, the pot says a
      // refund really happened, so the wager ends refunded, not won.
      const after = await h.wagers.settle(wager.id, { winnerId: alice.id });
      expect(after.status).toBe(WagerStatus.REFUNDED);
    }, 240_000);
  });

  describe('custodial (test networks only)', () => {
    let h: Harness;
    const keys = new Map<string, Keypair>();
    beforeAll(async () => {
      h = await createHarness(
        stellarOptions({
          custodyMode: 'custodial',
          custodialPlayerSecret: (playerId) => keys.get(playerId)?.secret() ?? null,
        }),
        { scripted: false },
      );
    }, 60_000);
    afterAll(() => h.close());

    it('stakes with server-held keys, without a wallet signature', async () => {
      const { alice, bob } = await players(h);
      keys.set(alice.id, alice.key);
      keys.set(bob.id, bob.key);
      const wager = await h.wagers.create({
        matchId: randomUUID(),
        playerAId: alice.id,
        playerBId: bob.id,
        stakeAmount: STAKE,
      });
      await h.wagers.accept(wager.id, bob.id);

      expect(await h.wagers.buildStakeTransaction(wager.id, alice.id)).toBeNull();
      await h.wagers.submitStake(wager.id, alice.id, null);
      const staked = await h.wagers.submitStake(wager.id, bob.id, null);
      expect(staked.status).toBe(WagerStatus.STAKED);

      expect((await h.wagers.settle(wager.id, { winnerId: alice.id })).status).toBe(WagerStatus.WON);
      expect(await tokenBalance(d, alice.key.publicKey())).toBe(START + BigInt(STAKE));
    }, 180_000);
  });
});
