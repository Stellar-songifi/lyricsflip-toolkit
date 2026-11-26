# Upgrading pvp-escrow

This page is both the decision record (ADR) for how `pvp-escrow` changes after
it holds live pots, and the runbook for shipping a change.

## Decision

**Storage-compatible changes ship in place with `upgrade(new_wasm_hash)`.
Changes that break storage ship as a new deployment, and the old one is
drained.**

| | In place (`upgrade`) | New deployment + drain |
|---|---|---|
| Contract address | unchanged | new; game servers must switch |
| Live pots and balances | stay put and keep working | stay in the old contract until settled |
| Who acts | the admin (ideally a multisig) | operator + game-server config change |
| Allowed when | the new code reads every existing storage entry as written | anything else |

Why in place by default: pots hold player funds, and a fresh deployment means
running two contracts until every old pot is resolved, refunded or reclaimed
(up to 30 days, `MAX_TIMEOUT_LEDGERS`). An in-place upgrade keeps the address,
storage and token balance, so in-flight pots settle normally under the new
code. The cost is trust: the admin can replace the code, so the admin must be a
multisig (see `deploy-contract.yml` and `deployments.json`).

`upgrade` is admin-only, calls `env.deployer().update_current_contract_wasm`
and publishes `Upgraded { new_wasm_hash }`. Pausing (`pause`/`unpause`) is
independent and can be used around an upgrade.

### Storage-compatible means

A change is safe in place only if **all** of these hold:

- [ ] No `#[contracttype]` stored in persistent or instance storage changes
      shape: `Pot`, the values behind `DataKey::*`. No fields added, removed,
      reordered or retyped; no enum variants removed or renumbered.
- [ ] `DataKey` variants are only **added**, never removed, renamed or reordered
      (the variant name is part of the storage key).
- [ ] `Error` codes are only added; existing numbers keep their meaning.
- [ ] Existing entry points keep their names, argument types and auth rules
      (the game server and the SDK call them by name).
- [ ] Event changes are additive, and indexers have been told (see the 0.1.1
      entry in `CHANGELOG.md` for the pattern).
- [ ] TTL constants (`TTL_EXTEND_TO`, `TTL_THRESHOLD`) are not lowered.

If any box can't be ticked, use [a new deployment](#breaking-changes-new-deployment-and-drain).

## Runbook: in-place upgrade

Variables used below:

```sh
NETWORK=testnet                 # testnet | futurenet | mainnet
ADMIN=<stellar CLI identity of the admin, or the multisig signing flow>
CONTRACT_ID=$(jq -r ".deployments.\"$NETWORK\".contractId" pvp-escrow/deployments.json)
```

### 1. Pre-upgrade checklist

- [ ] The change is merged, reviewed and the storage checklist above is ticked
      in the PR.
- [ ] `CHANGELOG.md` has an entry and `Cargo.toml`'s version is bumped.
- [ ] `cargo test --workspace` and the Wasm-based tests pass
      (`cargo build --target wasm32v1-none --release && cargo test -p pvp-escrow -- --ignored`).
- [ ] The same Wasm has been upgraded on **testnet** first, with a pot opened
      before the upgrade and resolved after it.
- [ ] You know the currently live hash (for rollback):
      `jq -r ".deployments.\"$NETWORK\".wasmHash" pvp-escrow/deployments.json`.
- [ ] Game-server operators are told the time window. Optional: `pause` first
      so no new pots open during the switch (in-flight pots keep settling).

### 2. Build and upload

From a clean checkout of the release commit:

```sh
cd contracts
cargo build --locked --target wasm32v1-none --release -p pvp-escrow
sha256sum target/wasm32v1-none/release/pvp_escrow.wasm   # note it

NEW_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/pvp_escrow.wasm \
  --source-account "$ADMIN" --network "$NETWORK")
echo "$NEW_HASH"   # must equal the sha256 above
```

Uploading only stores the code; nothing changes yet.

### 3. (Optional) pause

```sh
stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN" --network "$NETWORK" -- pause
```

### 4. Upgrade

```sh
stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN" --network "$NETWORK" \
  -- upgrade --new_wasm_hash "$NEW_HASH"
```

With a multisig admin, build this transaction with `--build-only`, collect the
signatures, and submit it with `stellar tx send`.

### 5. Verify

```sh
stellar contract fetch --id "$CONTRACT_ID" --network "$NETWORK" -o live.wasm
sha256sum live.wasm                                   # == NEW_HASH
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_config
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- is_paused
```

Then read one live pot (`get_pot --session_id <hex>`) and check it decodes.
Unpause if you paused. Update `deployments.json` (`wasmHash`, `commit`,
`deployedAt`) in a PR.

### 6. Rollback

The previous Wasm is still on the network, so rolling back is another upgrade
to the old hash recorded in `deployments.json`:

```sh
stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN" --network "$NETWORK" \
  -- upgrade --new_wasm_hash "$PREVIOUS_HASH"
```

This is only safe if the new code wrote nothing the old code can't read. The
storage checklist (additive changes only) is what guarantees that, so don't
roll back a release that added a stored field the old code doesn't know.

## Breaking changes: new deployment and drain

1. Deploy the new contract with `deploy-contract.yml` and record it.
2. `pause` the **old** contract: no new pots or stakes, while `resolve`,
   `refund` and `claim_refund` keep working.
3. Point the game server (`escrowContractId`) at the new contract for new
   wagers; keep a reconciler on the old one until it is empty.
4. Settle every remaining old pot: resolve or refund through the game server,
   or wait for the deadline so players can `claim_refund`. The old contract's
   token balance must reach 0.
5. Record the old contract as retired in `deployments.json`.

Never move funds between contracts with an admin call: every stake must leave
the old contract through `resolve`, `refund` or `claim_refund`, so it only
ever goes to a player of that pot.
