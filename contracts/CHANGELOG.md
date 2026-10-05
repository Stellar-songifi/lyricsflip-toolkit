# Changelog

Notable changes to the contracts in this workspace. The crate version in each
`Cargo.toml` tracks the deployed Wasm, so a bump here is what tells operators a
redeploy is needed.

## pvp-escrow 0.1.1

### Changed

- **Event schema (additive):** `Staked` now carries `stake_amount`, and
  `Refunded` now carries `player_a_amount` and `player_b_amount`. Previously an
  indexer had to read the `Pot` struct to learn how much moved on a stake, and
  could not recover individual refund amounts from a `Refunded` event at all.
  `Claimed` already carried its `amount`; the other fund-moving events now
  follow the same pattern.

  In a `Refunded` event an amount is `0` for a player who never staked, or who
  already reclaimed their stake with `claim_refund` before the resolver
  refunded the pot.

  No storage layout, entry point, error code or authorisation behaviour changed,
  so existing callers do not need to change. Indexers that decode events by
  exact field set will need to add the new fields; that is the reason for the
  version bump.

## pvp-escrow 0.1.0

### Added

- Initial `pvp-escrow`: one pot per head-to-head match, opened and settled by a
  `resolver`, with per-player `claim_refund` as the players' escape hatch after
  the deadline, and admin-only `set_resolver` / `set_admin` rotation.
