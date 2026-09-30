# Contributing to lyricsflip-toolkit

Thanks for taking the time to contribute. This repository is an npm workspace plus a Cargo workspace — pick the part your change belongs to and read its README before diving in:

- [`contracts/README.md`](contracts/README.md) — the `pvp-escrow` Soroban contract
- [`packages/sdk/README.md`](packages/sdk/README.md) — the TypeScript contract client (Node and React Native)
- [`packages/server/README.md`](packages/server/README.md) — the NestJS settlement module
- [`apps/game-server/README.md`](apps/game-server/README.md) — the LyricsFlip game server
- [`apps/mobile/README.md`](apps/mobile/README.md) — the Expo app
- [`examples/coin-flip/README.md`](examples/coin-flip/README.md) — the minimal example game

Anything under `packages/` is the toolkit and must stay game-agnostic: no lyrics, rooms or LyricsFlip in
its public API.

## Workflow

- Branch off `main`; never push to it directly.
- Keep pull requests small and focused on one change. Explain **what** changed and **why** in the description.
- Reference the issue you're closing, if any.
- Test before you open a PR:
  - `npm install && npm run build && npm test` from the repository root (needs Postgres; see
    `PVP_TEST_DATABASE_URL`)
  - `npm run test:e2e` if you touched the game server
  - `npm run test:integration -w @lyricsflip-toolkit/server` if you touched settlement or the contract
    (needs a local `stellar/quickstart` network)
  - `npm run lint -w @lyricsflip-toolkit/mobile` and `npm test -w @lyricsflip-toolkit/mobile` for app changes
  - `cd contracts && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test`
- Never commit secrets or `.env` files, and never point development or tests at mainnet.
- Run `cargo fmt` for any contract change — CI fails on unformatted Rust.

## Claiming issues

- If an issue is tagged for an event (a hackathon, a bounty round), applying for it before the event starts disqualifies you from that issue.
- Comment on the issue before starting work so two people don't duplicate effort.

## Commit messages

Keep the first line short and imperative ("Add SEP-10 login endpoint", not "Added" or "Adding"). Add detail in the body if the change needs it.

## Questions

Open a GitHub Issue or start a Discussion — don't DM maintainers directly for support questions.
