<p align="center">
  <img src="assets/LyricsFlipLogo.svg" alt="LyricsFlip" width="160" />
</p>

<h1 align="center">LyricsFlip</h1>

<p align="center">
  A lyrics-guessing card game on Stellar. See a snippet, name the song or the artist before the card flips — solo, in a room, or head-to-head for a stake settled by a Soroban escrow contract.
</p>

---

## Contents

- [How it plays](#how-it-plays)
- [Project status](#project-status)
- [Repository layout](#repository-layout)
- [How the pieces fit together](#how-the-pieces-fit-together)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Smart contracts](#smart-contracts)
- [Wagers and settlement](#wagers-and-settlement)
- [Testing and CI](#testing-and-ci)
- [Known gaps](#known-gaps)
- [Design and docs](#design-and-docs)
- [Contributing](#contributing)
- [History and related repositories](#history-and-related-repositories)

## How it plays

Each card shows a lyric snippet tagged with an artist, title, genre and decade. You guess either the **song title** or the **artist** before the 15-second timer runs out. Guesses are matched fuzzily, so a near-miss can still earn partial points.

| Outcome               | Points         |
| --------------------- | -------------- |
| Correct guess         | 100            |
| Partial match         | 50             |
| Streak bonus          | 25             |
| Difficulty multiplier | ×1 / ×1.5 / ×2 |

Correct guesses earn XP, which moves players through five levels, from *Gossip Rookie* to *Gossip Guru* (thresholds in [`backend/README.md`](backend/README.md)).

There are three ways to play:

- **Solo** — fetch a snippet, submit a guess, get scored.
- **Rooms** — everyone in a room guesses against the same snippet before it expires.
- **Head-to-head** — two players in one session, optionally with an equal stake each; the winner takes the pot.

## Project status

LyricsFlip is under active development. This table reflects what is in the code, not the roadmap.

| Feature                                                  | Lives in                     | State                                                          |
| -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Lyric cards with a 15-second timer                       | `frontend`                   | Implemented                                                    |
| Wallet connect (Freighter, xBull, Albedo, Lobstr, Hana)  | `frontend`                   | Implemented                                                    |
| Solo play and fuzzy scoring                              | `backend`                    | Implemented                                                    |
| Shared rooms                                             | `backend`                    | Implemented                                                    |
| XP, levels and leaderboard (`GET /users/leaderboard`)    | `backend`                    | Implemented                                                    |
| SEP-10 wallet login                                      | `backend`                    | Implemented server-side; not yet wired into the frontend       |
| Head-to-head wagers with escrow                          | `backend`, `onchain`         | Implemented server-side; frontend staking flow not yet wired   |
| On-chain rounds, cards and answers                       | `onchain/lyricsflip`         | Implemented; the round's wager amount is always 0              |
| NFT rewards                                              | `onchain/lyricsflip-nft`     | Contract implemented; nothing mints yet                        |
| Invite codes for challenges                              | `frontend`                   | UI exists; no matching backend endpoint                        |
| Notifications                                            | `backend`                    | In-memory only; cleared on restart                             |
| Confetti on a correct guess                              | `frontend`                   | Not implemented                                                |

See [Known gaps](#known-gaps) for the detail behind each partial item.

## Repository layout

```
lyricsflip/
├── frontend/                   # Next.js web app
├── backend/                    # NestJS API + Socket.IO gateway
├── onchain/                    # Cargo workspace of Soroban contracts
│   └── contracts/
│       ├── lyricsflip/         # rounds, cards, answers, player stats
│       ├── lyricsflip-nft/     # minter-gated reward NFTs
│       └── lyricsflip-escrow/  # per-session wager pots
├── docs/                       # design handoff and project docs
├── assets/                     # logo files
└── .github/workflows/          # CI for onchain and backend
```

Each package has its own README with the full detail:

- [`frontend/README.md`](frontend/README.md)
- [`backend/README.md`](backend/README.md) — modules, full API table, wager lifecycle, migrations
- [`onchain/README.md`](onchain/README.md) — contract build, test and deploy

## How the pieces fit together

```
                ┌──────────────────────────┐
                │   frontend (Next.js)     │
                └───────┬──────────┬───────┘
          REST + Socket.IO        │ Stellar Wallets Kit
                        │          │ (player signs)
                ┌───────▼──────┐   │
                │   backend    │   │
                │   (NestJS)   │   │
                └──┬────────┬──┘   │
                   │        │      │
          ┌────────▼──┐  ┌──▼──────▼──────────────────────┐
          │ PostgreSQL│  │ Soroban RPC                    │
          └───────────┘  │  lyricsflip · lyricsflip-nft · │
                         │  lyricsflip-escrow             │
                         └────────────────────────────────┘
```

- **PostgreSQL** holds accounts, lyrics, sessions, guess history and XP.
- **The backend** talks to the **escrow** contract to open pots, collect stakes and pay out. In non-custodial mode it builds unsigned transactions and the player's wallet signs them.
- **The frontend** holds contract clients for **lyricsflip** and **lyricsflip-nft** and signs through the connected wallet.

> **Open design question:** game rounds currently exist in two places — as `GameSession` rows in Postgres and as rounds inside the `lyricsflip` contract. Decide which is the source of truth before building features that depend on both.

## Tech stack

| Layer     | Stack                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend  | Next.js 14 (App Router), React 18, Tailwind CSS, Radix UI, Zustand, TanStack Query, Framer Motion, Socket.IO client, Stellar Wallets Kit, `@stellar/stellar-sdk`      |
| Backend   | NestJS 11, TypeORM, PostgreSQL, Socket.IO, `@nestjs/event-emitter`, `@stellar/stellar-sdk`, Swagger                                                                  |
| Contracts | Rust (version pinned in `.tool-versions`), `soroban-sdk` pinned once in `onchain/Cargo.toml`, `wasm32v1-none` target                                                  |
| Hosting   | Frontend on Vercel; backend on AWS, Heroku or Render; contracts on Stellar                                                                                          |

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- For contract work: Rust (see `.tool-versions`), the `wasm32v1-none` target, and the [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)

### 1. Clone

```bash
git clone https://github.com/Stellar-songifi/lyricsflip.git
cd lyricsflip
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env        # set DB_*, JWT_SECRET, and a single PORT=3001
createdb lyricflip          # must match DB_NAME in .env
npm run migration:run
npm run seed                # optional sample data
npm run start:dev
```

The API runs on `http://localhost:3001` and Swagger UI is at `http://localhost:3001/api/docs`.

Settlement defaults to `STELLAR_SETTLEMENT_MODE=mock`, which keeps balances in Postgres and needs no Stellar setup, so you can build gameplay without deploying anything.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The app runs on `http://localhost:3000`.

> **Ports:** Next.js and NestJS both default to 3000. Run the backend on 3001 and point `NEXT_PUBLIC_API_URL` at it.

### 4. Contracts (optional)

Only needed if you're changing contracts or running wagers in `stellar` mode.

```bash
rustup target add wasm32v1-none
cd onchain
cargo test
cargo build --target wasm32v1-none --release
```

## Configuration

### Frontend — `frontend/.env.local`

| Variable                                 | Purpose                            | Code default                          |
| ----------------------------------------- | ----------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_API_URL`                    | Backend origin                     | `http://localhost:3000/api`           |
| `NEXT_PUBLIC_STELLAR_RPC_URL`            | Soroban RPC endpoint               | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network passphrase                 | `Test SDF Network ; September 2015`   |
| `NEXT_PUBLIC_LYRICSFLIP_CONTRACT_ID`     | Deployed `lyricsflip` contract     | none                                  |
| `NEXT_PUBLIC_LYRICSFLIP_NFT_CONTRACT_ID` | Deployed `lyricsflip-nft` contract | none                                  |

Always set `NEXT_PUBLIC_API_URL` to the backend origin with no path, e.g. `http://localhost:3001`. The backend has no global route prefix, so the code default's `/api` path doesn't exist.

### Backend — `backend/.env`

`backend/.env.example` documents every variable. The ones you can't skip:

| Variable                                                      | Purpose                                                |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Primary database; boot fails if any is missing         |
| `DB_REPLICA_*`                                                | Optional read replica; each falls back to the primary  |
| `JWT_SECRET`, `JWT_EXPIRES_IN`                                | Token signing                                          |
| `PORT`, `FRONTEND_URL`, `NODE_ENV`                            | HTTP port, CORS origin, environment                    |
| `STELLAR_SETTLEMENT_MODE`                                     | `mock` (default) or `stellar`                          |
| `STELLAR_CUSTODY_MODE`                                        | `non-custodial` (default) or `custodial`               |

Other `STELLAR_*` variables are only read in `stellar` mode and are validated at boot. `custodial` combined with `STELLAR_NETWORK=public` is refused at boot.

## Smart contracts

All three contracts live in one Cargo workspace under `onchain/`, sharing a single `soroban-sdk` version and release profile.

| Contract            | Purpose                                                   | Key entry points                                                                      |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lyricsflip`        | Rounds, cards, answers, player stats and roles            | `create_round`, `join_round`, `start_round`, `next_card`, `submit_answer`, `add_card` |
| `lyricsflip-nft`    | Reward NFTs; only the configured minter can mint          | `mint`, `owner_of`, `token_count`                                                     |
| `lyricsflip-escrow` | One wager pot per game session, keyed by the session UUID | `initialize`, `open_pot`, `stake`, `resolve`, `refund`, `set_resolver`                |

The escrow's resolver key can pick a winner but can only pay a player in that pot, and refunds only return each stake to whoever made it. A compromised backend key can choose wrongly but can't drain escrow.

Deploy commands are in [`onchain/README.md`](onchain/README.md). Once deployed, wire the IDs in:

| Contract ID          | Goes into                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `lyricsflip`         | `NEXT_PUBLIC_LYRICSFLIP_CONTRACT_ID` (frontend)                                               |
| `lyricsflip-nft`     | `NEXT_PUBLIC_LYRICSFLIP_NFT_CONTRACT_ID` (frontend)                                           |
| Escrow, token, resolver | `STELLAR_ESCROW_CONTRACT_ID`, `STELLAR_TOKEN_CONTRACT_ID`, `STELLAR_RESOLVER_SECRET` (backend) |

The wager token is either a Soroban token contract or a classic asset's Stellar Asset Contract; no token contract lives in this repo. After switching the backend to `STELLAR_SETTLEMENT_MODE=stellar`, compare `GET /stellar/info` against what you deployed before letting players in.

## Wagers and settlement

A wagered session escrows an equal stake from both players and pays the whole pot to the winner. Amounts are carried as strings in stroops (7 decimal places), so no amount ever passes through a float.

In the default non-custodial mode, funding a pot takes two round trips: creating the session opens the pot and returns one unsigned transaction per player, and each player signs theirs in their wallet and posts it back. A wager moves through `pending → awaiting_stakes → staked → settling → won | refunded`, with `failed` for anything that needs an operator.

The backend never makes a network call inside a database transaction, because a Postgres rollback can't un-submit a Stellar transaction. A crash mid-payout leaves the wager in `settling` with a transaction hash, and an admin reconcile endpoint resolves it against the ledger.

Both players must link and verify a wallet before joining a wagered match. The full lifecycle and endpoints are in [`backend/README.md`](backend/README.md).

## Testing and CI

```bash
# Backend (unit tests need no database)
cd backend && npm test
npm run test:e2e             # needs a database

# Frontend
cd frontend && npm test

# Contracts
cd onchain && cargo fmt --check && cargo test
```

CI runs on pushes to `main` and on pull requests:

- `.github/workflows/onchain.yml` — `cargo fmt --check`, a `wasm32v1-none` release build, and `cargo test`
- `.github/workflows/backend.yml` — `npm ci`, `npm run build`, `npm test` (only when `backend/` changes)

The frontend has no CI job yet.

## Known gaps

Good first issues, all checked against the code.

**Frontend ↔ backend integration**

- The frontend doesn't yet call the backend's wallet-auth (`/auth/stellar/*`), game-session or staking endpoints.
- The Socket.IO client connects to a hardcoded `ws://localhost:3000` and emits `player_join`. The backend gateway lives on the `/game` namespace and handles `requestLyric`, `submitGuess` and `getSession`.
- In the browser, `stellarConfig.ts` reads settings from `window.__ENV`, but nothing sets `window.__ENV`. Client-side code therefore gets the testnet defaults and empty contract IDs regardless of `.env.local`.
- `backend/src/main.ts` calls `app.enableCors()` after `app.listen()`. CORS middleware is normally registered before listening, so cross-origin requests from the frontend may be rejected until that call is moved up.

**Contracts**

- `lyricsflip-nft` only lets its minter mint, and the `lyricsflip` game contract never calls `mint`, so reward NFTs can't be issued until either the game contract mints or a backend key is made the minter.
- `lyricsflip` stores a `wager_amount` on each round but always sets it to 0 and moves no tokens. Real stakes go through `lyricsflip-escrow`.

**Backend**

- There is no endpoint behind the frontend's challenge invite codes.
- Notifications are held in memory and lost on restart.
- `backend/.env.example` sets `PORT` twice and still includes an unused `DATABASE_URL`.

## Design and docs

- [Figma — game design](https://www.figma.com/design/6phOWkHKQgLRhRwmBBQDXB/LyricsFlip?node-id=0-1&t=0U8SlbaJijr7XNeG-1)
- [Figma — contributors page](https://www.figma.com/design/cUgNi0Ck7HS6QHLim7xOTY/Projects?node-id=89-259&t=VGBgLi8VhPgV9N5u-1)
- [Notion documentation](https://www.notion.so/LyricFlip-Documentation-188644d19c538007af9be7fafb912b9c?pvs=4)
- [`docs/design-handoff.md`](docs/design-handoff.md) — colours and typography for auth screens

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. The short version:

- Branch off `main`; never push to it directly.
- Keep PRs small and focused, and explain what changed and why.
- Test before you open a PR, and run `cargo fmt` for contract changes.
- If an issue is tagged for an event, applying for it before the event starts disqualifies you from that issue.

Questions go in GitHub Issues or Discussions.

## History and related repositories

This repository combines the original LyricsFlip monorepo with the standalone [`lyricsflip_server`](https://github.com/songifi/lyricsflip_server) repository. The server's full commit history was merged into `backend/`, and its escrow contract moved into `onchain/`. The previous NestJS 10 backend was removed but remains in git history.

- [LyricsFlip Mobile](https://github.com/songifi/lyricsflip_mobile) — the mobile app is being migrated into its own repository.
