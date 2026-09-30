# contracts

A Cargo workspace of Soroban smart contracts for lyricsflip-toolkit. The `soroban-sdk` version and
release profile are pinned once in [`Cargo.toml`](Cargo.toml).

| Contract | Purpose | Key entry points |
|---|---|---|
| [`pvp-escrow`](pvp-escrow) | One stake pot per head-to-head match, keyed by the session UUID | `initialize`, `open_pot`, `stake`, `resolve`, `refund`, `set_resolver` |

The resolver key can pick a winner but can only pay a player who is already in that pot, and refunds
only ever return each stake to whoever made it. A compromised server key can choose the wrong winner
but can't drain the contract.

The LyricsFlip game and NFT contracts live in
[`Stellar-songifi/lyricsflip`](https://github.com/Stellar-songifi/lyricsflip).

## Prerequisites

- Rust — version pinned in [`.tool-versions`](../.tool-versions) at the repo root
- The `wasm32v1-none` target: `rustup target add wasm32v1-none`
- The [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)

## Build

```bash
cd contracts
cargo build --target wasm32v1-none --release
```

Wasm binaries land in `target/wasm32v1-none/release/`.

## Test

```bash
cargo fmt --all -- --check
cargo test --workspace
```
