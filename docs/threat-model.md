# Threat model

> This toolkit has **not been audited**. Do not use it with real value until it has been.

## Assets

- Stakes held in the `pvp-escrow` contract
- The resolver key (the server's authority to open, settle and refund pots)
- The admin key (can rotate the resolver and the admin)
- The SEP-10 signing key (the server's authority to issue login challenges)
- Player accounts linked to wallets

## Trust assumptions

- **The contract** is trusted to enforce its rules. That is the point of putting stakes on-chain.
- **The game server** is trusted to report the correct winner. The toolkit limits the damage if
  it is wrong or compromised; it can't make a dishonest server honest.
- **Players** are not trusted. Nothing a client sends decides a result, names a player, or moves a
  stake without that player's own signature.

## Scenarios

| Scenario | Outcome |
|---|---|
| Resolver key stolen | Attacker can pick the wrong winner among the two players of a pot, refund pots early, or open junk pots. Can't pay any other address, and can't take refunds for themselves. Rotate it with `set_resolver`. |
| Admin key stolen | Attacker can install their own resolver, with the powers above. There is no upgrade function, so the admin can't replace the contract's code or move funds directly. Use a multisig admin. |
| Server disappears while a pot is funded | After the pot's `deadline_ledger`, each player reclaims their own stake with `claim_refund`, no server needed. |
| Server crashes mid-payout | Its intent (payout to whom, or refund) was committed before submission, and the wager stays in `settling`. The reconciler reads the pot: resolved means `won`, refunded means `refunded`, still staked means retry. The contract refuses a second payout. |
| A client tries to declare itself the winner | There is no route for it. The server settles from scores it recorded, when its own session-finished event fires. The game server also takes player ids only from the JWT, including on sockets, so a client can't guess or score as someone else. |
| Player two never agreed to the stake | No pot is opened and no stake is requested until player two accepts. The stake itself needs player two's signature. |
| Match starts with only one stake in | A wager becomes `staked` only when the pot holds both stakes. `apps/game-server` keeps the session `waiting` until then. |
| A player posts someone else's signed stake, or a different transaction | The envelope must be exactly `stake(this pot, this player)` on this contract, or it is rejected before submission. |
| Contract initialised by an attacker before setup | Not possible. Setup is the constructor, which runs inside the deploy transaction, and there is no `initialize`. |
| A player stakes after the pot times out | Refused by the contract (`DeadlinePassed`). |
| Resolver pays out after a player reclaimed a stake | Refused by the contract. Once anyone has claimed, `resolve` fails, and the reconciler marks the wager `refunded` or `failed`, never `won`. |
| Server uses custodial mode on mainnet | Refused at boot (`validateOptions`), and `StellarEscrowGateway` also refuses custodial signing on `public`. |
| SEP-10 signed challenge replayed | Refused by the same process. Redeemed challenges are remembered in memory until they expire (5 minutes by default), so a restart or a second instance could accept one replay within that window. Treat a signed challenge like a password. |
| Wallet switched mid-wager to redirect a payout | Refused. A player can't change wallets while a wager is in flight, and payouts go to the addresses fixed when the pot was opened. |
| Mobile device lost (LyricsFlip app) | The app's key only ever holds free testnet tokens, and it refuses to sign for any other network. See `docs/wallet-spike.md`. |

## Out of scope

- Cheating inside the game itself (for example, a bot answering lyrics). That's the game's job.
- Denial of service against the RPC endpoint or the database. Settlement waits, and the reconciler
  retries.
- Legal and app store rules on real-money wagering. Check these for your jurisdiction and platform before
  enabling real-value stakes.
