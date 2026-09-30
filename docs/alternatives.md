# Alternatives

> Researched September 2026. Projects change; check each one's current docs before deciding.

lyricsflip-toolkit is built for one case: **two players, one stake each, and a game server that decides
the winner off-chain.** If your case is different, one of these may fit better.

| Project | What it is | Pick it when |
|---|---|---|
| [Trustless Work](https://docs.trustlesswork.com/) | Escrow-as-a-service on Soroban: milestones, approvals, disputes, via a REST API and SDKs. At the time of writing it charges a 0.3% fee on funds released from mainnet escrows. | You need milestone or marketplace escrow, not a two-player match |
| [stellar-escrow-toolkit](https://github.com/stellar-escrow-toolkit/stellar-escrow-toolkit) | Open-source escrow contracts (core, milestone, multisig) with a TypeScript SDK | You want general-purpose escrow contracts to build on |
| [Chessify](https://github.com/jadonamite/Chessify) | Chess settlement on Soroban: escrow, payout and Elo in one contract | You're building chess specifically |
| [Stellarcade](https://github.com/theblockcade/stellarcade) | Arcade platform with experimental per-game wager contracts | You want arcade-style or house-backed games |

What lyricsflip-toolkit adds for PvP games: the server-side half. That means the wager state machine,
server-only settlement, crash-safe reconciliation against the ledger, and SEP-10 wallet linking, together
with a contract whose resolver can only pay a player in the pot.
