# coin-flip

The smallest possible game on lyricsflip-toolkit, about 200 lines in total. Two players stake, the
server flips a coin, and the winner takes the pot. It exists to show that the toolkit knows nothing
about LyricsFlip.

| File | What it does |
|---|---|
| `src/coin-flip.service.ts` | The game: propose a flip, and settle it once both stakes are in. |
| `src/app.module.ts` | Wires TypeORM and `PvpSettlementModule`, and adds SEP-10 login and `POST /flips`. |
| `src/tokens.ts` | A tiny HMAC session token. Use your own auth in a real game. |
| `src/config.ts` | Environment variables. |

## Flow

1. `POST /login/challenge` `{ address }`, then sign the returned XDR in the wallet and send it to
   `POST /login/verify` `{ address, signedTransactionXdr }`. The response is `{ token }`, and the wallet
   is now linked.
2. Player A: `POST /flips` `{ opponent: <B's address>, stakeAmount: "10000000" }` (stroops).
3. Player B: `POST /wagers/:id/accept`. The toolkit opens the pot.
4. Each player: `POST /wagers/:id/stake-transaction`, sign the XDR (skipped in mock mode, where it is
   `null`), then `POST /wagers/:id/stake` `{ signedTransactionXdr }`.
5. Once both stakes are confirmed, the server flips and calls `WagerService.settle`. Poll
   `GET /wagers/:id` until it reads `won`.

Routes 3–5 come from the toolkit. The game adds only login and `POST /flips`.

## Run

```bash
createdb coin_flip                       # or: docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
npm run build -w @lyricsflip-toolkit/sdk -w @lyricsflip-toolkit/server -w @lyricsflip-toolkit/example-coin-flip
DATABASE_URL=postgres://postgres:postgres@localhost:5432/coin_flip npm start -w @lyricsflip-toolkit/example-coin-flip
```

It defaults to `STELLAR_SETTLEMENT_MODE=mock`. For real settlement on testnet, set
`STELLAR_SETTLEMENT_MODE=stellar`, `STELLAR_ESCROW_CONTRACT_ID`, `STELLAR_TOKEN_CONTRACT_ID`,
`STELLAR_RESOLVER_SECRET` and `SEP10_SIGNING_SECRET` (see `src/config.ts`).

## Test

```bash
npm test -w @lyricsflip-toolkit/example-coin-flip   # needs Postgres; see PVP_TEST_DATABASE_URL
```
