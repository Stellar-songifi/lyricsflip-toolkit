# Changelog

Notable changes to the contracts in this workspace. The crate version in each
`Cargo.toml` tracks the deployed Wasm, so a bump here is what tells operators a
redeploy is needed.

## pvp-escrow 0.2.0 (admin hand-over and platform fee)

### Changed (breaking for admin tooling)

- **Two-step admin transfer.** `set_admin` is replaced by
  `propose_admin(new_admin)` (admin only; authority doesn't move) and
  `accept_admin()` (signed by the candidate). `RoleChanged { admin }` is
  published only on `accept_admin`; `propose_admin` publishes
  `AdminProposed`. A mistyped address can no longer lock the admin out.
  New: `pending_admin()`, `Error::NoPendingAdmin` (18).

### Added

- **Optional platform fee.** `set_fee(fee_bps, fee_recipient)` (admin only,
  capped at `MAX_FEE_BPS` = 1,000 bps). `resolve` pays
  `pot_total - fee` to the winner and `fee = floor(pot_total × fee_bps /
  10,000)` to the recipient, so the two transfers always sum to exactly the
  pot. The default is 0, which pays the whole pot as before.
  `Resolved` gains `fee` and `fee_recipient`; `Config` (and `get_config`)
  gains `fee_bps` and `fee_recipient`; new `FeeChanged` event and
  `Error::InvalidFee` (19). Error 17 is left for `Paused` (#73).
- **Model-based property test** (`proptest`, 256 cases, fixed seed) over random
  call sequences, checking balance, status and conservation invariants after
  every step.
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
