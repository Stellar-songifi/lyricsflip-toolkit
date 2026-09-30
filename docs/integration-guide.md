# Integration guide

> **Draft.** The packages this guide describes are being extracted (see the README status table).
> Function names and env variables below must be checked against the code once `packages/sdk` and
> `packages/server` exist.

This guide explains how to add stakes to your own head-to-head game.

## 1. What you need to provide

- A game server that knows when a match ends and who won.
- A way for players to sign in (the toolkit provides SEP-10 wallet linking).
- A PostgreSQL database.
- A Soroban token for stakes: a token contract or a classic asset's Stellar Asset Contract.

## 2. Deploy the escrow (testnet)

```bash
cd contracts
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/pvp_escrow.wasm \
  --source <deployer-identity> \
  --network testnet \
  -- <constructor arguments: admin, resolver, token>
```

Constructor arguments are finalised during contract hardening. Check `contracts/pvp-escrow` for the exact list.

## 3. Configure the server

| Variable | Purpose |
|---|---|
| `STELLAR_SETTLEMENT_MODE` | `mock` while developing, `stellar` for real settlement |
| `STELLAR_ESCROW_CONTRACT_ID` | The deployed `pvp-escrow` contract |
| `STELLAR_TOKEN_CONTRACT_ID` | The stake token |
| `STELLAR_RESOLVER_SECRET` | The resolver key. Keep it in a secrets manager, never in git. |

## 4. Wire the module into your game

The flow your game drives:

1. **Create a wagered match** for two linked wallets with a stake amount (as a stroop string).
2. **Player two accepts.** No stake is requested before this.
3. **Collect stakes.** Each player receives an unsigned transaction, signs it in their wallet, and posts it back.
4. **Play.** Only start the match once the wager is `staked`.
5. **Finish.** Your server reports the winner. The module settles; your clients only display the result.

## 5. Test

- Run with `STELLAR_SETTLEMENT_MODE=mock` first. No blockchain needed.
- Then deploy to testnet and run the same flow with `stellar` mode.
- Never point a development setup at mainnet.

## Reference implementations

- `apps/game-server` — LyricsFlip, a full game
- `examples/coin-flip` — the smallest possible integration (planned)
