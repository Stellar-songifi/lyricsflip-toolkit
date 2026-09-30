import { Account, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { InvalidStakeEnvelopeError, PvpEscrowClient, addressToScVal, isContractError, potIdToScVal } from './pvp-escrow-client';
import { SimulationError, SorobanRpc } from './soroban-rpc';

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const OTHER_CONTRACT = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

function envelope(build: (b: TransactionBuilder) => TransactionBuilder, source = Keypair.random().publicKey()) {
  const builder = new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  return build(builder).setTimeout(60).build();
}

describe('PvpEscrowClient', () => {
  const rpc = new SorobanRpc({ rpcUrl: 'http://localhost:1', networkPassphrase: Networks.TESTNET });
  const client = new PvpEscrowClient(rpc, CONTRACT);
  const potId = randomUUID();
  const player = Keypair.random().publicKey();
  const stakeCall = (contract = CONTRACT, fn = 'stake', pot = potId, who = player) =>
    new Contract(contract).call(fn, potIdToScVal(pot), addressToScVal(who));

  describe('assertIsStake', () => {
    it('accepts exactly the stake it would have issued', () => {
      const tx = envelope((b) => b.addOperation(stakeCall()));
      expect(() => client.assertIsStake(tx, potId, player)).not.toThrow();
    });

    it.each([
      ['a different contract', () => stakeCall(OTHER_CONTRACT)],
      ['a different function', () => stakeCall(CONTRACT, 'claim_refund')],
      ['a different pot', () => stakeCall(CONTRACT, 'stake', randomUUID())],
      ['a different player', () => stakeCall(CONTRACT, 'stake', potId, Keypair.random().publicKey())],
    ])('rejects %s', (_, op) => {
      const tx = envelope((b) => b.addOperation(op()));
      expect(() => client.assertIsStake(tx, potId, player)).toThrow(InvalidStakeEnvelopeError);
    });

    it('rejects extra operations riding along', () => {
      const tx = envelope((b) =>
        b
          .addOperation(stakeCall())
          .addOperation(
            Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }),
          ),
      );
      expect(() => client.assertIsStake(tx, potId, player)).toThrow(/exactly one operation/);
    });

    it('rejects an operation that is not a contract call', () => {
      const tx = envelope((b) =>
        b.addOperation(Operation.bumpSequence({ bumpTo: '10' })),
      );
      expect(() => client.assertIsStake(tx, potId, player)).toThrow(/not a contract invocation/);
    });
  });

  describe('potIdToScVal', () => {
    it('encodes a UUID as its 16 raw bytes', () => {
      const value = potIdToScVal('00112233-4455-6677-8899-aabbccddeeff');
      const native = scValToNative(value);
      expect(native).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(native).toString('hex')).toBe('00112233445566778899aabbccddeeff');
    });

    it('rejects anything that is not a UUID', () => {
      expect(() => potIdToScVal('match-42')).toThrow(/not a UUID/);
      expect(() => potIdToScVal('0011')).toThrow(/not a UUID/);
    });
  });

  describe('isContractError', () => {
    it('matches the contract error code in a simulation failure', () => {
      const err = new SimulationError('get_pot', CONTRACT, 'HostError: Error(Contract, #5)');
      expect(isContractError(err, 5)).toBe(true);
      expect(isContractError(err, 15)).toBe(false);
      expect(isContractError(new Error('Error(Contract, #5)'), 5)).toBe(false);
    });
  });
});
