# Architecture

> Describes the target design. Anything marked **(planned)** is not built yet.

## Components

| Component | Responsibility | Trust |
|---|---|---|
| Player wallet | Signs the player's own stake transaction | Trusted by the player only |
| Game server (`apps/game-server` or yours) | Runs the game, decides the result | Trusted to report results honestly |
| `packages/server` | Wager state machine, settlement, reconciliation, wallet linking | Runs inside the game server |
| `packages/sdk` (planned) | Builds and submits contract calls, amount handling | Library, no state |
| `pvp-escrow` contract | Holds stakes, enforces who can be paid | Trustless: enforced on-chain |
| PostgreSQL | Accounts, sessions, wagers, settlement records | Server-side |

## Wager lifecycle

```
pending ──► awaiting_stakes ──► staked ──► settling ──► won
   │               │                          │
   │               └──► refunded ◄────────────┘ (timeout or cancel)
   └──► failed (needs an operator)
```

| State | Meaning |
|---|---|
| `pending` | Match created with a stake; player two has not accepted yet |
| `awaiting_stakes` | Both players accepted; pot opened; waiting for signed stakes |
| `staked` | **Both** stakes confirmed |
| `settling` | Server submitted `resolve` or `refund`; waiting for the ledger |
| `won` | Pot paid to the winner |
| `refunded` | Each stake returned to whoever made it |
| `failed` | Something needs an operator; see reconciliation |

## Settlement rules

- Only the server triggers settlement, once the session is finished. Clients never do. **(planned fix)**
- No network call happens inside a database transaction. The server records its intent, commits,
  then submits to the network, then records the result.
- A crash between submit and record leaves the wager in `settling` with a transaction hash.
  Reconciliation looks the hash up on the ledger and moves the wager to its true final state.

## Modes

| Variable | Values | Notes |
|---|---|---|
| `STELLAR_SETTLEMENT_MODE` | `mock` (default), `stellar` | `mock` keeps balances in Postgres. `stellar` is **(planned)** — currently a stub. |
| `STELLAR_CUSTODY_MODE` | `non-custodial` (default), `custodial` | `custodial` is refused on `public`. |

## Where game state lives

Game rounds live in PostgreSQL only. The on-chain game contract that used to duplicate rounds
stays in the `lyricsflip` repository and is not part of this toolkit.
