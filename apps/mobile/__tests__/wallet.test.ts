import { Keypair, Networks, TransactionBuilder, Account, Operation } from '@stellar/stellar-sdk';
import { assertTestNetwork } from '../src/lib/config';
import { loadOrCreateWallet, signEnvelope, type SecretStore } from '../src/lib/wallet';

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
}

describe('device wallet', () => {
  it('creates a key once and reuses it', async () => {
    const store = memoryStore();
    const first = await loadOrCreateWallet(store);
    const second = await loadOrCreateWallet(store);
    expect(second.publicKey()).toBe(first.publicKey());
    expect(store.data.size).toBe(1);
  });

  it('signs envelopes on testnet', () => {
    const kp = Keypair.random();
    const tx = new TransactionBuilder(new Account(kp.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '5' }))
      .setTimeout(60)
      .build();
    const signed = TransactionBuilder.fromXDR(signEnvelope(kp, tx.toXDR(), Networks.TESTNET), Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
  });

  it('refuses to sign for mainnet', () => {
    expect(() => signEnvelope(Keypair.random(), 'AAAA', Networks.PUBLIC)).toThrow(/only signs on test networks/);
    expect(() => assertTestNetwork(Networks.PUBLIC)).toThrow();
    expect(() => assertTestNetwork(Networks.TESTNET)).not.toThrow();
  });
});
