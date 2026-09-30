# Threat model

> This toolkit has **not been audited**. Do not use it with real value until it has been.
> Items marked **(planned)** describe protections that are not built yet.

## Assets

- Stakes held in the `pvp-escrow` contract
- The resolver key (the server's authority to settle)
- Player accounts linked to wallets

## Trust assumptions

- **The contract** is trusted to enforce its rules. That is the point of putting stakes on-chain.
- **The game server** is trusted to report the correct winner. The toolkit limits the damage if
  it is wrong or compromised; it can't make a dishonest server honest.
- **Players** are not trusted.

## Scenarios

| Scenario | Outcome |
|---|---|
| Resolver key stolen | Attacker can pick the wrong winner among the two players of a pot. Can't pay any other address, and can't take refunds for themselves. |
| Server disappears while a pot is funded | **(planned)** After the pot's timeout, each player can reclaim their own stake. Until this ships, funds can stay locked. |
| Server crashes mid-payout | Wager stays in `settling` with a transaction hash; reconciliation resolves it against the ledger. |
| A client tries to declare itself the winner | **(planned fix)** Settlement is triggered by the server only. Today a client can trigger it. |
| Player two never agreed to the stake | **(planned fix)** No stake is requested before an explicit accept. |
| Match starts with only one stake in | **(planned fix)** A wager is `staked` only when both stakes are confirmed. |
| Contract initialised by an attacker before setup | **(planned fix)** Setup moves into the constructor, so deploy and setup are atomic. |
| Server uses custodial mode on mainnet | Refused at boot. |

## Out of scope

- Cheating inside the game itself (for example, a bot answering lyrics). That's the game's job.
- Legal and app store rules on real-money wagering. Check these for your jurisdiction and platform before
  enabling real-value stakes.
