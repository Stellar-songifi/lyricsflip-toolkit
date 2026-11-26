import { Account, Keypair, Networks, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { SorobanRpc, isBadSeq } from './soroban-rpc';

/** A fake network that enforces sequence numbers like stellar-core does. */
function fakeNetwork(rpcClient: SorobanRpc, startSeq: bigint) {
  let onChain = startSeq;
  const accepted: bigint[] = [];
  const getAccount = jest
    .spyOn(rpcClient.server, 'getAccount')
    .mockImplementation(async (id: string) => new Account(id, onChain.toString()));
  jest.spyOn(rpcClient.server, 'sendTransaction').mockImplementation(async (tx: any) => {
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    const seq = BigInt(tx.sequence);
    if (seq !== onChain + 1n) {
      return {
        status: 'ERROR',
        hash: 'x',
        errorResult: { result: { type: 'txBadSeq' }, toXDR: () => 'badseq' },
      } as any;
    }
    onChain = seq;
    accepted.push(seq);
    return { status: 'PENDING', hash: 'x' } as any;
  });
  jest.spyOn(rpcClient.server, 'pollTransaction').mockResolvedValue({
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    ledger: 5,
  } as any);
  return {
    accepted,
    getAccount,
    /** Simulates another process spending a sequence number behind our back. */
    bumpExternally: () => (onChain += 1n),
  };
}

function build(account: Account) {
  return Promise.resolve(
    new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
      .setTimeout(60)
      .build(),
  );
}

describe('SorobanRpc.submitSequenced (#59)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gives 20 concurrent submissions from one key distinct, consecutive sequence numbers', async () => {
    const client = new SorobanRpc({ rpcUrl: 'http://localhost:1', networkPassphrase: Networks.TESTNET });
    const net = fakeNetwork(client, 100n);
    const signer = Keypair.random();

    const results = await Promise.all(Array.from({ length: 20 }, () => client.submitSequenced(signer, build)));

    expect(results.every((r) => r.status === 'confirmed')).toBe(true);
    expect(net.accepted).toEqual(Array.from({ length: 20 }, (_, i) => 101n + BigInt(i)));
    expect(net.getAccount).toHaveBeenCalledTimes(1); // the local counter is reused
  });

  it('refreshes the sequence and retries straight away on txBAD_SEQ', async () => {
    const client = new SorobanRpc({ rpcUrl: 'http://localhost:1', networkPassphrase: Networks.TESTNET });
    const net = fakeNetwork(client, 100n);
    const signer = Keypair.random();
    await client.submitSequenced(signer, build); // caches 101

    net.bumpExternally(); // someone else used 102
    const result = await client.submitSequenced(signer, build);

    expect(result.status).toBe('confirmed');
    expect(net.accepted).toEqual([101n, 103n]);
    expect(net.getAccount).toHaveBeenCalledTimes(2);
  });

  it('reports failed after the retry budget is spent', async () => {
    const client = new SorobanRpc({
      rpcUrl: 'http://localhost:1',
      networkPassphrase: Networks.TESTNET,
      badSeqRetries: 1,
    });
    fakeNetwork(client, 100n);
    jest.spyOn(client.server, 'sendTransaction').mockResolvedValue({
      status: 'ERROR',
      hash: 'x',
      errorResult: { result: { type: 'txBadSeq' }, toXDR: () => 'badseq' },
    } as any);

    const result = await client.submitSequenced(Keypair.random(), build);

    expect(result.status).toBe('failed');
    expect(client.server.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it('isBadSeq recognises only txBAD_SEQ', () => {
    expect(isBadSeq({ status: 'ERROR', errorResult: { result: { type: 'txBadSeq' } } } as any)).toBe(true);
    expect(isBadSeq({ status: 'ERROR', errorResult: { result: { type: 'txFailed' } } } as any)).toBe(false);
    expect(isBadSeq({ status: 'PENDING' } as any)).toBe(false);
  });
});
