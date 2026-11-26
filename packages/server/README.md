# @lyricsflip-toolkit/server

A NestJS module for staked head-to-head matches: wager state machine, server-only settlement,
crash-safe reconciliation and SEP-10 wallet linking, on top of the
[`pvp-escrow`](../../contracts/pvp-escrow) contract.

> Package name is a placeholder; nothing is published to npm. Use it from this workspace.

## Install into a NestJS app

```ts
import { TypeOrmModule } from '@nestjs/typeorm';
import { PVP_ENTITIES, PVP_MIGRATIONS, PvpSettlementModule } from '@lyricsflip-toolkit/server';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [...yourEntities, ...PVP_ENTITIES],
      migrations: [...yourMigrations, ...PVP_MIGRATIONS],
    }),
    PvpSettlementModule.forRoot({
      mode: 'mock', // or 'stellar' with the `stellar` options below
      authenticate: (req) => verifyYourSessionAndReturnPlayerId(req), // null = 401
      sep10: { signingSecret, homeDomain: 'api.example.com', networkPassphrase },
      onEvent: (event) => { /* e.g. start the match on 'wager.staked' */ },
    }),
  ],
})
export class AppModule {}
```

`forRootAsync({ imports, inject, useFactory })` works the same way. The module is global, and it
exports `WagerService`, `WalletLinkService` and `Sep10Service`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `mode` | — | `mock` (pots in `pvp_mock_pots`, no tokens move) or `stellar` |
| `stellar.network` | — | `testnet`, `futurenet`, `local` or `public` |
| `stellar.rpcUrl`, `stellar.networkPassphrase` | — | Soroban RPC endpoint and network |
| `stellar.escrowContractId`, `stellar.tokenContractId` | — | Deployed `pvp-escrow` and stake token |
| `stellar.resolverSecret` | — | The escrow's resolver key (S...). One of this or `resolverSecretProvider` is required. Static: parsed once at boot, so it cannot be rotated without a restart. |
| `stellar.resolverSecretProvider` | — | `() => Promise<string>`: fetched before each resolver call and cached for `resolverSecretCacheTtlMs`, so the key can be rotated without a restart. |
| `stellar.resolverSecretCacheTtlMs` | 60,000 | How long a `resolverSecretProvider` result is trusted |
| `stellar.custodyMode` | `non-custodial` | `custodial` signs stakes with `custodialPlayerSecret(playerId)`. Refused on `public`. |
| `stellar.stakeTxTimeoutSeconds` | 300 | How long a player has to sign their stake |
| `stellar.confirmTimeoutSeconds` | 30 | Polling before a submission is reported `pending` |
| `sep10.signingSecret`, `sep10.homeDomain` | — | Stable SEP-10 server key and domain |
| `authenticate(request)` | — | Returns the player id or `null`. Player ids are never read from bodies. |
| `potTimeoutLedgers` | 17,280 (~1 day) | Ledgers until players may reclaim stakes (60–518,400) |
| `acceptWindowSeconds` | 900 | Pending wagers older than this are cancelled |
| `stakeWindowSeconds` | 900 | Accepted wagers not fully staked by then are refunded |
| `reconcile.enabled` / `intervalSeconds` / `minAgeSeconds` / `maxAttempts` | true / 60 / 60 / 8 | Background sweeper |
| `abortBeforeDeadlineLedgers` | 720 (~1 hour) | Staked wagers whose pot deadline is this close are aborted and refunded by the reconciler before players can `claim_refund` |
| `onEvent(event)` | — | Called for each wager event (at-least-once, see below) |
| `synchronousEmit` | false | Call `onEvent` inline after the status change commits instead of via the outbox dispatcher. For tests only; loses events if the process dies. |
| `controllers` | true | Mount the HTTP routes below |

Invalid combinations (stellar mode without its settings, custodial on `public`, a timeout outside the
contract's limits) throw at boot.

## `WagerService` (server only)

| Method | What it does |
|---|---|
| `create({ matchId, playerAId, playerBId, stakeAmount })` | Records a proposal. No pot, no stake request. `stakeAmount` is a stroop string. |
| `accept(wagerId, playerId)` | Player two accepts; the pot is opened. The only path to `awaiting_stakes`. |
| `decline(wagerId, playerId)` / `cancel(wagerId, playerId)` | Ends a pending wager as `cancelled`. |
| `buildStakeTransaction(wagerId, playerId)` | Unsigned stake XDR for the wallet, or `null` if no signature is needed |
| `submitStake(wagerId, playerId, signedXdr \| null)` | Checks and submits a stake; `staked` once the pot holds both |
| `settle(wagerId, { winnerId } \| { draw: true })` | Records the intent, then pays out or refunds. Idempotent. |
| `settleMatch(matchId, result)` | `settle` by your match id |
| `abort(wagerId, reason)` | Refunds whatever was staked, or cancels an unaccepted wager |
| `reconcile(wagerId)` | Moves a wager to its true state by reading the pot. The sweeper calls this. |
| `findById`, `findByMatchId`, `getForPlayer`, `listForPlayer` | Reads |

## HTTP routes

All routes need `authenticate` to return a player id. None of them creates, settles or refunds a wager.

| Route | Purpose |
|---|---|
| `GET /wagers` | The player's wagers |
| `GET /wagers/:id` | One wager (players of it only) |
| `POST /wagers/:id/accept` · `/decline` · `/cancel` | Player two accepts or declines; either player cancels before acceptance |
| `POST /wagers/:id/stake-transaction` | `{ transaction: { transactionXdr, networkPassphrase } \| null }` |
| `POST /wagers/:id/stake` | `{ signedTransactionXdr? }` |
| `GET /wallet` | The player's linked wallet |
| `POST /wallet/challenge` · `/wallet/verify` | SEP-10 link a wallet to the signed-in player |
| `GET /wager/resolver-address` | The resolver public key the server signs with right now (stellar mode only) — see the runbook below |

## Rotating the resolver key

The contract's `set_resolver(new_address)` lets the admin rotate the on-chain
resolver. If the old secret is compromised, every settlement call between that
rotation and a server restart would still be signed with the compromised key.
A `stellar.resolverSecretProvider` bounds that window to
`resolverSecretCacheTtlMs` (60 s by default) instead of the process lifetime.

1. Generate the replacement resolver key and fund it, as for the original.
2. **Update the secrets manager first** so `resolverSecretProvider` returns the
   new secret. Within one TTL every instance signs with the new key. Until the
   contract is updated (step 3) those resolver calls fail with an auth error —
   nothing moves on-chain, and the wager reconciler retries them. Doing it in
   this order is what closes the window in which a compromised key is still in
   use; the cost is a short spell of failing settlements, bounded by the TTL.
3. Wait out one TTL so every instance has re-read the secret.
4. Call `set_resolver(new_address)` on the contract as the admin. From this
   point the contract enforces the new resolver and settlement resumes.
5. Confirm the live server matches the chain:

   ```bash
   curl -H 'Authorization: Bearer <operator token>' https://api.example.com/wager/resolver-address
   # {"resolverAddress":"G..."} — compare with the contract's get_config
   ```

   A mismatch means an instance has not re-read the secret yet; check that the
   secrets manager value is the new key and that the TTL has elapsed.
6. Only once every instance reports the new address, delete the old secret.

`GET /wager/resolver-address` sits behind the same guard as the other routes, so
someone must be authenticated to read it. The value is public either way — it is
readable on-chain via `get_config` — so the route never leaks a secret.

## Events

`onEvent` receives `{ type, wager }`, where `type` is one of `wager.created`, `wager.accepted`,
`wager.staked`, `wager.won`, `wager.refunded`, `wager.cancelled` or `wager.failed`.

### Delivery guarantees

Events are written to the `pvp_wager_events` outbox in the same transaction as the status change,
so an event is never lost once the change commits. A background dispatcher (interval plus a
PostgreSQL advisory lock, like the reconciler) then calls `onEvent` for undelivered rows, marks them
delivered and retries failures with backoff.

Delivery is **at-least-once**: if the process dies after `onEvent` runs but before the row is marked
delivered, the event is delivered again on a later dispatch. **Handlers must be idempotent** — key
your side effects on the wager id and event type (or a dedupe table) so a repeated `wager.staked`
does not start a match twice and a repeated `wager.won` does not notify twice.

Set `synchronousEmit: true` to call `onEvent` inline after the commit (the old behaviour). Use it
only in tests; it gives no durability guarantee.

## Aborting staked wagers before the pot deadline

If the game never calls `settle`, the pot's `deadline_ledger` eventually passes and either player can
call `claim_refund`, leaving the server with a half-refunded pot and a `settle` that fails with
`PotNotStaked`. To prevent that, the reconciler tracks the current ledger (RPC `getLatestLedger` in
stellar mode, `currentMockLedger` in mock mode) and treats a `staked` wager as needing attention once
its pot deadline is within `abortBeforeDeadlineLedgers`. Such wagers are aborted with a refund and a
`wager.failed` event carrying a `POT_EXPIRED` reason, so the game can cancel the match. Wagers far
from their deadline are untouched.

## Error codes

Client responses never contain raw XDR, RPC URLs or downstream SDK messages; full details are logged
server-side with the wager id. Failures are mapped to stable codes:

| Code | Meaning |
|---|---|
| `STAKE_REJECTED` | The contract rejected the stake (e.g. `PotNotOpen`, `AlreadyStaked`) |
| `INSUFFICIENT_BALANCE` | The player's token balance is too low to stake |
| `POT_EXPIRED` | The pot's deadline has passed or is about to; the wager is refunded |
| `POT_NOT_STAKED` | Settlement was attempted on a pot that is not fully staked |
| `STAKE_PENDING` | The stake transaction has not confirmed yet; retry later |
| `INTERNAL_ERROR` | Anything unmapped; details are in the server log only |

## Tables

`pvp_wagers`, `pvp_wallet_links`, `pvp_mock_pots` and `pvp_wager_events`, created by
`PVP_MIGRATIONS` (PostgreSQL 13+).

## Tests

```bash
npm test -w @lyricsflip-toolkit/server                   # Postgres (PVP_TEST_DATABASE_URL)
npm run test:integration -w @lyricsflip-toolkit/server   # + local Stellar network on :8000
```
