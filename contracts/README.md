# contracts

A Cargo workspace of Soroban smart contracts for lyricsflip-toolkit. The `soroban-sdk` version
(27.0.6) and release profile are pinned once in [`Cargo.toml`](Cargo.toml).

The LyricsFlip game and NFT contracts live in
[`Stellar-songifi/lyricsflip`](https://github.com/Stellar-songifi/lyricsflip).

## `pvp-escrow`

One pot per head-to-head match, keyed by the game server's session UUID (its 16 raw bytes).

| Function | Who signs | What it does |
|---|---|---|
| `__constructor(admin, resolver, token)` | admin | Runs once, inside the deploy transaction. There is no `initialize` to front-run. |
| `open_pot(session_id, player_a, player_b, stake_amount, timeout_ledgers)` | resolver | Creates a pot. `timeout_ledgers` must be between 60 (~5 min) and 518,400 (~30 days). |
| `stake(session_id, player)` | player | Moves `stake_amount` from `player` into escrow. Refused after the deadline. |
| `resolve(session_id, winner)` | resolver | Pays both stakes to `winner`, who must be one of the pot's two players. Needs both stakes in. |
| `refund(session_id)` | resolver | Returns each stake that was made to whoever made it. |
| `claim_refund(session_id, player)` | player | After the deadline, returns `player`'s own stake. No resolver needed. |
| `set_resolver(resolver)` / `set_admin(admin)` | admin | Rotates a role. |
| `get_pot(session_id)` / `get_config()` | — | Reads state. |

Pot status goes `Open → Staked → Resolved | Refunded`.

### Invariants

- The resolver can only pay a player who staked in that pot, and only when both stakes are in.
- Refunds, from `refund` or `claim_refund`, only ever return a stake to the address that made it.
- If the game server disappears, each player can reclaim their own stake once the pot's deadline has
  passed. Once anyone has claimed, `resolve` is refused for that pot.
- The resolver and admin are read from contract storage and never taken from arguments.

### Events

| Event | Topics | Data |
|---|---|---|
| `PotOpened` | `session_id` | `player_a`, `player_b`, `stake_amount`, `deadline_ledger` |
| `Staked` | `session_id` | `player` |
| `Resolved` | `session_id` | `winner`, `payout` |
| `Refunded` | `session_id` | — |
| `Claimed` | `session_id` | `player`, `amount` |
| `RoleChanged` | `role` (`resolver` or `admin`) | `address` |

## Prerequisites

- Rust — version pinned in [`.tool-versions`](../.tool-versions) at the repo root
- The `wasm32v1-none` target: `rustup target add wasm32v1-none`
- The [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)

## Build and test

```bash
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
stellar contract build        # or: cargo build --target wasm32v1-none --release
```

The Wasm lands in `target/wasm32v1-none/release/pvp_escrow.wasm`.

## Deploy (testnet)

```bash
stellar keys generate deployer --network testnet --fund
NETWORK=testnet ADMIN=deployer RESOLVER=<resolver G... address> TOKEN=<stake token C... id> \
  scripts/deploy-pvp-escrow.sh
```

The script refuses any network other than `testnet`, `local` and `futurenet`. The stake token is a
Soroban token contract or a classic asset's Stellar Asset Contract (`stellar contract asset deploy`).
