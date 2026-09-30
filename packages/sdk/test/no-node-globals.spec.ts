import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * React Native has no `Buffer` or `process`-era Node APIs. This runs the
 * built SDK in a Node process with `Buffer` removed, as a proxy: every
 * offline operation a mobile client needs must still work.
 */
describe('SDK without Node globals', () => {
  it('builds, checks and encodes stake calls with no Buffer', () => {
    const dist = resolve(__dirname, '../dist');
    const script = `
      delete globalThis.Buffer;
      if (typeof Buffer !== 'undefined') throw new Error('Buffer still defined');
      const sdk = require(${JSON.stringify(dist)});
      const { Account, Contract, Keypair, Networks, TransactionBuilder } = require('@stellar/stellar-sdk');

      const contractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
      const potId = '00112233-4455-6677-8899-aabbccddeeff';
      const player = Keypair.random();
      const tx = new TransactionBuilder(new Account(player.publicKey(), '1'), {
        fee: '100', networkPassphrase: Networks.TESTNET,
      })
        .addOperation(new Contract(contractId).call('stake', sdk.potIdToScVal(potId), sdk.addressToScVal(player.publicKey())))
        .setTimeout(60)
        .build();
      tx.sign(player);

      const client = new sdk.PvpEscrowClient(
        new sdk.SorobanRpc({ rpcUrl: 'http://localhost:1', networkPassphrase: Networks.TESTNET }),
        contractId,
      );
      const roundTrip = client.rpc.fromXdr(tx.toXDR());
      client.assertIsStake(roundTrip, potId, player.publicKey());

      const out = {
        hash: sdk.hashHex(roundTrip),
        stroops: sdk.toStroops('12.5'),
        display: sdk.fromStroops('125000000'),
      };
      process.stdout.write(JSON.stringify(out));
    `;
    const output = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
    expect(output.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(output.stroops).toBe('125000000');
    expect(output.display).toBe('12.5');
  });
});
