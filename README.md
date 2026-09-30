<p align="center">
  <img src="assets/LyricsFlipLogo.svg" alt="LyricsFlip" width="120" />
</p>

# lyricsflip-toolkit

**Settlement toolkit for head-to-head games on Stellar.**
Your game server decides who won. A Soroban escrow contract holds both stakes and pays the winner,
and it is built so that even a compromised server can't drain it.
[LyricsFlip](https://github.com/Stellar-songifi/lyricsflip), a lyrics-guessing card game, is the reference game.

> **Status: working, unaudited.** Settlement runs end to end in `mock` mode and against a real Soroban
> network in `stellar` mode, but nothing here has been audited. Do not use it with real value yet.
> The status table below shows what is done and what is planned.

---

## Contents

- [Why this exists](#why-this-exists)
- [What's in the toolkit](#whats-in-the-toolkit)
- [Status](#status)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Security model](#security-model)
- [When to use something else](#when-to-use-something-else)
- [Docs](#docs)
- [Contributing](#contributing)
- [History and related repositories](#history-and-related-repositories)

## Why this exists

Most competitive games can't run their gameplay on-chain: it's too fast, too complex, or depends on
off-chain data. But players still want stakes they can trust. That leaves a hard gap between an
off-chain game server that knows the result and on-chain money that must move correctly:

- Who is allowed to declare the winner, and what stops them from paying someone else?
- What happens if the server crashes halfway through a payout?
- What if the server disappears while funds are locked?
- How do you link a player account to exactly one wallet?

lyricsflip-toolkit packages the answers LyricsFlip built for these questions so any Stellar PvP
game can reuse them.

## What's in the toolkit

| Part | What it is |
|---|---|
| `contracts/pvp-escrow` | Soroban contract: one pot per match, keyed by the wager's UUID. The resolver can only pay a player who staked in that pot, and after a timeout players can reclaim their own stakes. |
| `packages/sdk` | TypeScript client for the contract: builds unsigned stake and timeout-claim transactions for the player's wallet, and handles amounts as stroop strings, never floats. Runs in Node and React Native. |
| `packages/server` | NestJS module: wager state machine, server-side settlement, crash-safe reconciliation, SEP-10 wallet linking. |
| `apps/game-server` | The LyricsFlip game backend (lyrics, solo, rooms, head-to-head, daily challenge, XP, push notifications), built on `packages/server`. |
| `apps/mobile` | LyricsFlip for iOS and Android, built with Expo (React Native). |
| `examples/coin-flip` | The smallest possible game using the toolkit. |

## Status

| Item | State |
|---|---|
| Escrow contract: atomic constructor, open pot, stake, resolve, refund | Implemented |
| Contract timeout: players reclaim their own stakes with `claim_refund` | Implemented |
| Wager state machine, explicit accept by player two, SEP-10 wallet linking | Implemented |
| Server-only settlement trigger (no client route settles) | Implemented |
| Crash-safe reconciliation against the pot, with a background sweeper | Implemented |
| Settlement in `mock` mode (pots in Postgres, no tokens move) | Implemented |
| Settlement in `stellar` mode (real Soroban calls, non-custodial and testnet custodial) | Implemented; integration-tested on a local network |
| `packages/sdk` (Node and React Native) and `packages/server` | Implemented |
| Expo mobile app, v1 (testnet device wallet, free test token) | Implemented; bundles for Android, not yet run on a device in CI |
| Passkey smart wallet on mobile | **Planned** — see [`docs/wallet-spike.md`](docs/wallet-spike.md) |
| `examples/coin-flip` | Implemented |
| Security audit | Not started |

## How it works

```
 Player A (wallet)      Player B (wallet)
        │  sign stake XDR      │  sign stake XDR
        ▼                      ▼
 ┌────────────────────────────────────────┐
 │  Your game server + packages/server    │
 │  decides the result, drives the wager  │
 └───────────────┬────────────────────────┘
                 │ open_pot / resolve / refund
                 ▼
 ┌────────────────────────────────────────┐
 │  pvp-escrow (Soroban)                  │
 │  holds both stakes, pays only a player │
 └────────────────────────────────────────┘
```

A wager moves through `pending → awaiting_stakes → staked → settling → won | refunded`, with
`failed` for anything that needs an operator.

1. **Open.** The server opens a pot for the match and asks each player to stake.
2. **Stake.** Each player signs their own stake transaction in their wallet (non-custodial by default).
   The wager becomes `staked` only when both stakes are confirmed.
3. **Play.** The game runs off-chain as normal.
4. **Settle.** When the match ends, the server alone calls `resolve` with the winner. The contract
   refuses any winner who is not a player in that pot.
5. **Recover.** If the server crashes mid-payout, the wager stays in `settling` with a transaction hash,
   and reconciliation resolves it against the ledger. The server never makes a network call inside a
   database transaction, because a database rollback can't undo a submitted Stellar transaction.

## Repository layout

```
lyricsflip-toolkit/
├── contracts/pvp-escrow/   # Soroban escrow contract
├── packages/sdk/           # TypeScript contract client
├── packages/server/        # NestJS settlement module
├── apps/game-server/       # LyricsFlip backend
├── apps/mobile/            # LyricsFlip Expo app
├── examples/coin-flip/     # minimal example game
├── docs/                   # architecture, integration, threat model
└── .github/workflows/      # CI
```

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- For contract work: Rust (see `.tool-versions`), the `wasm32v1-none` target, and the
  [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)
- For mobile: the Expo toolchain and an iOS simulator or Android emulator

### Clone

```bash
git clone https://github.com/Stellar-songifi/lyricsflip-toolkit.git
cd lyricsflip-toolkit
npm install
```

### Contracts

```bash
cd contracts
cargo test
stellar contract build
```

### Game server

```bash
cd apps/game-server
cp .env.example .env        # set DB_*, JWT_SECRET, PORT
npm run migration:run
npm run start:dev
```

Settlement defaults to `STELLAR_SETTLEMENT_MODE=mock`, which needs no Stellar setup.

### Mobile

```bash
cd apps/mobile
npx expo start
```

Full setup, including env variables and testnet deployment, is in
[`docs/integration-guide.md`](docs/integration-guide.md).

## Security model

- The resolver key can choose a winner, but **only a player who staked in that pot**.
  A compromised server can pick the wrong one of the two players, but can't send funds anywhere else.
- Refunds only return each stake to whoever made it.
- Players sign their own stakes by default; the server never holds their keys.
- Custodial mode is refused on Stellar mainnet.

Read [`docs/threat-model.md`](docs/threat-model.md) for what the toolkit does and does not protect against.

## When to use something else

If your use case is milestone-based payments, marketplaces or freelance work rather than a
two-player match, a general escrow service may fit better.
See [`docs/alternatives.md`](docs/alternatives.md).

## Docs

- [`docs/architecture.md`](docs/architecture.md) — components and the wager lifecycle
- [`docs/integration-guide.md`](docs/integration-guide.md) — add stakes to your own game
- [`docs/threat-model.md`](docs/threat-model.md) — trust assumptions and attack scenarios
- [`docs/alternatives.md`](docs/alternatives.md) — other Stellar escrow options
- [`docs/mobile.md`](docs/mobile.md) — the Expo app
- [`docs/design-handoff.md`](docs/design-handoff.md) — LyricsFlip colours and typography

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. In short: branch off `main`,
keep PRs small, run the tests, and run `cargo fmt` for contract changes.

## History and related repositories

This repository started as a merge of the LyricsFlip monorepo and
[`Lyricsflip_server`](https://github.com/Stellar-songifi/Lyricsflip_server), and is being restructured
into a toolkit. Earlier code remains in git history.

- [`lyricsflip`](https://github.com/Stellar-songifi/lyricsflip) — the LyricsFlip web game and its game contracts
- [`Lyricsflip_server`](https://github.com/Stellar-songifi/Lyricsflip_server) — the original standalone server
