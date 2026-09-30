import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppDataSource } from '../src/config/data-source';
import { Difficulty, Lyric } from '../src/modules/lyrics/entities/lyric.entity';

export const LYRICS = Array.from({ length: 14 }, (_, i) => ({
  snippet: `Test snippet number ${i} la la la`,
  artist: `Artist ${i}`,
  title: `Song Title ${i}`,
  genre: 'Pop',
  decade: 2010,
  difficulty: Difficulty.EASY,
}));

/** Recreates the e2e database, runs every migration and seeds lyrics. */
export async function resetDatabase(): Promise<void> {
  const name = process.env.DB_NAME as string;
  const admin = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.getRepository(Lyric).save(LYRICS);
  await AppDataSource.destroy();
}

export async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  return app;
}

export interface Player {
  id: string;
  token: string;
  wallet: Keypair;
}

/** Signs in with a fresh wallet through SEP-10. */
export async function signIn(app: INestApplication): Promise<Player> {
  const wallet = Keypair.random();
  const server = app.getHttpServer();
  const challenge = await request(server)
    .post('/auth/stellar/challenge')
    .send({ walletAddress: wallet.publicKey() })
    .expect(201);
  const tx = TransactionBuilder.fromXDR(challenge.body.transactionXdr, Networks.TESTNET);
  tx.sign(wallet);
  const verified = await request(server)
    .post('/auth/stellar/verify')
    .send({ walletAddress: wallet.publicKey(), signedTransactionXdr: tx.toXDR() })
    .expect(201);
  return { id: verified.body.user.id, token: verified.body.accessToken, wallet };
}

export function auth(player: Player): [string, string] {
  return ['Authorization', `Bearer ${player.token}`];
}

/** Polls `check` until it returns a truthy value or the timeout passes. */
export async function eventually<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
