# game-server

The LyricsFlip game server: NestJS 11, TypeORM/PostgreSQL, and a Socket.IO gateway for live play.
Stakes and settlement come from [`@lyricsflip-toolkit/server`](../../packages/server).

## Modules

| Module | Path | Responsibility |
|---|---|---|
| `auth` | `src/modules/auth` | SEP-10 sign-in (via the toolkit's `Sep10Service`), JWT issuance, `JwtAuthGuard` |
| `users` | `src/modules/users` | Accounts, XP and levels, usernames, leaderboard |
| `lyrics` | `src/modules/lyrics` | The lyric snippet bank |
| `game` | `src/modules/game` | Sessions (solo, room, head-to-head), fuzzy scoring, the `/game` gateway; emits `game.session.finished` |
| `challenges` | `src/modules/challenges` | Invite codes that start a head-to-head session, and its wager if staked |
| `settlement` | `src/modules/settlement` | Mounts `PvpSettlementModule`; settles wagers when a session finishes; starts staked sessions |
| `daily` | `src/modules/daily` | The daily challenge: five shared lyrics per UTC day, one guess each |
| `notifications` | `src/modules/notifications` | Per-user notifications, with push for invites, stake requests and results |
| `push` | `src/modules/push` | Expo push-token registration and delivery |
| `faucet` | `src/modules/faucet` | Free test stake token, only in `stellar` mode on a test network |

## XP and levels

| Level | Min XP |
|---|---|
| Gossip Rookie | 0 |
| Gossip Regular | 500 |
| Gossip Insider | 1,500 |
| Gossip Virtuoso | 3,500 |
| Gossip Guru | 7,500 |

Thresholds live in [`src/modules/users/entities/user.entity.ts`](src/modules/users/entities/user.entity.ts).

## Scoring

| Outcome | Points |
|---|---|
| Correct guess | 100 |
| Partial match | 50 |
| Streak bonus | +25 (on a correct guess, if the player already had a streak in this session) |
| Difficulty multiplier | ×1 (easy) / ×1.5 (medium) / ×2 (hard), applied to the sum above |

A guess is scored against both the lyric's title and its artist, whichever classifies better, using a
normalised Levenshtein distance. See [`src/modules/game/scoring.ts`](src/modules/game/scoring.ts).

## API

Routes are unprefixed. Everything except sign-in, `/health`, `/users/leaderboard` and `/users/:id`
needs `Authorization: Bearer <JWT>`. The user is always taken from the token, never from a request
body.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/auth/stellar/challenge` | SEP-10 challenge for `{ walletAddress }` |
| POST | `/auth/stellar/verify` | Verify the signed challenge; returns `{ accessToken, user }` and links the wallet |
| GET | `/users/me` · PATCH `/users/me` | Your profile with next-level XP · change username |
| GET | `/users/leaderboard` · `/users/:id` | Top players by XP · a profile |
| POST | `/game/sessions` | Start a `solo` or `room` session (head-to-head starts from `/challenges`) |
| POST | `/game/sessions/:id/join` | Join a room |
| GET | `/game/sessions/:id` · `/game/sessions/:id/lyric` | Session state · current card (answer hidden) |
| POST | `/game/guess` | `{ sessionId, guess }` |
| POST | `/challenges` | `{ stakeAmount?, opponentUsername? }`; the named opponent gets a push with the deep link |
| GET | `/challenges/:code` | Status and stake, shown before accepting |
| POST | `/challenges/:code/accept` | Accept, which also accepts the wager if staked. Returns `{ gameSessionId, wagerId }`. |
| GET | `/daily` · POST `/daily/guess` · GET `/daily/leaderboard` | The daily challenge |
| GET | `/notifications` · POST `/notifications/:id/read` | Your notifications |
| POST | `/push-tokens` · DELETE `/push-tokens/:token` | Register or remove an Expo push token |
| GET | `/faucet` · POST `/faucet` | Test-token faucet (test networks only) |
| — | `/wagers/*`, `/wallet/*` | From the toolkit; see [`packages/server/README.md`](../../packages/server/README.md) |

There is no route that settles, refunds or reconciles a wager. Full schemas are in Swagger UI at
`/api/docs`.

The Socket.IO gateway is on the `/game` namespace. Connect with `auth: { token: <JWT> }`.

| Event | Direction | Payload |
|---|---|---|
| `requestLyric` | client → server | `{ sessionId }` (players of the session only) |
| `submitGuess` | client → server | `{ sessionId, guess }` |
| `getSession` | client → server | `{ sessionId }` |
| `lyric` | server → client | The current card (answer hidden) |
| `guessResult` | server → client | `{ outcome, pointsAwarded, streak, nextLyric, sessionStatus }` |
| `scoreUpdate` | server → room | `{ sessionId, userId, pointsAwarded }` |
| `sessionFinished` | server → room | `{ sessionId }` |

## A staked head-to-head match

1. The host creates a challenge with a `stakeAmount` in stroops, optionally naming an opponent.
2. The opponent opens it (`GET /challenges/:code` shows the stake) and accepts. That creates a
   `waiting` session and a wager, and accepts the wager as player two, which opens the pot.
3. Both players stake through `/wagers/:id/stake-transaction` and `/wagers/:id/stake`. When the pot holds
   both stakes, the toolkit emits `wager.staked` and the session becomes `active`.
4. When the last round is scored, `GameService` emits `game.session.finished`. `SettlementListener`
   decides the result from the recorded scores (higher score wins; a tie refunds) and calls
   `WagerService.settleMatch`.
5. Players get push notifications for the result. If the wager is cancelled or refunded before play,
   the session is cancelled.

## Configuration

See [`.env.example`](.env.example). The Stellar settings are described in
[`docs/integration-guide.md`](../../docs/integration-guide.md#3-configure-the-server).

## Migrations

```bash
npm run migration:run       # the game's migrations, then the toolkit's (PVP_MIGRATIONS)
npm run migration:revert    # roll back one step
```

`packages/server` must be built first (`npm run build` at the repository root), because the data
source imports its migrations.

## Tests

```bash
npm test                    # unit
npm run test:e2e            # needs Postgres; E2E_DATABASE_URL (a fresh database is created)
```

## Known gaps

- Guess streaks and the daily-faucet cooldown are kept in memory. That's fine for one instance, not for
  horizontal scaling.
- Reward NFTs are out of scope here. They belong to `Stellar-songifi/lyricsflip`.
- `STELLAR_CUSTODY_MODE=custodial` has no player key store in this app, so it behaves as non-custodial.
