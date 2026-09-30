# Integration guide

This guide explains how to add stakes to your own head-to-head game. `examples/coin-flip` does all of
this in about 200 lines. Read it alongside this guide.

## 1. What you need to provide

- A NestJS game server that knows when a match ends and who won.
- A way to authenticate players. The toolkit asks you for an `authenticate(request)` function, and
  provides SEP-10 for proving wallet ownership.
- PostgreSQL 13+.
- A Soroban token for stakes: a token contract or a classic asset's Stellar Asset Contract.

## 2. Deploy the escrow (testnet)

```bash
cd contracts
stellar keys generate deployer --network testnet --fund
NETWORK=testnet ADMIN=deployer RESOLVER=<resolver G... address> TOKEN=<stake token C... id> \
  scripts/deploy-pvp-escrow.sh
```

The script builds the contract and deploys it with its constructor arguments
(`-- --admin <G...> --resolver <G...> --token <C...>`), so setup happens inside the deploy
transaction. It refuses every network except `testnet`, `local` and `futurenet`.

For a classic asset, deploy its Stellar Asset Contract first with
`stellar contract asset deploy --asset CODE:ISSUER --source deployer --network testnet`.

## 3. Configure the server

`apps/game-server` reads these variables. Your own game passes the same values to
`PvpSettlementModule` (see `packages/server/README.md`).

| Variable | Purpose |
|---|---|
| `STELLAR_SETTLEMENT_MODE` | `mock` while developing, `stellar` for real settlement |
| `STELLAR_NETWORK` | `testnet`, `futurenet`, `local` or `public` |
| `STELLAR_RPC_URL` | Soroban RPC, e.g. `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | e.g. `Test SDF Network ; September 2015` |
| `STELLAR_ESCROW_CONTRACT_ID` | The deployed `pvp-escrow` contract |
| `STELLAR_TOKEN_CONTRACT_ID` | The stake token |
| `STELLAR_RESOLVER_SECRET` | The resolver key. Keep it in a secrets manager, never in git. |
| `STELLAR_CUSTODY_MODE` | `non-custodial` (default). `custodial` is refused on `public`. |
| `SEP10_SIGNING_SECRET` | Stable key that signs SEP-10 challenges. Required in production. |
| `SEP10_HOME_DOMAIN` | Domain named in SEP-10 challenges |

## 4. Wire the module into your game

```ts
PvpSettlementModule.forRoot({
  mode: 'stellar',
  stellar: { network, rpcUrl, networkPassphrase, escrowContractId, tokenContractId, resolverSecret },
  sep10: { signingSecret, homeDomain, networkPassphrase },
  authenticate: (req) => playerIdFromYourSession(req),
  onEvent: (event) => {
    if (event.type === 'wager.staked') startMatch(event.wager.matchId);
  },
});
```

Register `PVP_ENTITIES` with TypeORM and run `PVP_MIGRATIONS`. Then the flow is:

1. **Link wallets.** Each player proves their wallet with `POST /wallet/challenge` and
   `POST /wallet/verify`, or through your own login using `Sep10Service` and `WalletLinkService.link`.
2. **Create a wagered match.** Your server calls
   `wagers.create({ matchId, playerAId, playerBId, stakeAmount })`. `stakeAmount` is a stroop string,
   for example `toStroops('10')`.
3. **Player two accepts** with `POST /wagers/:id/accept`, or your server calls `wagers.accept(id, playerBId)`
   when player two accepts in your own UI. No pot is opened and no stake is requested before this.
4. **Collect stakes.** Each player calls `POST /wagers/:id/stake-transaction`, signs the XDR in their
   wallet, and posts it to `POST /wagers/:id/stake` as `{ signedTransactionXdr }`.
5. **Play.** Start the match on the `wager.staked` event, never before.
6. **Finish.** Your server calls `wagers.settleMatch(matchId, { winnerId })` or `{ draw: true }`. There
   is no client route for this. Clients only display the result.

Reconciliation, invitation expiry and stake-window refunds run in the background; nothing to wire.

## 5. Test

- Run with `STELLAR_SETTLEMENT_MODE=mock` first. No blockchain needed; pots live in Postgres under the
  contract's rules.
- Run the toolkit's integration suite against a disposable local network:
  `docker run --rm -p 8000:8000 stellar/quickstart --local --enable core,rpc`, then
  `npm run test:integration -w @lyricsflip-toolkit/server`.
- Then deploy to testnet and run the same flow with `stellar` mode.
- Never point a development setup at mainnet.

## Reference implementations

- `apps/game-server` — LyricsFlip, a full game (`src/modules/settlement` is the integration)
- `examples/coin-flip` — the smallest possible integration
