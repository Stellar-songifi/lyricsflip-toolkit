import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WalletLinkService } from '../src/wallet/wallet-link.service';

/**
 * Tests for issue #56: `WalletLinkService.link` is racy and can leave a player
 * without a wallet.
 *
 * These tests assume a test harness (`h`) is available that exposes:
 *   - `h.links`: a `WalletLinkService` instance backed by a real DataSource
 *   - `h.dataSource`: the `DataSource` used by the service
 *   - `h.close()`: tears down the harness / connection
 *
 * The harness is created in `beforeEach` and closed in `afterEach`.
 */

interface Harness {
  links: WalletLinkService;
  dataSource: DataSource;
  close(): Promise<void>;
}

// The harness factory is provided by the test setup. Adjust the import path
// below if your project exposes it from a different module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWalletLinkHarness } = require('./helpers/wallet-link-harness') as {
  createWalletLinkHarness: () => Promise<Harness>;
};

describe('WalletLinkService.link (issue #56)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createWalletLinkHarness();
  });

  afterEach(async () => {
    if (h) {
      await h.close();
    }
  });

  async function getLinkRows(playerId: string): Promise<Array<{ playerId: string; address: string }>> {
    return h.dataSource.query(
      'SELECT "playerId", "address" FROM pvp_wallet_links WHERE "playerId" = $1',
      [playerId],
    );
  }

  it('handles two concurrent link calls for the same player without a 500', async () => {
    const playerId = 'player-concurrent-1';
    const addrA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const addrB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const results = await Promise.allSettled([
      h.links.link(playerId, addrA),
      h.links.link(playerId, addrB),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        const reason = result.reason;
        // Only a ConflictException (409) is acceptable; anything else
        // (notably a raw 500 / unique-constraint error) fails the test.
        expect(reason).toBeInstanceOf(ConflictException);
      }
    }

    const rows = await getLinkRows(playerId);
    expect(rows).toHaveLength(1);
    expect([addrA, addrB]).toContain(rows[0].address);
  });

  it('leaves the old link in place when the insert fails', async () => {
    const playerId = 'player-insert-fail-1';
    const addrA = '0xcccccccccccccccccccccccccccccccccccccccc';
    const addrB = '0xdddddddddddddddddddddddddddddddddddddddd';

    await h.links.link(playerId, addrA);

    const before = await getLinkRows(playerId);
    expect(before).toHaveLength(1);
    expect(before[0].address).toBe(addrA);

    // Force the upsert to fail by making the transaction manager's query
    // reject for the INSERT ... ON CONFLICT statement.
    const manager = h.dataSource.manager;
    const originalQuery = manager.query.bind(manager);
    const querySpy = jest
      .spyOn(manager, 'query')
      .mockImplementation(async (query: string, parameters?: unknown[]) => {
        if (typeof query === 'string' && /INSERT\s+INTO\s+"?pvp_wallet_links"?/i.test(query)) {
          throw new Error('forced insert failure');
        }
        return originalQuery(query, parameters);
      });

    try {
      await expect(h.links.link(playerId, addrB)).rejects.toBeDefined();
    } finally {
      querySpy.mockRestore();
    }

    const after = await getLinkRows(playerId);
    expect(after).toHaveLength(1);
    expect(after[0].address).toBe(addrA);
  });

  it('maps a unique address violation to a 409 ConflictException', async () => {
    const playerA = 'player-unique-a';
    const playerB = 'player-unique-b';
    const addr = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    await h.links.link(playerA, addr);

    await expect(h.links.link(playerB, addr)).rejects.toBeInstanceOf(ConflictException);

    const rowsA = await getLinkRows(playerA);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].address).toBe(addr);

    const rowsB = await getLinkRows(playerB);
    expect(rowsB).toHaveLength(0);
  });
});