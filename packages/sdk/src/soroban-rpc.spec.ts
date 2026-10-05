import { createServer, Server } from 'http';
import { Keypair, Operation, TransactionBuilder, Account } from '@stellar/stellar-sdk';
import { DEFAULT_HTTP_TIMEOUT_MS, SorobanRpc } from './soroban-rpc';

/**
 * A stand-in for the "slow or unresponsive RPC node" in the issue: it accepts
 * the TCP connection and reads the request, then never writes a response. A
 * client without an HTTP timeout waits on it forever.
 */
class HangingRpcNode {
  private readonly server: Server;
  private readonly sockets = new Set<import('net').Socket>();

  private constructor(server: Server) {
    this.server = server;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  static async start(): Promise<HangingRpcNode> {
    const server = createServer(() => {
      // Deliberately never calls res.end().
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return new HangingRpcNode(server);
  }

  get url(): string {
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    // A hung request keeps its socket open; destroy them so `close()` resolves.
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const PASSPHRASE = 'Test SDF Network ; September 2015';

function signableTransaction(): ReturnType<TransactionBuilder['build']> {
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), '0'), {
    fee: '100',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.manageData({ name: 'noop', value: 'x' }))
    .setTimeout(60)
    .build();
}

describe('SorobanRpc httpTimeoutMs (#8)', () => {
  it('defaults to 15 seconds and applies it to the HTTP client', () => {
    const rpc = new SorobanRpc({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: PASSPHRASE,
    });

    expect(rpc.httpTimeoutMs).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(15_000);
    expect(rpc.server.httpClient.defaults.timeout).toBe(15_000);
  });

  it('applies an explicit httpTimeoutMs to the HTTP client', () => {
    const rpc = new SorobanRpc({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: PASSPHRASE,
      httpTimeoutMs: 1_000,
    });

    expect(rpc.httpTimeoutMs).toBe(1_000);
    expect(rpc.server.httpClient.defaults.timeout).toBe(1_000);
  });

  describe('against a node that never answers', () => {
    let node: HangingRpcNode;

    beforeEach(async () => {
      node = await HangingRpcNode.start();
    });

    afterEach(async () => {
      await node.close();
    });

    it('rejects a read that outlives httpTimeoutMs instead of hanging', async () => {
      const rpc = new SorobanRpc({
        rpcUrl: node.url,
        networkPassphrase: PASSPHRASE,
        httpTimeoutMs: 250,
      });

      const started = Date.now();
      await expect(rpc.read(CONTRACT, 'get_config', [])).rejects.toThrow(/timeout/i);
      // Bounded by the timeout, not by however long the node stays silent.
      expect(Date.now() - started).toBeLessThan(3_000);
    });

    it('reports a timed-out submission as pending, never failed', async () => {
      const rpc = new SorobanRpc({
        rpcUrl: node.url,
        networkPassphrase: PASSPHRASE,
        httpTimeoutMs: 250,
      });

      const started = Date.now();
      const submission = await rpc.submit(signableTransaction());

      // The request may have reached the network before the local timeout
      // fired, so the outcome is unknown and must be reconciled — reporting
      // `failed` here is what would let a retry pay twice.
      expect(submission.status).toBe('pending');
      expect(submission.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(submission.error).toMatch(/timeout/i);
      expect(Date.now() - started).toBeLessThan(3_000);
    });

    it('keeps lookup pending rather than failed when the node is unresponsive', async () => {
      const rpc = new SorobanRpc({
        rpcUrl: node.url,
        networkPassphrase: PASSPHRASE,
        httpTimeoutMs: 250,
      });

      const submission = await rpc.lookup('a'.repeat(64));

      expect(submission.status).toBe('pending');
      expect(submission.error).toMatch(/timeout/i);
    });

    it('reports an unconfirmed poll as pending instead of hanging', async () => {
      const rpc = new SorobanRpc({
        rpcUrl: node.url,
        networkPassphrase: PASSPHRASE,
        httpTimeoutMs: 100,
        pollAttempts: 2,
      });

      const started = Date.now();
      const submission = await rpc.waitFor('b'.repeat(64));

      // The poll's HTTP request is cancelled, so the wait ends at the timeout
      // rather than at the node's discretion.
      expect(submission.status).toBe('pending');
      expect(submission.error).toMatch(/timeout/i);
      expect(Date.now() - started).toBeLessThan(3_000);
    });
  });

  it('treats httpTimeoutMs: 0 as "no timeout" rather than "abort immediately"', () => {
    const rpc = new SorobanRpc({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: PASSPHRASE,
      httpTimeoutMs: 0,
    });

    expect(rpc.server.httpClient.defaults.timeout).toBe(0);
  });
});
