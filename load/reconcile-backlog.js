import {
  backlogSize,
  baseOptions,
  baseSetup,
  constantScenario,
  envInt,
  expect,
  expectStatus,
  jsonOf,
  RECONCILE_PATH,
  RECONCILE_STATUS_PATH,
  reconcileRequest,
  recordOutcome,
  SCENARIOS,
  scenarioTags,
  sweptCount,
  writeSummary,
} from './common.js';

const NAME = SCENARIOS.reconcile;

export const options = baseOptions({
  [NAME]: constantScenario(NAME, 'reconcileSweep', {
    vus: envInt('RECONCILE_VUS', 5),
    duration: __ENV.RECONCILE_DURATION || '20s',
  }),
});

export function setup() {
  return baseSetup({ seedBacklog: true });
}

/**
 * Seeds non-terminal wagers, then fires concurrent sweeps at the test-only
 * reconcile trigger. The real reconciler is in-process and advisory-locked;
 * the harness mirrors that so simultaneous sweeps cannot double-process.
 */
export function reconcileSweep(data) {
  const tags = scenarioTags(NAME, { endpoint: 'reconcile_sweep' });
  backlogSize.add(data.backlog || 0, tags);

  const sweepTags = scenarioTags(NAME, { endpoint: 'sweep' });
  const swept = reconcileRequest('POST', RECONCILE_PATH, {}, sweepTags, data);
  let ok = expectStatus(swept, [200, 201], sweepTags);
  const result = jsonOf(swept);
  ok =
    expect(Boolean(result.checkedAt), 'sweep has a checkedAt timestamp', sweepTags) &&
    expect(Number.isFinite(result.remaining), 'sweep reports remaining backlog', sweepTags) &&
    ok;
  sweptCount.add(result.swept || 0, tags);

  const statusTags = scenarioTags(NAME, { endpoint: 'reconciliation_status' });
  const status = reconcileRequest('GET', RECONCILE_STATUS_PATH, undefined, statusTags, data);
  const statusBody = jsonOf(status);
  ok =
    expectStatus(status, 200, statusTags) &&
    expect(Boolean(statusBody.checkedAt), 'status endpoint reports a sweep', statusTags) &&
    expect(Number.isFinite(statusBody.remaining), 'status reports remaining backlog', statusTags) &&
    ok;

  recordOutcome(ok, tags);
}

export function handleSummary(data) {
  return writeSummary(data, [NAME]);
}
