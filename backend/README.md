# backend

The LyricsFlip API: NestJS 11, TypeORM/PostgreSQL, a Socket.IO gateway for live play, and Stellar/Soroban settlement for wagers.

## Modules

| Module          | Path                          | Responsibility                                                        |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `auth`          | `src/modules/auth`            | SEP-10 wallet challenge/verify, JWT issuance                          |
| `users`         | `src/modules/users`           | Accounts, XP/level, leaderboard                                       |
| `lyrics`        | `src/modules/lyrics`          | The lyric snippet bank                                                |
| `game`          | `src/modules/game`            | Sessions (solo/room/head-to-head), fuzzy scoring, the `/game` gateway |
| `wager`         | `src/modules/wager`           | Wager state machine, calls into `stellar`                             |
| `stellar`       | `src/modules/stellar`         | Escrow contract calls; `mock` or `stellar` settlement                 |
| `notifications` | `src/modules/notifications`   | Per-user notifications, persisted to Postgres                         |
| `challenges`    | `src/modules/challenges`      | Short invite codes that spin up a head-to-head session (and its wager, if staked) on accept |

## XP and levels

| Level            | Min XP |
| ----------------- | ------ |
| Gossip Rookie    | 0      |
| Gossip Regular   | 500    |
| Gossip Insider   | 1,500  |
| Gossip Virtuoso  | 3,500  |
| Gossip Guru      | 7,500  |

Thresholds live in [`src/modules/users/entities/user.entity.ts`](src/modules/users/entities/user.entity.ts).

## Scoring

| Outcome               | Points         |
| --------------------- | -------------- |
| Correct guess         | 100            |
| Partial match         | 50             |
| Streak bonus          | +25 (on a correct guess, if the player already had a streak) |
| Difficulty multiplier | ×1 (easy) / ×1.5 (medium) / ×2 (hard), applied to the sum above |

A guess is scored against both the lyric's title and its artist (whichever classifies better) using a normalized Levenshtein distance — see [`src/modules/game/scoring.ts`](src/modules/game/scoring.ts).

## API

All routes are unprefixed (no global `/api` prefix — see the frontend's `NEXT_PUBLIC_API_URL` note in the [root README](../README.md#configuration)).

| Method | Path                            | Purpose                                     |
| ------ | -------------------------------- | --------------------------------------------- |
| GET    | `/health`                       | Liveness check                              |
| POST   | `/auth/stellar/challenge`       | Get a SEP-10 challenge transaction          |
| POST   | `/auth/stellar/verify`          | Verify a signed challenge, get a JWT        |
| GET    | `/users/leaderboard`            | Top players by XP                           |
| GET    | `/users/:id`                    | A player's profile                          |
| POST   | `/game/sessions`                | Start a solo/room/head-to-head session      |
| POST   | `/game/sessions/:id/join`       | Join a room or head-to-head session         |
| GET    | `/game/sessions/:id`            | Session state                               |
| GET    | `/game/sessions/:id/lyric`      | The session's current (title/artist-hidden) card |
| POST   | `/game/guess`                   | Submit a guess                              |
| GET    | `/stellar/info`                 | Current settlement/custody mode and contract IDs |
| POST   | `/wagers`                       | Open a wager pot for a head-to-head session |
| GET    | `/wagers/:id`                   | Wager state                                 |
| POST   | `/wagers/:id/stake`             | Record that a player's stake transaction landed |
| POST   | `/wagers/:id/settle`            | Pay the winner                              |
| POST   | `/wagers/:id/refund`            | Return both stakes                          |
| POST   | `/wagers/:id/reconcile`         | Admin: resolve a wager stuck in `settling`  |
| GET    | `/notifications/user/:userId`   | A player's notifications                    |
| POST   | `/notifications/:id/read`       | Mark a notification read                    |
| POST   | `/challenges`                   | Create an invite code, optionally staked (`hostUserId`, `stakeAmount?`) |
| GET    | `/challenges/:code`             | Poll a challenge's status                   |
| POST   | `/challenges/:code/accept`      | Accept a code — creates the session (and wager, if staked) |

Full request/response schemas are in Swagger UI at `/api/docs` once the server is running.

The Socket.IO gateway lives on the `/game` namespace and mirrors the REST game flow for live play:

| Event         | Direction       | Payload                                  |
| -------------- | ---------------- | ------------------------------------------- |
| `requestLyric` | client → server | `{ sessionId }`                           |
| `submitGuess`  | client → server | `{ sessionId, userId, guess }`            |
| `getSession`   | client → server | `{ sessionId }`                           |
| `lyric`        | server → client | The current public (title/artist-hidden) card |
| `guessResult`  | server → client | `{ outcome, pointsAwarded, streak, ... }` |
| `scoreUpdate`  | server → room   | Broadcast to everyone in the session       |

## Wager lifecycle

```
pending → awaiting_stakes → staked → settling → won
                                   └→ settling → refunded
                                   └→ failed (needs an operator)
```

1. `POST /wagers` opens a pot. In non-custodial mode (the default) this returns one unsigned funding transaction per player.
2. Each player signs their transaction in their wallet and the client posts it back; the backend calls `POST /wagers/:id/stake` once it sees the transaction land.
3. Once both players have staked, the wager is `staked` and ready to settle.
4. `POST /wagers/:id/settle` (or `/refund`) makes the on-chain call and moves to `won`/`refunded`, or leaves the wager in `settling` with whatever's known if the call fails partway.
5. `POST /wagers/:id/reconcile` is for an operator to resolve a `settling` wager by hand against the ledger.

Network calls to Stellar never happen inside a database transaction — see [`src/modules/wager/wager.service.ts`](src/modules/wager/wager.service.ts) for why.

Amounts are carried as strings in stroops throughout (7 decimal places) — never as floats.

`settle` is idempotent for a repeat call with the same `winnerId` — both players' clients may race to call it after a match ends, and the second call is a no-op rather than an error. In `mock` settlement mode (the default), staking and settling never touch the network, so the whole lifecycle works with no Stellar setup.

### Starting a wager: challenges

A wager always starts from a challenge, not directly from `POST /wagers`: `POST /challenges` with a `stakeAmount` creates an invite code that carries the stake, so the joiner never has to separately agree to an amount. Accepting the code (`POST /challenges/:code/accept`) creates the head-to-head `GameSession` and the `Wager` in one step and returns both ids. The host discovers this by polling `GET /challenges/:code` until `status` flips to `accepted`. A code expires 15 minutes after creation if unaccepted. An unstaked challenge (no `stakeAmount`) skips wager creation entirely — `wagerId` comes back `null`.

## Migrations

```bash
npm run migration:run       # apply
npm run migration:revert    # roll back one step
npm run migration:generate -- src/database/migrations/SomeChange   # after entity changes
```

The initial migration ([`src/database/migrations/1730000000000-InitSchema.ts`](src/database/migrations/1730000000000-InitSchema.ts)) creates `users`, `lyrics`, `game_sessions` and `wagers`. A second migration ([`src/database/migrations/1730000100000-AddChallengesAndNotifications.ts`](src/database/migrations/1730000100000-AddChallengesAndNotifications.ts)) adds `notifications` and `challenges`.

## Known gaps

- `game.module.ts`'s in-memory streak tracking resets on restart, same as any other in-process state — fine for a single instance, not for horizontal scaling.
- `lyricsflip-nft` reward NFTs are never minted — nothing in this backend calls the NFT contract's `mint` yet.
- Notifications have no delivery mechanism beyond polling `GET /notifications/user/:userId` — no push/websocket event fires when one is created.

See the [root README](../README.md#known-gaps) for the full list, including frontend-side gaps.
