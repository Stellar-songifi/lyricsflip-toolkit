import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { WagerStatus } from '../src';
import { Harness, NETWORK_PASSPHRASE, STAKE, createHarness, twoLinkedPlayers } from './harness';

describe('HTTP routes', () => {
  let h: Harness;
  let server: any;
  beforeAll(async () => {
    h = await createHarness();
    server = h.app.getHttpServer();
  });
  afterAll(() => h.close());

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

  it('rejects unauthenticated requests', async () => {
    const { wager } = await proposed();
    await request(server).get(`/wagers/${wager.id}`).expect(401);
    await request(server).post(`/wagers/${wager.id}/accept`).expect(401);
    await request(server).post('/wallet/challenge').send({ address: 'x' }).expect(401);
  });

  it('exposes no route for clients to settle, refund, reconcile or create a wager', async () => {
    const { wager, alice } = await proposed();
    for (const path of ['settle', 'refund', 'reconcile']) {
      await request(server)
        .post(`/wagers/${wager.id}/${path}`)
        .set('x-player', alice.id)
        .send({ winnerId: alice.id, outcome: 'won' })
        .expect(404);
    }
    await request(server)
      .post('/wagers')
      .set('x-player', alice.id)
      .send({ matchId: 'm', playerAId: alice.id, playerBId: 'x', stakeAmount: STAKE })
      .expect(404);
  });

  it('acts only for the authenticated player, never a player id in the body', async () => {
    const { wager, alice, bob } = await proposed();

    await request(server)
      .post(`/wagers/${wager.id}/accept`)
      .set('x-player', alice.id)
      .send({ playerId: bob.id, userId: bob.id })
      .expect(403);
    expect((await h.wagers.findById(wager.id)).status).toBe(WagerStatus.PENDING);
  });

  it('runs the full player flow over HTTP', async () => {
    const { wager, alice, bob } = await proposed();

    const accepted = await request(server)
      .post(`/wagers/${wager.id}/accept`)
      .set('x-player', bob.id)
      .expect(200);
    expect(accepted.body.status).toBe(WagerStatus.AWAITING_STAKES);

    const tx = await request(server)
      .post(`/wagers/${wager.id}/stake-transaction`)
      .set('x-player', alice.id)
      .expect(200);
    expect(tx.body).toEqual({ transaction: null });

    await request(server).post(`/wagers/${wager.id}/stake`).set('x-player', alice.id).send({}).expect(200);
    const staked = await request(server)
      .post(`/wagers/${wager.id}/stake`)
      .set('x-player', bob.id)
      .send({})
      .expect(200);
    expect(staked.body.status).toBe(WagerStatus.STAKED);

    const list = await request(server).get('/wagers').set('x-player', bob.id).expect(200);
    expect(list.body.map((w: { id: string }) => w.id)).toContain(wager.id);
  });

  it("hides a wager from players who aren't in it", async () => {
    const { wager } = await proposed();
    await request(server).get(`/wagers/${wager.id}`).set('x-player', 'mallory').expect(403);
  });

  it('rejects malformed ids', async () => {
    await request(server).get('/wagers/not-a-uuid').set('x-player', 'p').expect(400);
  });

  describe('wallet linking (SEP-10)', () => {
    async function signedChallenge(playerId: string, wallet: Keypair) {
      const res = await request(server)
        .post('/wallet/challenge')
        .set('x-player', playerId)
        .send({ address: wallet.publicKey() })
        .expect(200);
      expect(res.body.networkPassphrase).toBe(NETWORK_PASSPHRASE);
      const tx = TransactionBuilder.fromXDR(res.body.transactionXdr, Networks.TESTNET);
      tx.sign(wallet);
      return tx.toXDR();
    }

    it('links a wallet the player proves they own', async () => {
      const wallet = Keypair.random();
      const playerId = `p-${randomUUID()}`;
      const signed = await signedChallenge(playerId, wallet);

      const res = await request(server)
        .post('/wallet/verify')
        .set('x-player', playerId)
        .send({ address: wallet.publicKey(), signedTransactionXdr: signed })
        .expect(200);

      expect(res.body.address).toBe(wallet.publicKey());
      const me = await request(server).get('/wallet').set('x-player', playerId).expect(200);
      expect(me.body.address).toBe(wallet.publicKey());
    });

    it('rejects a challenge signed by a different key', async () => {
      const wallet = Keypair.random();
      const playerId = `p-${randomUUID()}`;
      const res = await request(server)
        .post('/wallet/challenge')
        .set('x-player', playerId)
        .send({ address: wallet.publicKey() })
        .expect(200);
      const tx = TransactionBuilder.fromXDR(res.body.transactionXdr, Networks.TESTNET);
      tx.sign(Keypair.random());

      await request(server)
        .post('/wallet/verify')
        .set('x-player', playerId)
        .send({ address: wallet.publicKey(), signedTransactionXdr: tx.toXDR() })
        .expect(401);
    });

    it('rejects a challenge the server did not issue', async () => {
      const wallet = Keypair.random();
      const playerId = `p-${randomUUID()}`;
      const forged = new TransactionBuilder(
        new Account(Keypair.random().publicKey(), '-1'),
        { fee: '100', networkPassphrase: NETWORK_PASSPHRASE },
      )
        .addOperation(
          Operation.manageData({
            name: 'toolkit.test auth',
            value: 'x'.repeat(64),
            source: wallet.publicKey(),
          }),
        )
        .setTimeout(300)
        .build();
      forged.sign(wallet);

      await request(server)
        .post('/wallet/verify')
        .set('x-player', playerId)
        .send({ address: wallet.publicKey(), signedTransactionXdr: forged.toXDR() })
        .expect(401);
    });

    it('rejects a replayed challenge', async () => {
      const wallet = Keypair.random();
      const playerId = `p-${randomUUID()}`;
      const signed = await signedChallenge(playerId, wallet);
      const body = { address: wallet.publicKey(), signedTransactionXdr: signed };

      await request(server).post('/wallet/verify').set('x-player', playerId).send(body).expect(200);
      await request(server).post('/wallet/verify').set('x-player', playerId).send(body).expect(401);
    });

    it('refuses to link a wallet that belongs to another player', async () => {
      const wallet = Keypair.random();
      const owner = `p-${randomUUID()}`;
      await h.links.link(owner, wallet.publicKey());
      const intruder = `p-${randomUUID()}`;
      const signed = await signedChallenge(intruder, wallet);

      await request(server)
        .post('/wallet/verify')
        .set('x-player', intruder)
        .send({ address: wallet.publicKey(), signedTransactionXdr: signed })
        .expect(409);
    });

    it('refuses to switch wallets while a wager is in progress', async () => {
      const { alice } = await proposed();
      const next = Keypair.random();
      await expect(h.links.link(alice.id, next.publicKey())).rejects.toThrow(/while a wager is in progress/);
    });

    it('rejects addresses that are not Stellar accounts', async () => {
      await request(server)
        .post('/wallet/challenge')
        .set('x-player', 'p')
        .send({ address: 'not-an-address' })
        .expect(400);
    });
  });
});
