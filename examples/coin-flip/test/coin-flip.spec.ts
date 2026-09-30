import { randomUUID } from 'crypto';
import { Client } from 'pg';

// Isolate this run in its own schema before the app reads its config.
const schema = `coin_flip_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
process.env.DATABASE_URL =
  process.env.PVP_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lyricsflip_test';
process.env.DATABASE_SCHEMA = schema;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('coin flip (mock settlement)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query(`CREATE SCHEMA "${schema}"`);
    await pg.end();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pg.end();
  });

  async function login() {
    const wallet = Keypair.random();
    const challenge = await request(server).post('/login/challenge').send({ address: wallet.publicKey() }).expect(200);
    const tx = TransactionBuilder.fromXDR(challenge.body.transactionXdr, Networks.TESTNET);
    tx.sign(wallet);
    const res = await request(server)
      .post('/login/verify')
      .send({ address: wallet.publicKey(), signedTransactionXdr: tx.toXDR() })
      .expect(200);
    return { id: wallet.publicKey(), auth: ['Authorization', `Bearer ${res.body.token}`] as [string, string] };
  }

  it('flips a coin and pays one of the two players once both have staked', async () => {
    const alice = await login();
    const bob = await login();

    const flip = await request(server)
      .post('/flips')
      .set(...alice.auth)
      .send({ opponent: bob.id, stakeAmount: '10000000' })
      .expect(201);
    const id = flip.body.id;

    // Everything below is the toolkit's own routes.
    await request(server).post(`/wagers/${id}/accept`).set(...bob.auth).expect(200);
    await request(server).post(`/wagers/${id}/stake`).set(...alice.auth).send({}).expect(200);
    await request(server).post(`/wagers/${id}/stake`).set(...bob.auth).send({}).expect(200);

    let wager: any;
    for (let i = 0; i < 50; i++) {
      wager = (await request(server).get(`/wagers/${id}`).set(...alice.auth)).body;
      if (wager.status === 'won') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(wager.status).toBe('won');
    expect([alice.id, bob.id]).toContain(wager.winnerId);
  });

  it('asks nothing of the opponent until they accept', async () => {
    const alice = await login();
    const bob = await login();
    const flip = await request(server)
      .post('/flips')
      .set(...alice.auth)
      .send({ opponent: bob.id, stakeAmount: '10000000' })
      .expect(201);
    await request(server).post(`/wagers/${flip.body.id}/stake`).set(...bob.auth).send({}).expect(400);
  });

  it('gives players no way to pick the winner', async () => {
    const alice = await login();
    await request(server).post('/wagers/00000000-0000-4000-8000-000000000000/settle').set(...alice.auth).expect(404);
  });
});
