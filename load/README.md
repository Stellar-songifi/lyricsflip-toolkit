# k6 load tests

These scripts exercise the LyricsFlip Toolkit game loop and wager state machine under concurrent
load. They cover the three scenarios in [issue #147](https://github.com/Stellar-songifi/lyricsflip-toolkit/issues/147):

| Scenario | Script | What it drives |
| --- | --- | --- |
| `solo_play` | [`solo-play.js`](./solo-play.js) | `POST /game/sessions` → `GET /game/sessions/:id/lyric` → `POST /game/guess` → `GET /game/sessions/:id`. `submitGuess` takes a pessimistic row lock on the session, so this measures guess-submission throughput and lock contention. |
| `head_to_head_staking` | [`head-to-head.js`](./head-to-head.js) | Two users create/accept a staked challenge, both call `POST /wagers/:id/stake-transaction` and `POST /wagers/:id/stake`, play the match, then poll until `WagerService` reaches `won` or `refunded`. Uses **mock settlement mode**; no Stellar network is needed. |
| `reconcile_backlog` | [`reconcile-backlog.js`](./reconcile-backlog.js) | Seeds a backlog of non-terminal wagers, then fires concurrent test-only sweeps and reads the last result, mirroring the advisory-locked `WagerReconcilerService.sweep()`. |

[`all.js`](./all.js) runs all three together; the standalone scripts are useful for isolating a
regression. The toolkit game server has **no global API prefix** (`/health`, `/game/*`,
`/challenges`, `/wagers` are used as-is).

## Why a mock harness?

The toolkit deliberately has no HTTP route to settle, refund or create a wager: those are
in-process `WagerService` operations driven by game events
(`packages/server/src/http/wager.controller.ts`). `WagerReconcilerService.sweep()` is public for
tests/operators but has no HTTP trigger. The game server also requires Stellar SEP-10-signed auth,
which k6 cannot perform itself.

[`mock-settlement-server.js`](./mock-settlement-server.js) is a test-only Node HTTP service with no
dependencies. It mirrors the real route/status codes and the `pending → awaiting_stakes → staked →
settling → won|refunded` state machine, serializes work per session/wager with an in-process lock,
and exposes two extra routes:

- `POST /mock/wagers/backlog` — seed aged, non-terminal wagers.
- `POST /mock/reconcile` and `GET /mock/reconcile/status` — trigger and inspect one sweep.

It does not replace Postgres, the Stellar escrow contract or the production reconciler, and no
application source was changed.

## Run locally

k6 2.4.0 was used to establish the committed baseline. The harness needs only Node 22+.

```bash
# Terminal 1: game-server + mock settlement stand-in
node load/mock-settlement-server.js

# Terminal 2: all scenarios, 10 VUs for the ramping scenarios, 5 reconcile VUs
BASE_URL=http://127.0.0.1:4555 k6 run load/all.js

# Or isolate a scenario
BASE_URL=http://127.0.0.1:4555 k6 run load/solo-play.js
BASE_URL=http://127.0.0.1:4555 k6 run load/head-to-head.js
BASE_URL=http://127.0.0.1:4555 k6 run load/reconcile-backlog.js
```

The harness accepts synthetic `local-a` / `local-b` bearer tokens by default. Each run writes
`load/last-run-summary.json` (override with `SUMMARY_EXPORT`) and prints p95/p99, error rate,
success rate and RPS **per scenario**. Compare it to the committed baseline:

```bash
node load/compare-baseline.js load/last-run-summary.json load/baseline.json
```

A non-zero exit means a scenario regressed beyond tolerance. Defaults are in
[`compare-baseline.js`](./compare-baseline.js) and can be overridden with `BASELINE_P95_TOLERANCE`,
`BASELINE_P99_TOLERANCE`, `BASELINE_ERROR_TOLERANCE`, `BASELINE_RPS_TOLERANCE` and
`BASELINE_SUCCESS_TOLERANCE`.

## Run against a staging-like game server

The solo and head-to-head scenarios target the real HTTP API. Use `mock` settlement mode to avoid
a scaled Stellar network.

1. Start **one** game server with Postgres, migrations applied and lyrics seeded. Set
   `STELLAR_SETTLEMENT_MODE=mock` (the default) and a stable `JWT_SECRET` / `SEP10_SIGNING_SECRET`.
   There is no global rate limiter, and sessions are stored in Postgres, so multiple app instances
   are safe.
2. Pre-provision at least two JWTs. k6 cannot sign the SEP-10 challenge, so use the helper:

   ```bash
   npm ci
   node load/provision-tokens.js \
     --base-url https://staging.example.com \
     --count 20 \
     --out load/tokens.txt
   ```

   The file is gitignored and written with mode `0600`. Each token creates a user with a linked
   wallet, which the staked challenge flow requires.
3. Reconciliation has no production HTTP trigger. Either keep scenario 3 pointed at the local mock
   harness, or expose a test-only trigger in the staging deployment and set `RECONCILE_PATH` /
   `RECONCILE_STATUS_PATH` to its paths. Do not add an admin route to production for load tests.
4. Run:

   ```bash
   BASE_URL=https://staging.example.com \
   WAGER_BASE_URL=https://staging.example.com \
   RECONCILE_TRIGGER_URL=http://127.0.0.1:4555 \
   ENVIRONMENT=staging \
   LOAD_TOKEN_FILE=load/tokens.txt \
   LOAD_VUS=50 LOAD_DURATION=5m RECONCILE_BACKLOG=2000 \
   GITHUB_SHA="$(git rev-parse HEAD)" \
   SUMMARY_EXPORT=staging-summary.json \
   k6 run load/all.js
   ```

5. Review the printed table, then promote it deliberately:

   ```bash
   BASELINE_SOURCE='staging run, 50 VUs, 5m, 2000 backlogged wagers' \
     node load/update-baseline.js staging-summary.json load/baseline.json
   ```

   Commit `load/baseline.json` together with [`BASELINE.md`](./BASELINE.md) in the same PR.

### Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1:4555` | Game-server base URL (no `/api/v1` prefix). |
| `WAGER_BASE_URL` | `BASE_URL` | Base URL for `/wagers` and `/challenges` routes. |
| `MOCK_SETTLEMENT_URL` | `BASE_URL` | Base URL for harness-only setup routes. |
| `RECONCILE_TRIGGER_URL` | `MOCK_SETTLEMENT_URL` | Base URL for the test-only sweep trigger. |
| `RECONCILE_PATH` | `/mock/reconcile` | Sweep trigger path. |
| `RECONCILE_STATUS_PATH` | `/mock/reconcile/status` | Last-sweep status path. |
| `ENVIRONMENT` | derived from `BASE_URL` | Summary tag (`local-mock` or `staging`). |
| `LOAD_VUS` | `10` | Peak VUs for solo and wager ramping scenarios. |
| `LOAD_DURATION` | `20s` | Steady-state duration for ramping scenarios. |
| `LOAD_RAMP_UP` / `LOAD_RAMP_DOWN` | `5s` / `5s` | Ramp stages. |
| `RECONCILE_VUS` / `RECONCILE_DURATION` | `5` / `20s` | Reconcile sweep load. |
| `RECONCILE_BACKLOG` | `200` | Backlogged wagers seeded in `setup()`. |
| `RECONCILE_BACKLOG_STATUS` | `awaiting_stakes` | Set to `pending` to seed never-accepted proposals. |
| `GAME_ROUNDS` | `3` (harness) / `10` (head-to-head poll) | Fallback when a session response omits `totalRounds`. |
| `LOAD_GUESS` / `LOAD_WINNING_GUESS` / `LOAD_LOSING_GUESS` | `load test guess` | Guess strings; public lyrics hide the answer, so the default produces a tie/refund. |
| `WAGER_STAKE` | `50000000` | Stroops staked by each player. |
| `SETTLEMENT_POLL_TIMEOUT_MS` | `10000` | Max wait for match activation and terminal settlement. |
| `LOAD_TOKEN_FILE` | empty | File with one JWT per line (or a JSON array). |
| `LOAD_AUTH_TOKENS` / `LOAD_AUTH_TOKEN` | empty | Comma-separated JWTs; at least two are needed for head-to-head. |
| `P95_LIMIT_MS` / `P99_LIMIT_MS` | `1500` / `3000` | k6 thresholds. |
| `ERROR_RATE_LIMIT` / `SUCCESS_RATE_MIN` | `0.05` / `0.95` | k6 thresholds. |
| `REQUEST_TIMEOUT_MS` | `10000` | Per-request timeout. |
| `SUMMARY_EXPORT` | `load/last-run-summary.json` | Per-run JSON summary path. |
| `MOCK_PORT` | `4555` | Harness listen port. |
| `MOCK_LATENCY_MS` / `MOCK_JITTER_MS` | `5` / `10` | Artificial harness latency. |
| `MOCK_ROUNDS` | `3` | Rounds per harness session. |
| `RECONCILE_MIN_AGE_MS` / `RECONCILE_MAX_ATTEMPTS` | `60000` / `8` | Harness sweep eligibility/retry settings. |

## CI

[`.github/workflows/load-test.yml`](../.github/workflows/load-test.yml) runs on a weekly schedule
(Monday 03:23 UTC) and on `workflow_dispatch`. With no `base_url` input and no
`LOAD_TEST_BASE_URL` secret it starts the local harness, runs all three scenarios, checks the
baseline and uploads the summary artifact. Supplying staging URL/auth/reconcile secrets runs
against that environment; promote a reviewed staging baseline before treating CI as a performance
gate. The `update_baseline` dispatch input skips the regression check and uploads the summary as a
candidate.
