# Architecture

## Components

| Component | Responsibility | Trust |
|---|---|---|
| Player wallet | Signs the player's own stake transaction | Trusted by the player only |
| Game server (`apps/game-server` or yours) | Runs the game, decides the result | Trusted to report results honestly |
| `packages/server` | Wager state machine, settlement, reconciliation, wallet linking | Runs inside the game server |
| `packages/sdk` | Builds and submits contract calls, amount handling. Node and React Native. | Library, no state |
| `pvp-escrow` contract | Holds stakes, enforces who can be paid, enforces the timeout | Trustless: enforced on-chain |
| PostgreSQL | Accounts, sessions, wagers, wallet links, settlement records | Server-side |

## Wager lifecycle

```
pending ──accept──► awaiting_stakes ──both stakes──► staked ──settle──► settling ──► won
   │                      │                                                 │
   ├──► cancelled         └── stake window passes ──► settling (refund) ────┴──► refunded
   │   (declined, withdrawn, or not accepted in time)
   └──► failed ◄── anything reconciliation can't resolve (needs an operator)
```

| State | Meaning |
|---|---|
| `pending` | Proposed by player one. Player two has not accepted; no pot exists and nobody is asked to stake. |
| `awaiting_stakes` | Player two accepted, and the pot is open on-chain. Waiting for signed stakes. |
| `staked` | The pot confirms **both** stakes. The game may start. |
| `settling` | The server has recorded its intent (payout to a named winner, or refund) and submitted it; waiting for the pot to show the result. |
| `won` | The pot was paid to the winner. |
| `refunded` | Each stake was returned to whoever made it, by the server or by players after the timeout. |
| `cancelled` | Ended before any money moved. |
| `failed` | Needs an operator; `failureReason` says why. |

## Settlement rules

- Only the server triggers settlement. The toolkit's HTTP routes can't settle, refund or create a
  wager. `apps/game-server` settles when its own `game.session.finished` event fires, from scores it
  recorded itself.
- Player two must accept before a pot is opened or a stake is requested.
- A stake counts only once the pot shows it. A wager becomes `staked` only when the pot holds both.
- No network call happens inside a database transaction. The server records its intent, commits,
  submits to the network, then records the result.
- Every submission ends as `confirmed`, `pending` (outcome unknown) or `failed` (nothing changed). A
  `pending` outcome is never treated as success or failure.
- Reconciliation reads the pot, not just the transaction:
  - A resolved pot means `won`.
  - A refunded pot means `refunded`. If a payout was intended, this means the players reclaimed their
    stakes after the timeout, so a refund really did happen.
  - A pot that is still staked means the intended call is retried. The contract refuses to pay twice.
  - Anything inconsistent goes to `failed`.
- A background reconciler (Postgres advisory lock, one instance at a time) sweeps unfinished wagers.
  It opens pots whose `open_pot` outcome was lost, syncs pending stakes, cancels expired invitations,
  refunds wagers whose stake window passed, and finishes interrupted settlements.

## Timeouts

Each pot carries a `deadline_ledger` (`potTimeoutLedgers`, default about a day). After it passes, the
contract refuses new stakes, and each player can call `claim_refund` to recover their own stake without
the server. Once anyone has claimed, `resolve` is refused for that pot.

## Modes

| Variable | Values | Notes |
|---|---|---|
| `STELLAR_SETTLEMENT_MODE` | `mock` (default), `stellar` | `mock` keeps pots in Postgres (`pvp_mock_pots`) with the contract's rules, and no tokens move. `stellar` calls the deployed contract. |
| `STELLAR_CUSTODY_MODE` | `non-custodial` (default), `custodial` | `custodial` is refused on `public`. `packages/server` supports it through a `custodialPlayerSecret` callback. `apps/game-server` doesn't provide one, so there it behaves as non-custodial. |

## Where game state lives

Game rounds live in PostgreSQL only. The on-chain game contract that used to duplicate rounds
stays in the `lyricsflip` repository and is not part of this toolkit.
