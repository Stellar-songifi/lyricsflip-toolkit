# Contributing to lyricsflip-toolkit

Thanks for taking the time to contribute. This repository is an npm workspace plus a Cargo workspace — pick the part your change belongs to and read its README before diving in:

- [`contracts/README.md`](contracts/README.md) — the `pvp-escrow` Soroban contract
- [`apps/game-server/README.md`](apps/game-server/README.md) — the LyricsFlip game server

## Workflow

- Branch off `main`; never push to it directly.
- Keep pull requests small and focused on one change. Explain **what** changed and **why** in the description.
- Reference the issue you're closing, if any.
- Test before you open a PR:
  - `npm install && npm run build && npm test` from the repository root
  - `cd apps/game-server && npm run test:e2e` if you touched anything that hits the database
  - `cd contracts && cargo fmt --all -- --check && cargo test`
- Run `cargo fmt` for any contract change — CI fails on unformatted Rust.

## Claiming issues

- If an issue is tagged for an event (a hackathon, a bounty round), applying for it before the event starts disqualifies you from that issue.
- Comment on the issue before starting work so two people don't duplicate effort.

## Commit messages

Keep the first line short and imperative ("Add SEP-10 login endpoint", not "Added" or "Adding"). Add detail in the body if the change needs it.

## Questions

Open a GitHub Issue or start a Discussion — don't DM maintainers directly for support questions.
