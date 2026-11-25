import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { InvalidStakeAuthError, PvpEscrowClient, addressToScVal, potIdToScVal } from './pvp-escrow-client';
import { SorobanRpc } from './soroban-rpc';

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const OTHER_CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const TOKEN = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
/** A smart-wallet (contract) account. */
const SMART_WALLET = 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';

function invocation(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    subInvocations: subs,
  });
}

function entry(signer: string, root: xdr.SorobanAuthorizedInvocation) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(signer).toScAddress(),
        nonce: 1n,
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: root,
  });
}

describe('PvpEscrowClient.assertIsStakeAuth (#62)', () => {
  const rpc = new SorobanRpc({ rpcUrl: 'http://localhost:1', networkPassphrase: 'Test SDF Network ; September 2015' });
  const client = new PvpEscrowClient(rpc, CONTRACT);
  const potId = randomUUID();
  const stakeArgs = (pot = potId, who = SMART_WALLET) => [potIdToScVal(pot), addressToScVal(who)];
  const transfer = (from = SMART_WALLET, to = CONTRACT) =>
    invocation(TOKEN, 'transfer', [addressToScVal(from), addressToScVal(to), nativeToScVal(50_000_000n, { type: 'i128' })]);

  it('accepts the stake with its own token transfer, for a contract account', () => {
    const auth = entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(), [transfer()]));
    expect(() => client.assertIsStakeAuth(auth, potId, SMART_WALLET)).not.toThrow();
  });

  it('accepts a classic account too', () => {
    const player = Keypair.random().publicKey();
    const auth = entry(player, invocation(CONTRACT, 'stake', stakeArgs(potId, player), [transfer(player)]));
    expect(() => client.assertIsStakeAuth(auth, potId, player)).not.toThrow();
  });

  it.each([
    ['a different pot', () => entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(randomUUID())))],
    ['a different function', () => entry(SMART_WALLET, invocation(CONTRACT, 'claim_refund', stakeArgs()))],
    ['a different contract', () => entry(SMART_WALLET, invocation(OTHER_CONTRACT, 'stake', stakeArgs()))],
    ['a different player in the args', () => entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(potId, Keypair.random().publicKey())))],
    ['a different signer', () => entry(Keypair.random().publicKey(), invocation(CONTRACT, 'stake', stakeArgs()))],
    ['a transfer to someone else', () => entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(), [transfer(SMART_WALLET, OTHER_CONTRACT)]))],
    ['an extra nested call', () => entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(), [invocation(TOKEN, 'approve', [])]))],
  ])('refuses an entry for %s', (_label, build) => {
    expect(() => client.assertIsStakeAuth(build(), potId, SMART_WALLET)).toThrow(InvalidStakeAuthError);
  });

  it('refuses source-account credentials', () => {
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation(CONTRACT, 'stake', stakeArgs()),
    });
    expect(() => client.assertIsStakeAuth(auth, potId, SMART_WALLET)).toThrow(InvalidStakeAuthError);
  });

  it('round-trips through base64 XDR', () => {
    const auth = entry(SMART_WALLET, invocation(CONTRACT, 'stake', stakeArgs(), [transfer()]));
    const parsed = xdr.SorobanAuthorizationEntry.fromXDR(auth.toXDR('base64'), 'base64');
    expect(() => client.assertIsStakeAuth(parsed, potId, SMART_WALLET)).not.toThrow();
  });
});
