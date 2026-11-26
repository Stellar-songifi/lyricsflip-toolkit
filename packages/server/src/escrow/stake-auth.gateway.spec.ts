import { BadRequestException, Logger } from '@nestjs/common';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { addressToScVal, potIdToScVal } from '@lyricsflip-toolkit/sdk';
import { StellarEscrowGateway } from './stellar-escrow.gateway';

const ESCROW = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SMART_WALLET = 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';

function stakeEntry(potId: string, fn = 'stake') {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(SMART_WALLET).toScAddress(),
        nonce: 7n,
        signatureExpirationLedger: 1_000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(ESCROW).toScAddress(),
          functionName: fn,
          args: [potIdToScVal(potId), addressToScVal(SMART_WALLET)],
        }),
      ),
      subInvocations: [],
    }),
  });
}

describe('StellarEscrowGateway relayed stakes (#62)', () => {
  const resolver = Keypair.random();
  let gateway: StellarEscrowGateway;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    gateway = new StellarEscrowGateway({
      mode: 'stellar',
      authenticate: () => null,
      stellar: {
        network: 'testnet',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        escrowContractId: ESCROW,
        tokenContractId: 'CTOKEN',
        resolverSecret: resolver.secret(),
      },
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('relays a valid entry from the resolver account', async () => {
    const potId = randomUUID();
    const built = { sign: jest.fn() } as any;
    const build = jest.spyOn(gateway.client, 'buildStakeWithAuth').mockResolvedValue(built);
    const submit = jest
      .spyOn(gateway.client.rpc, 'signAndSubmit')
      .mockResolvedValue({ status: 'confirmed', hash: 'h1', ledger: 9 });

    const outcome = await gateway.submitStakeAuth(potId, SMART_WALLET, stakeEntry(potId).toXDR('base64'));

    expect(outcome).toMatchObject({ status: 'confirmed', txHash: 'h1' });
    expect(build.mock.calls[0][3]).toBe(resolver.publicKey());
    expect(submit.mock.calls[0][1][0].publicKey()).toBe(resolver.publicKey());
  });

  it.each([
    ['a different pot', (_potId: string) => stakeEntry(randomUUID())],
    ['a different function', (potId: string) => stakeEntry(potId, 'claim_refund')],
  ])('refuses an entry for %s without submitting anything', async (_label, make) => {
    const potId = randomUUID();
    const entry = make(potId);
    const submit = jest.spyOn(gateway.client.rpc, 'signAndSubmit');

    await expect(gateway.submitStakeAuth(potId, SMART_WALLET, entry.toXDR('base64'))).rejects.toThrow(
      BadRequestException,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses something that is not an authorisation entry', async () => {
    await expect(gateway.submitStakeAuth(randomUUID(), SMART_WALLET, 'not-xdr')).rejects.toThrow(
      'Not a valid authorisation entry',
    );
  });
});
