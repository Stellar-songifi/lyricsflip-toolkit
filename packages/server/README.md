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
| `stellar.resolverSecret` | — | The escrow's resolver key (S...). Keep it in a secrets manager. |
| `stellar.custodyMode` | `non-custodial` | `custodial` signs stakes with `custodialPlayerSecret(playerId)`. Refused on `public`. |
| `stellar.stakeTxTimeoutSeconds` | 300 | How long a player has to sign their stake |
| `stellar.confirmTimeoutSeconds` | 30 | Polling before a submission is reported `pending` |
| `sep10.signingSecret`, `sep10.homeDomain` | — | Stable SEP-10 server key and domain |
| `authenticate(request)` | — | Returns the player id or `null`. Player ids are never read from bodies. |
| `potTimeoutLedgers` | 17,280 (~1 day) | Ledgers until players may reclaim stakes (60–518,400) |
| `acceptWindowSeconds` | 900 | Pending wagers older than this are cancelled |
| `stakeWindowSeconds` | 900 | Accepted wagers not fully staked by then are refunded |
| `reconcile.enabled` / `intervalSeconds` / `minAgeSeconds` / `maxAttempts` | true / 60 / 60 / 8 | Background sweeper |
| `onEvent(event)` | — | Called after each status change commits |
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

## Events

`onEvent` receives `{ type, wager }`, where `type` is one of `wager.created`, `wager.accepted`,
`wager.staked`, `wager.won`, `wager.refunded`, `wager.cancelled` or `wager.failed`.

## Tables

`pvp_wagers`, `pvp_wallet_links` and `pvp_mock_pots`, created by `PVP_MIGRATIONS` (PostgreSQL 13+).

## Tests

```bash
npm test -w @lyricsflip-toolkit/server                   # Postgres (PVP_TEST_DATABASE_URL)
npm run test:integration -w @lyricsflip-toolkit/server   # + local Stellar network on :8000
```
