import { Address, Keypair, buildAuthorizationEntryPreimage, hash, xdr } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { decodeAuthorizationEntries, encodeAuthorizationEntries } from '../src';
import { Harness, createHarness } from './harness';
import { Deployment, FIXTURE_WASM, LOCAL, deploy, deployContract, fund, latestLedger } from './local-network';

/**
 * SEP-45 wallet linking for contract accounts (#61) on a local network, with
 * a test web auth contract and a test smart wallet controlled by one ed25519
 * key (contracts/test-fixtures).
 */
describe('SEP-45 contract-account linking (local network)', () => {
  let d: Deployment;
  let h: Harness;
  let walletId: string;
  const owner = Keypair.random();
  const signingKey = Keypair.random();

  beforeAll(async () => {
    d = await deploy();
    // Soroban can only check a G... signer whose account exists on-chain.
    await fund(signingKey);
    const webAuthContractId = await deployContract(d.server, d.admin, FIXTURE_WASM.webAuth);
    walletId = await deployContract(d.server, d.admin, FIXTURE_WASM.smartWallet, [
      xdr.ScVal.scvBytes(owner.rawPublicKey()),
    ]);
    h = await createHarness(
      {
        sep10: { signingSecret: signingKey.secret(), homeDomain: 'toolkit.test', networkPassphrase: LOCAL.networkPassphrase },
        sep45: { webAuthContractId, rpcUrl: LOCAL.rpcUrl },
      },
      { scripted: true },
    );
  }, 300_000);
  afterAll(() => h?.close());

  /** The wallet's side: sign its own entry over the SEP-45 preimage. */
  async function signAsWallet(entriesXdr: string, signer: Keypair): Promise<string> {
    const validUntil = (await latestLedger(d.server)) + 20;
    const entries = decodeAuthorizationEntries(entriesXdr).map((entry) => {
      const c = entry.credentials;
      // Newer protocols hand out the V2 address credentials; keep the variant.
      const creds =
        c.type === 'sorobanCredentialsAddress' ? c.address : c.type === 'sorobanCredentialsAddressV2' ? c.addressV2 : null;
      if (!creds || Address.fromScAddress(creds.address).toString() !== walletId) return entry;
      const withSignature = (signature: xdr.ScVal) => {
        const inner = new xdr.SorobanAddressCredentials({
          address: creds.address,
          nonce: creds.nonce,
          signatureExpirationLedger: validUntil,
          signature,
        });
        return new xdr.SorobanAuthorizationEntry({
          credentials:
            c.type === 'sorobanCredentialsAddressV2'
              ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(inner)
              : xdr.SorobanCredentials.sorobanCredentialsAddress(inner),
          rootInvocation: entry.rootInvocation,
        });
      };
      const unsigned = withSignature(xdr.ScVal.scvVoid());
      const payload = hash(Buffer.from(buildAuthorizationEntryPreimage(unsigned, validUntil, LOCAL.networkPassphrase).toXDR()));
      return withSignature(xdr.ScVal.scvBytes(signer.sign(Buffer.from(payload))));
    });
    return encodeAuthorizationEntries(entries);
  }

  async function challenge(player: string) {
    const res = await request(h.app.getHttpServer())
      .post('/wallet/challenge')
      .set('x-player', player)
      .send({ address: walletId })
      .expect(200);
    expect(res.body.networkPassphrase).toBe(LOCAL.networkPassphrase);
    expect(decodeAuthorizationEntries(res.body.authorizationEntries)).toHaveLength(2);
    return res.body.authorizationEntries as string;
  }

  it('links a contract account through SEP-45, and refuses a replay', async () => {
    const player = `smart-${randomUUID()}`;
    const signed = await signAsWallet(await challenge(player), owner);

    const linked = await request(h.app.getHttpServer())
      .post('/wallet/verify')
      .set('x-player', player)
      .send({ address: walletId, authorizationEntries: signed });
    expect(linked.status).toBe(200);
    expect(linked.body.address).toBe(walletId);
    expect(await h.links.getAddress(player)).toBe(walletId);

    // The same signed challenge can't be redeemed twice.
    const replay = await request(h.app.getHttpServer())
      .post('/wallet/verify')
      .set('x-player', `other-${randomUUID()}`)
      .send({ address: walletId, authorizationEntries: signed })
      .expect(401);
    expect(replay.body.message).toMatch(/already been used/);
  }, 120_000);

  it("refuses a challenge signed by a key that doesn't control the wallet", async () => {
    const player = `smart-${randomUUID()}`;
    const signed = await signAsWallet(await challenge(player), Keypair.random());

    const res = await request(h.app.getHttpServer())
      .post('/wallet/verify')
      .set('x-player', player)
      .send({ address: walletId, authorizationEntries: signed })
      .expect(401);
    expect(res.body.message).toMatch(/did not authorise/);
  }, 120_000);

  it('refuses entries claimed for a different account', async () => {
    const player = `smart-${randomUUID()}`;
    const signed = await signAsWallet(await challenge(player), owner);
    const other = await deployContract(d.server, d.admin, FIXTURE_WASM.smartWallet, [
      xdr.ScVal.scvBytes(owner.rawPublicKey()),
    ]);

    await request(h.app.getHttpServer())
      .post('/wallet/verify')
      .set('x-player', player)
      .send({ address: other, authorizationEntries: signed })
      .expect(401);
  }, 120_000);

  it('still links classic accounts through SEP-10', async () => {
    const classic = Keypair.random();
    await fund(classic);
    const res = await request(h.app.getHttpServer())
      .post('/wallet/challenge')
      .set('x-player', `classic-${randomUUID()}`)
      .send({ address: classic.publicKey() })
      .expect(200);
    expect(res.body.transactionXdr).toBeDefined();
  }, 60_000);
});
