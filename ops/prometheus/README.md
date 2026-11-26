# LyricsFlip settlement alerts

Load `lyricsflip-alerts.yml` into Prometheus and route alerts with `severity: page` to the on-call receiver. The game server must be scraped at `/metrics`.

## LyricsFlipSettlementFailureRateHigh

1. Find `settlement.failed` events and group them by RPC error, session, and deployment.
2. Check Stellar RPC health and resolver-key availability. Do not rotate or expose the resolver secret in logs.
3. Confirm failed wagers remain eligible for the reconciler before changing infrastructure.
4. After remediation, verify successful settlement traffic and a falling ten-minute failure ratio.

## LyricsFlipReconcileAttemptsExhausted

1. Find the `reconciliation.exhausted` event and record its `wagerId`, `attempts`, and `failureReason`.
2. Inspect that wager in the database. Status values are lowercase and the error column is `failureReason`.
3. Verify the on-chain pot before any manual correction; never pay or refund from database state alone.
4. Repair the RPC, resolver, or contract problem, then follow the audited recovery procedure for the wager.

The default attempt limit is eight. Reproduce the paging path in staging with `maxAttempts: 1` and a failing RPC, and confirm the alert reaches the configured receiver.

## LyricsFlipReconcileSweepStalled

1. Check game-server health and the PostgreSQL connection used by the reconciler.
2. Look for `reconciliation.sweep.failed` events. A skipped sweep means another instance owns advisory lock `7139001` and does not count as success.
3. Confirm one healthy game-server instance completes a lock-owning sweep.
4. Verify `lyricsflip_reconcile_sweep_last_success_timestamp_seconds` advances before resolving the alert.
