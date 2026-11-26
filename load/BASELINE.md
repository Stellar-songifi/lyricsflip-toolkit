# Load-test baseline

## Bootstrap baseline (not a production SLO)

No staging URL or credentials were supplied with this change, so the committed baseline was
measured by running `load/all.js` against the local mock settlement harness on
2026-11-25 (k6 2.4.0, Node 22, `MOCK_LATENCY_MS=5`, `MOCK_JITTER_MS=10`, `MOCK_ROUNDS=3`).

| Scenario | VUs | Backlog | p95 | p99 | Errors | Success | Throughput |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `solo_play` | 10 | – | 15.75 ms | 16.76 ms | 0% | 100% | 780.74 req/s |
| `head_to_head_staking` | 10 | – | 15.69 ms | 16.65 ms | 0% | 100% | 784.29 req/s |
| `reconcile_backlog` | 5 | 200 backlogged wagers | 59.88 ms | 64.64 ms | 0% | 100% | 137.41 req/s |

Run shape: 2s ramp-up, 10s steady state, 2s ramp-down for the ramping scenarios; 10s constant load
for reconciliation. The harness swept all 200 backlogged wagers. Head-to-head settlement reached a
terminal state with a p95 wait of 67 ms after the final stakes. Machine-readable values are in
[`baseline.json`](./baseline.json).

**This is a bootstrap, not a staging baseline.** Its numbers describe the mock harness, not the
Postgres-backed game server, and must not be used to assert production readiness. Replace it with a
staging run before treating CI as a performance gate.

## How to establish the staging baseline

```bash
# 1. Provision JWTs for the staging-like game server (see README.md).
npm ci
node load/provision-tokens.js --base-url https://staging.example.com --count 20 --out load/tokens.txt

# 2. Run against the staging-like environment.
BASE_URL=https://staging.example.com \
WAGER_BASE_URL=https://staging.example.com \
RECONCILE_TRIGGER_URL=http://127.0.0.1:4555 \
ENVIRONMENT=staging \
LOAD_TOKEN_FILE=load/tokens.txt \
LOAD_VUS=50 LOAD_DURATION=5m RECONCILE_BACKLOG=2000 \
GITHUB_SHA="$(git rev-parse HEAD)" \
SUMMARY_EXPORT=staging-summary.json \
k6 run load/all.js

# 3. Review the printed p95/p99, error-rate and RPS table, then promote it.
BASELINE_SOURCE='staging run, 50 VUs, 5m, 2000 backlogged wagers' \
  node load/update-baseline.js staging-summary.json load/baseline.json
```

Commit `load/baseline.json` and update this table in the same PR. Comparison tolerances are
documented in [`README.md`](./README.md) and implemented in
[`compare-baseline.js`](./compare-baseline.js).

## Interpreting future runs

- **p95/p99** — HTTP latency under load; always compare per scenario, never in aggregate.
- **Errors** — `http_req_failed` rate. Non-2xx responses from auth, validation or a missing route
  show up here.
- **Success** — business-level checks: solo session finished, staked match reached `won`/`refunded`,
  reconcile sweep returned a valid result. Low success with low HTTP errors indicates a state-machine
  regression.
- **RPS** — achieved throughput at the configured VU count. A drop at unchanged VUs usually means
  lock contention or pool exhaustion.
- `head_to_head_staking.settle_wait_ms` — p95 time from the last stake to terminal settlement.
- `reconcile_backlog.swept_total` — number of backlogged wagers moved by sweeps during the run. Keep
  `RECONCILE_BACKLOG` constant when comparing runs.
