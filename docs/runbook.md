# Runbook

Operational procedures for on-call engineers. Each scenario lists concrete commands and queries.

> **Related code & docs**
> - `SettlementListener` — listens for on-chain settlement events and enqueues reconcile work.
> - `WagerReconcilerService` — drives the reconcile sweep, retries, and `reconcileMaxAttempts` enforcement.
> - Contract module doc — `contracts/README.md` (resolver authority, `set_resolver`, event shapes).
> - Resolver key rotation doc — see issue **#68** (`docs/resolver-rotation.md`).
> - Alert definitions — see issue **#137**.

---

## Conventions

- `$DATABASE_URL` — Postgres connection string for the app database.
- `$CONTRACT_ID` — deployed Soroban contract id (e.g. `C...`).
- `$RESOLVER_PUBLIC` — current on-chain resolver public key (`G...`).
- `$NETWORK_PASSPHRASE` — `Test SDF Network ; September 2015` or `Public Global Stellar Network ; September 2015`.
- `$RPC_URL` — Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`).
- `$RESOLVER_SOURCE` — funded Stellar account secret used to sign admin calls (the resolver admin, **not** necessarily the resolver key itself).

Set these once per session:

```bash
export DATABASE_URL='postgres://user:pass@host:5432/db'
export CONTRACT_ID='C...'
export RPC_URL='https://soroban-testnet.stellar.org'
export NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
export RESOLVER_SOURCE='S...'   # admin signer, keep out of shell history where possible
```

---

## 1. Wager stuck past `reconcileMaxAttempts`

`WagerReconcilerService` retries a wager up to `reconcileMaxAttempts` times. Once a wager reaches that
count it is no longer retried automatically and is considered **stuck**. `SettlementListener` will not
re-enqueue it.

### 1a. Find stuck wagers

The configured max is exposed as `RECONCILE_MAX_ATTEMPTS` (default `5`). Confirm the effective value:

```bash
echo "${RECONCILE_MAX_ATTEMPTS:-5}"
```

List wagers at or past the limit:

```sql
-- Replace :max with the value from RECONCILE_MAX_ATTEMPTS
SELECT id,
       status,
       "reconcileAttempts",
       "lastError",
       "updatedAt"
FROM pvp_wagers
WHERE "reconcileAttempts" >= :max
  AND status NOT IN ('SETTLED', 'CANCELLED', 'REFUNDED')
ORDER BY "updatedAt" ASC;
```

If the column names differ in your schema, inspect first:

```sql
\d pvp_wagers
```

### 1b. Inspect the escrow pot state on-chain

For a given wager id, read the escrow/pot entry from the contract:

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$RESOLVER_SOURCE" \
  -- get_pot --wager_id "$WAGER_ID"
```

Compare the on-chain pot status against the DB `status` and `lastError`. Common causes:
- On-chain already settled but DB not updated → safe to force a reconcile (1c).
- On-chain pot still `OPEN`/`LOCKED` but DB thinks it's settling → investigate the settlement tx.

### 1c. Trigger a manual reconcile

Preferred: call the resolver endpoint that re-enqueues a single wager (idempotent):

```bash
curl -sS -X POST "$RESOLVER_BASE_URL/internal/reconcile/$WAGER_ID" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json"
```

If no HTTP endpoint is available, reset the attempt counter so the sweep picks it up again:

```sql
UPDATE pvp_wagers
SET "reconcileAttempts" = 0,
    "updatedAt" = now()
WHERE id = :wager_id;
```

Then trigger a sweep (see §3d) or wait for the next scheduled sweep.

### 1d. Escalation

If a wager still fails after a manual reset + reconcile:
1. Capture the `lastError`, the on-chain pot state (1b), and the settlement tx hash.
2. Check `SettlementListener` logs for the wager id to see whether the settlement event was received.
3. Escalate to the contract owner / on-call backend lead. Do **not** manually mutate on-chain state
   without a second reviewer.

---

## 2. Resolver key rotation

The resolver key signs settlement results. Rotation ties together the **#68 rotation doc**
(`docs/resolver-rotation.md`) and the contract's `set_resolver` entrypoint (see `contracts/README.md`).

### 2a. Generate a new keypair

```bash
soroban keys generate resolver-$(date +%Y%m%d) --network "$NETWORK_PASSPHRASE"
# or, if you manage keys externally:
stellar keys generate resolver-$(date +%Y%m%d)
```

Record the new public key:

```bash
export NEW_RESOLVER_PUBLIC='G...'
```

### 2b. Update the secret store / env

Store the new secret as `RESOLVER_SECRET` in the secret manager (Vault / AWS Secrets Manager / k8s
Secret). Do **not** commit it. Example for a k8s secret:

```bash
kubectl -n app create secret generic resolver-secret \
  --from-literal=RESOLVER_SECRET="$NEW_RESOLVER_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Roll the deployment so `WagerReconcilerService` picks up the new secret:

```bash
kubectl -n app rollout restart deployment/wager-reconciler
kubectl -n app rollout status  deployment/wager-reconciler
```

### 2c. Register the new resolver on-chain

Call the contract's `set_resolver` from the admin source account:

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$RESOLVER_SOURCE" \
  -- set_resolver --resolver "$NEW_RESOLVER_PUBLIC"
```

### 2d. Verify the on-chain resolver

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$RESOLVER_SOURCE" \
  -- get_resolver
```

Confirm the output equals `$NEW_RESOLVER_PUBLIC`. Then confirm a settlement round-trips end-to-end
(trigger a test settle on a staging wager and watch `SettlementListener` logs).

### 2e. Retire the old key

After the new resolver is verified and has settled at least one wager, revoke/delete the old secret in
the store. Cross-reference `docs/resolver-rotation.md` (#68) for the full rotation policy and
`contracts/README.md` for the resolver authority model.

---

## 3. Stalled reconcile sweep

The sweep is driven by `WagerReconcilerService`. A "stalled" sweep means the loop is not advancing
(no new reconcile attempts, no log lines, or a stuck advisory lock).

### 3a. Check loop logs / metrics

```bash
kubectl -n app logs deploy/wager-reconciler --since=15m | grep -iE 'reconcile|sweep|error'
```

Look for the periodic sweep log line (e.g. `reconcile sweep start` / `reconcile sweep complete`). If
the "start" line repeats without a "complete", the sweep is hung.

Metrics (Prometheus):

```bash
curl -sS "$PROM_URL/api/v1/query" \
  --data-urlencode 'query=rate(wager_reconcile_sweep_total[5m])'
curl -sS "$PROM_URL/api/v1/query" \
  --data-urlencode 'query=wager_reconcile_sweep_duration_seconds'
```

A flat `rate(...)` with a rising duration indicates a stall.

### 3b. Verify DB connectivity

```bash
psql "$DATABASE_URL" -c 'SELECT 1;'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM pvp_wagers WHERE status = '\''PENDING'\'';'
```

If `SELECT 1` fails, the sweep cannot progress — fix connectivity first.

### 3c. Check advisory locks

The sweep takes a Postgres advisory lock to avoid concurrent runs. A leaked lock blocks all future
sweeps:

```sql
SELECT l.pid,
       l.locktype,
       l.objid,
       l.granted,
       a.state,
       a.query,
       a.query_start
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory';
```

If a lock is held by an idle/abandoned backend, terminate it (confirm with a second engineer first):

```sql
SELECT pg_terminate_backend(:pid);
```

### 3d. Restart procedure

```bash
kubectl -n app rollout restart deployment/wager-reconciler
kubectl -n app rollout status  deployment/wager-reconciler
kubectl -n app logs deploy/wager-reconciler --since=5m | grep -iE 'reconcile|sweep'
```

Confirm a fresh `reconcile sweep complete` line appears.

### 3e. Trigger a manual sweep

```bash
curl -sS -X POST "$RESOLVER_BASE_URL/internal/reconcile/sweep" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN"
```

If no endpoint exists, restarting the deployment (3d) triggers an immediate sweep on startup.

---

## 4. Responding to alerts (#137)

Each subsection: what the alert means, the immediate check, and the mitigation. Alert names match
issue **#137**.

### 4.1 `WagerReconcileStuck`

**Meaning:** one or more wagers reached `reconcileMaxAttempts` without settling.

**Check:**

```sql
SELECT id, status, "reconcileAttempts", "lastError", "updatedAt"
FROM pvp_wagers
WHERE "reconcileAttempts" >= :max
  AND status NOT IN ('SETTLED', 'CANCELLED', 'REFUNDED')
ORDER BY "updatedAt" ASC;
```

**Mitigation:** follow §1 (inspect escrow, manual reconcile, escalate).

### 4.2 `ReconcileSweepStalled`

**Meaning:** the reconcile sweep has not completed within its expected interval.

**Check:**

```bash
kubectl -n app logs deploy/wager-reconciler --since=15m | grep -iE 'sweep'
```

and the advisory-lock query in §3c.

**Mitigation:** follow §3 (connectivity, advisory lock, restart, manual sweep).

### 4.3 `SettlementListenerLag`

**Meaning:** `SettlementListener` is falling behind on-chain settlement events (event cursor not
advancing).

**Check:**

```bash
kubectl -n app logs deploy/settlement-listener --since=15m | grep -iE 'event|cursor|lag'
```

Compare the listener's last processed ledger against the chain head:

```bash
soroban contract events \
  --id "$CONTRACT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --start-ledger "$LAST_PROCESSED_LEDGER"
```

**Mitigation:** restart the listener (`kubectl -n app rollout restart deploy/settlement-listener`).
If lag persists, check RPC health and rate limits; escalate to infra.

### 4.4 `ResolverKeyMismatch`

**Meaning:** the configured `RESOLVER_SECRET` public key does not match the on-chain resolver, so
settlements will be rejected.

**Check:**

```bash
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$RESOLVER_SOURCE" \
  -- get_resolver
```

Compare against the public key derived from `RESOLVER_SECRET`.

**Mitigation:** follow §2 (rotate / re-register the resolver via `set_resolver`).

### 4.5 `ReconcileErrorRateHigh`

**Meaning:** the reconcile error rate exceeds threshold (many wagers failing per sweep).

**Check:**

```bash
kubectl -n app logs deploy/wager-reconciler --since=15m | grep -iE 'error' | sort | uniq -c | sort -rn | head
```

and:

```sql
SELECT "lastError", count(*)
FROM pvp_wagers
WHERE "lastError" IS NOT NULL
  AND "updatedAt" > now() - interval '15 minutes'
GROUP BY "lastError"
ORDER BY count(*) DESC;
```

**Mitigation:** identify the dominant `lastError`. If it is a transient RPC/DB error, wait for the
next sweep or trigger a manual sweep (§3e). If it is a contract/state error, escalate per §1d.

---

## Quick reference

| Scenario | First command |
| --- | --- |
| Stuck wager | `SELECT ... FROM pvp_wagers WHERE "reconcileAttempts" >= :max` |
| Key rotation | `soroban contract invoke ... -- set_resolver --resolver $NEW_RESOLVER_PUBLIC` |
| Stalled sweep | `SELECT ... FROM pg_locks WHERE locktype = 'advisory'` |
| Alerts | see §4 per alert name |