# Changelog

Notable changes to the contracts in this workspace. The crate version in each
`Cargo.toml` tracks the deployed Wasm, so a bump here is what tells operators a
redeploy is needed.

## pvp-escrow 0.2.0

### Added

- **`pause` / `unpause` / `is_paused`** (admin only). While paused, `open_pot`
  and `stake` fail with the new `Error::Paused` (17); `resolve`, `refund` and
  `claim_refund` keep working so in-flight pots can still be settled or
  returned. Publishes `Paused { admin }` / `Unpaused { admin }`.
- **`upgrade(new_wasm_hash)`** (admin only): in-place code upgrade through
  `update_current_contract_wasm`, publishing `Upgraded { new_wasm_hash }`. See
  `pvp-escrow/docs/upgrade.md` for when to use it and the runbook.
- New `DataKey::Paused` instance key. Existing storage is unchanged, so this
  version can itself be shipped in place over 0.1.x once deployed with
  `upgrade` support — 0.1.x has no `upgrade` entry point, so moving off 0.1.x
  needs one new deployment.

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
