# onchain

A Cargo workspace of Soroban smart contracts for LyricsFlip. All three contracts share one `soroban-sdk` version and release profile, pinned once in [`Cargo.toml`](Cargo.toml).

| Contract                                          | Purpose                                                   | Key entry points                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`lyricsflip`](contracts/lyricsflip)               | Rounds, cards, answers, player stats and roles            | `create_round`, `join_round`, `start_round`, `next_card`, `submit_answer`, `add_card` |
| [`lyricsflip-nft`](contracts/lyricsflip-nft)       | Reward NFTs; only the configured minter can mint          | `mint`, `owner_of`, `token_count`                                                      |
| [`lyricsflip-escrow`](contracts/lyricsflip-escrow) | One wager pot per game session, keyed by the session UUID | `initialize`, `open_pot`, `stake`, `resolve`, `refund`, `set_resolver`                 |

The escrow's resolver key can pick a winner but can only pay a player who is already in that pot, and refunds only ever return each stake to whoever made it — a compromised backend key can choose the wrong winner but can't drain the contract.

## Prerequisites

- Rust — version pinned in [`.tool-versions`](../.tool-versions) at the repo root
- The `wasm32v1-none` target: `rustup target add wasm32v1-none`
- The [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)

## Build

```bash
cd onchain
cargo build --target wasm32v1-none --release
```

Wasm binaries land in `target/wasm32v1-none/release/`.

## Test

```bash
cargo fmt --check
cargo test --workspace
```

## Deploy (testnet example)

```bash
stellar keys generate deployer --network testnet --fund

stellar contract deploy \
  --wasm target/wasm32v1-none/release/lyricsflip.wasm \
  --source deployer \
  --network testnet

stellar contract deploy \
  --wasm target/wasm32v1-none/release/lyricsflip_nft.wasm \
  --source deployer \
  --network testnet

stellar contract deploy \
  --wasm target/wasm32v1-none/release/lyricsflip_escrow.wasm \
  --source deployer \
  --network testnet
```

Each `deploy` prints a contract ID. Wire those into:

| Contract ID             | Goes into                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `lyricsflip`            | `NEXT_PUBLIC_LYRICSFLIP_CONTRACT_ID` (frontend)                                                 |
| `lyricsflip-nft`        | `NEXT_PUBLIC_LYRICSFLIP_NFT_CONTRACT_ID` (frontend)                                             |
| Escrow, token, resolver | `STELLAR_ESCROW_CONTRACT_ID`, `STELLAR_TOKEN_CONTRACT_ID`, `STELLAR_RESOLVER_SECRET` (backend) |

The wager token is either a Soroban token contract or a classic asset's Stellar Asset Contract (`stellar contract asset deploy`); no token contract lives in this repo.

## Known gaps

- `lyricsflip` stores a `wager_amount` on each round but never sets it to anything but `0`, and moves no tokens. Real stakes go through `lyricsflip-escrow`.
- `lyricsflip-nft` only lets its configured minter mint, and the `lyricsflip` game contract never calls `mint` — reward NFTs can't be issued yet until either the game contract mints on a win or a backend key is made the minter.
