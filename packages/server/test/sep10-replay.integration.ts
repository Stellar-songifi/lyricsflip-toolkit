import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import { Sep10Service } from '../src';
import { createHarness, NETWORK_PASSPHRASE } from './harness';

/**
 * Issue #1: SEP-10 replay protection must survive a second instance and a
 * process restart, both of which share the same database.
 */
describe('SEP-10 replay protection', () => {
  it('rejects a second verify of the same signed challenge on the same instance', async () => {
    const h = await createHarness();
    try {
      const svc = h.app.get(Sep10Service);
      const account = Keypair.random();
      const challenge = svc.buildChallenge(account.publicKey());

      // Sign the challenge as the account would.
      const tx = Sep10Service.parse(challenge.transactionXdr, NETWORK_PASSPHRASE);
      tx.sign(account);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      await expect(svc.verify(account.publicKey(), signedXdr)).resolves.toBe(account.publicKey());
      await expect(svc.verify(account.publicKey(), signedXdr)).rejects.toThrow(
        /already been used/,
      );
    } finally {
      await h.close();
    }
  });

  it('rejects a replay against a second instance sharing the same database', async () => {
    // Both harnesses share DATABASE_URL but get distinct schemas by default.
    // To exercise "shared database", boot instance B on the SAME schema as A.
    const a = await createHarness();
    const schema = await a.dataSource.query(
      `SELECT current_schema() AS s`,
    ).then((rows: any[]) => rows[0].s as string);

    const b = await createHarness({}, { scripted: false });
    // Swap B's search_path to A's schema so they share tables.
    await b.dataSource.query(`SET search_path TO "${schema}"`);

    try {
      const svcA = a.app.get(Sep10Service);
      const svcB = b.app.get(Sep10Service);
      const account = Keypair.random();
      const challenge = svcA.buildChallenge(account.publicKey());

      const tx = Sep10Service.parse(challenge.transactionXdr, NETWORK_PASSPHRASE);
      tx.sign(account);
      const signedXdr = tx.toEnvelope().toXDR('base64');

      // A consumes it...
      await expect(svcA.verify(account.publicKey(), signedXdr)).resolves.toBe(account.publicKey());
      // ...and B must refuse it.
      await expect(svcB.verify(account.publicKey(), signedXdr)).rejects.toThrow(
        /already been used/,
      );
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('a process restart does not allow a redeemed challenge to be reused', async () => {
    const first = await createHarness();
    const schema = await first.dataSource
      .query(`SELECT current_schema() AS s`)
      .then((rows: any[]) => rows[0].s as string);

    const account = Keypair.random();
    const svc1 = first.app.get(Sep10Service);
    const challenge = svc1.buildChallenge(account.publicKey());
    const tx = Sep10Service.parse(challenge.transactionXdr, NETWORK_PASSPHRASE);
    tx.sign(account);
    const signedXdr = tx.toEnvelope().toXDR('base64');
    await svc1.verify(account.publicKey(), signedXdr);

    // Don't drop the schema — reuse it after "restart".
    // (Detach by not calling first.close(); instead, boot a fresh instance.)
    const second = await createHarness({}, { scripted: false });
    await second.dataSource.query(`SET search_path TO "${schema}"`);
    const svc2 = second.app.get(Sep10Service);

    try {
      await expect(svc2.verify(account.publicKey(), signedXdr)).rejects.toThrow(
        /already been used/,
      );
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('forgetExpired removes only rows whose time bound has lapsed', async () => {
    const h = await createHarness();
    try {
      const svc = h.app.get(Sep10Service);
      const account = Keypair.random();
      const challenge = svc.buildChallenge(account.publicKey());
      const tx = Sep10Service.parse(challenge.transactionXdr, NETWORK_PASSPHRASE);
      tx.sign(account);
      const signedXdr = tx.toEnvelope().toXDR('base64');
      await svc.verify(account.publicKey(), signedXdr);

      const [row] = await h.dataSource.query(
        `SELECT "expiresAt" FROM "pvp_sep10_redeemed" LIMIT 1`,
      );
      expect(row).toBeDefined();

      // Nothing should be swept while the challenge is still live.
      await expect(svc.forgetExpired(new Date(Date.now() - 60_000))).resolves.toBe(0);

      // Advance past maxTime and it should go.
      await expect(
        svc.forgetExpired(new Date(new Date(row.expiresAt).getTime() + 1_000)),
      ).resolves.toBe(1);
    } finally {
      await h.close();
    }
  });
});