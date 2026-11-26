import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

export const SCENARIOS = {
  solo: 'solo_play',
  wager: 'head_to_head_staking',
  reconcile: 'reconcile_backlog',
};

const stripSlash = (value) => String(value || '').replace(/\/+$/, '');

/** The game server has no global API prefix; Swagger is the only /api path. */
export const BASE_URL = stripSlash(__ENV.BASE_URL || 'http://127.0.0.1:4555');
export const MOCK_URL = stripSlash(__ENV.MOCK_SETTLEMENT_URL || BASE_URL);
export const WAGER_URL = stripSlash(__ENV.WAGER_BASE_URL || BASE_URL);
export const RECONCILE_URL = stripSlash(__ENV.RECONCILE_TRIGGER_URL || MOCK_URL);
export const RECONCILE_PATH = __ENV.RECONCILE_PATH || '/mock/reconcile';
export const RECONCILE_STATUS_PATH =
  __ENV.RECONCILE_STATUS_PATH || '/mock/reconcile/status';
export const ENVIRONMENT =
  __ENV.ENVIRONMENT ||
  (/^(http:\/\/)?(127\.0\.0\.1|localhost)/.test(BASE_URL) ? 'local-mock' : 'staging');
export const SUMMARY_EXPORT = __ENV.SUMMARY_EXPORT || 'load/last-run-summary.json';

export const VUS = positiveInt(__ENV.LOAD_VUS, 10);
export const RAMP_UP = __ENV.LOAD_RAMP_UP || '5s';
export const STEADY_DURATION = __ENV.LOAD_DURATION || '20s';
export const RAMP_DOWN = __ENV.LOAD_RAMP_DOWN || '5s';
export const REQUEST_TIMEOUT_MS = positiveInt(__ENV.REQUEST_TIMEOUT_MS, 10000);

export const scenarioSuccess = new Rate('scenario_success');
export const businessError = new Rate('business_error');
export const endpointLatency = new Trend('scenario_req_duration', true);
export const backlogSize = new Gauge('reconcile_backlog_size');
export const sweptCount = new Counter('reconcile_swept_count');
export const settlementWait = new Trend('settlement_wait_ms', true);

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function envInt(name, fallback) {
  return positiveInt(__ENV[name], fallback);
}

/** Tokens are provisioned once before the run; k6 cannot sign Stellar SEP-10 challenges. */
function loadTokens() {
  if (__ENV.LOAD_TOKEN_FILE) {
    const text = open(__ENV.LOAD_TOKEN_FILE);
    try {
      const parsed = JSON.parse(text);
      const values = Array.isArray(parsed)
        ? parsed.map((entry) => (typeof entry === 'string' ? entry : entry.token))
        : [];
      const tokens = values.filter(Boolean);
      if (tokens.length) return tokens;
    } catch (_) {
      // Treat a non-JSON file as one token per line.
    }
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length) return lines;
  }

  const raw = __ENV.LOAD_AUTH_TOKENS || __ENV.LOAD_AUTH_TOKEN || '';
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length) return tokens;

  // The local harness deliberately accepts these two synthetic identities.
  if (ENVIRONMENT === 'local-mock') return ['local-a', 'local-b'];
  return [];
}

export const TOKENS = loadTokens();

export function scenarioTags(name, extra = {}) {
  return { scenario: name, environment: ENVIRONMENT, ...extra };
}

function requestHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function request(method, url, body, tags, data, tokenOverride) {
  const safeTags = tags || {};
  const token = tokenOverride !== undefined ? tokenOverride : data && data.token;
  const params = {
    headers: requestHeaders(token),
    // Generated session/wager/challenge IDs must not create a time series each.
    tags: { name: safeTags.endpoint || 'request', ...safeTags },
    timeout: `${REQUEST_TIMEOUT_MS}ms`,
  };
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = http.request(method, url, payload, params);
  endpointLatency.add(response.timings.duration, safeTags);
  return response;
}

/** Game routes are unprefixed in the toolkit game server. */
export function gameRequest(method, path, body, tags, data, token) {
  return request(method, `${BASE_URL}${path}`, body, tags, data, token);
}

export function wagerRequest(method, path, body, tags, data, token) {
  return request(method, `${WAGER_URL}${path}`, body, tags, data, token);
}

/** Test-only harness endpoints (backlog seed, reconcile trigger). */
export function mockRequest(method, path, body, tags, data) {
  return request(method, `${MOCK_URL}${path}`, body, tags, data);
}

export function reconcileRequest(method, path, body, tags, data) {
  return request(method, `${RECONCILE_URL}${path}`, body, tags, data);
}

export function jsonOf(response) {
  try {
    return response && response.json ? response.json() : {};
  } catch (_) {
    return {};
  }
}

export function expectStatus(response, statuses, tags) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  const label = allowed.length === 1 ? `status ${allowed[0]}` : `status in ${allowed.join('/')}`;
  return check(response, { [label]: (res) => allowed.includes(res.status) }, tags);
}

export function expect(condition, description, tags) {
  return check(null, { [description]: () => Boolean(condition) }, tags);
}

export function recordOutcome(ok, tags) {
  scenarioSuccess.add(ok ? 1 : 0, tags);
  businessError.add(ok ? 0 : 1, tags);
}

export function tokenAt(data, index) {
  const tokens = (data && data.tokens) || TOKENS;
  if (!tokens.length) return '';
  return tokens[((index % tokens.length) + tokens.length) % tokens.length];
}

export function pollUntil(checkFn, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = checkFn();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    sleep(intervalMs / 1000);
  }
}

async function seedBacklog(count) {
  const tags = scenarioTags('setup', { endpoint: 'seed_backlog' });
  const response = mockRequest(
    'POST',
    '/mock/wagers/backlog',
    {
      count,
      status: __ENV.RECONCILE_BACKLOG_STATUS || 'awaiting_stakes',
      stakeAmount: __ENV.WAGER_STAKE || '50000000',
    },
    tags,
  );
  if (!expectStatus(response, [200, 201], tags)) {
    throw new Error(`Could not seed ${count} pending wagers into the mock settlement harness`);
  }
  return jsonOf(response).pending || count;
}

export async function baseSetup(options = {}) {
  if (options.requireTwoTokens && TOKENS.length < 2) {
    throw new Error(
      'head_to_head_staking needs at least two tokens. Set LOAD_AUTH_TOKENS or LOAD_TOKEN_FILE.',
    );
  }
  const backlog = options.seedBacklog ? await seedBacklog(envInt('RECONCILE_BACKLOG', 200)) : 0;
  return {
    tokens: TOKENS,
    token: tokenAt({ tokens: TOKENS }, 0),
    backlog,
    environment: ENVIRONMENT,
    baseUrl: BASE_URL,
  };
}

export function rampingScenario(name, exec, options = {}) {
  return {
    executor: 'ramping-vus',
    exec,
    startVUs: options.startVUs || 1,
    stages: [
      { duration: RAMP_UP, target: VUS },
      { duration: STEADY_DURATION, target: VUS },
      { duration: RAMP_DOWN, target: 0 },
    ],
    gracefulRampDown: '10s',
    tags: { scenario: name },
  };
}

export function constantScenario(name, exec, options = {}) {
  return {
    executor: 'constant-vus',
    exec,
    vus: options.vus || VUS,
    duration: options.duration || STEADY_DURATION,
    tags: { scenario: name },
  };
}

export function baseOptions(scenarios) {
  const p95Limit = positiveInt(__ENV.P95_LIMIT_MS, 1500);
  const p99Limit = positiveInt(__ENV.P99_LIMIT_MS, 3000);
  const errorLimit = Number(__ENV.ERROR_RATE_LIMIT || 0.05);
  const successMinimum = Number(__ENV.SUCCESS_RATE_MIN || 0.95);
  const thresholds = {};

  for (const name of Object.keys(scenarios)) {
    thresholds[`http_req_duration{scenario:${name}}`] = [
      `p(95)<${p95Limit}`,
      `p(99)<${p99Limit}`,
    ];
    thresholds[`http_req_failed{scenario:${name}}`] = [`rate<${errorLimit}`];
    thresholds[`scenario_success{scenario:${name}}`] = [`rate>${successMinimum}`];
    thresholds[`http_reqs{scenario:${name}}`] = ['rate>0'];
    thresholds[`iterations{scenario:${name}}`] = ['count>0'];
    if (name === SCENARIOS.reconcile) {
      thresholds[`reconcile_backlog_size{scenario:${name}}`] = ['value>0'];
      thresholds[`reconcile_swept_count{scenario:${name}}`] = ['count>0'];
    }
  }

  return {
    scenarios,
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}

function taggedMetric(metrics, name, scenario) {
  return metrics[`${name}{scenario:${scenario}}`] || metrics[name] || {};
}

function metricValue(metrics, name, scenario, key) {
  return (taggedMetric(metrics, name, scenario).values || {})[key] || 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value || 0) * factor) / factor;
}

export function writeSummary(data, scenarios) {
  const summary = {
    meta: {
      generatedAt: new Date().toISOString(),
      environment: ENVIRONMENT,
      baseUrl: BASE_URL,
      commit: __ENV.GITHUB_SHA || '',
      runLabel: __ENV.RUN_LABEL || '',
      durationMs: (data.state && data.state.testRunDurationMs) || 0,
    },
    scenarios: {},
    checks: {
      passed: (data.metrics.checks && data.metrics.checks.values.passes) || 0,
      failed: (data.metrics.checks && data.metrics.checks.values.fails) || 0,
      rate: (data.metrics.checks && data.metrics.checks.values.rate) || 0,
    },
  };

  for (const name of scenarios) {
    summary.scenarios[name] = {
      p95_ms: round(metricValue(data.metrics, 'http_req_duration', name, 'p(95)')),
      p99_ms: round(metricValue(data.metrics, 'http_req_duration', name, 'p(99)')),
      avg_ms: round(metricValue(data.metrics, 'http_req_duration', name, 'avg')),
      error_rate: round(metricValue(data.metrics, 'http_req_failed', name, 'rate'), 5),
      success_rate: round(metricValue(data.metrics, 'scenario_success', name, 'rate'), 5),
      requests: (taggedMetric(data.metrics, 'http_reqs', name).values || {}).count || 0,
      rps: round(metricValue(data.metrics, 'http_reqs', name, 'rate')),
      iterations: (taggedMetric(data.metrics, 'iterations', name).values || {}).count || 0,
      backlog_size:
        name === SCENARIOS.reconcile
          ? (taggedMetric(data.metrics, 'reconcile_backlog_size', name).values || {}).value || 0
          : 0,
      swept_total:
        name === SCENARIOS.reconcile
          ? (taggedMetric(data.metrics, 'reconcile_swept_count', name).values || {}).count || 0
          : 0,
      settle_wait_ms:
        name === SCENARIOS.wager
          ? round(metricValue(data.metrics, 'settlement_wait_ms', name, 'p(95)'))
          : 0,
    };
  }

  const lines = [
    '',
    `k6 summary (${ENVIRONMENT})`,
    'scenario                     p95(ms)   p99(ms)   errors    success   rps',
    '-------------------------------------------------------------------------',
  ];
  for (const [name, values] of Object.entries(summary.scenarios)) {
    lines.push(
      `${name.padEnd(28)} ${String(values.p95_ms).padStart(8)} ${String(values.p99_ms).padStart(9)} ${String(values.error_rate).padStart(8)} ${String(values.success_rate).padStart(9)} ${String(values.rps).padStart(6)}`,
    );
  }
  lines.push('');

  return {
    [SUMMARY_EXPORT]: JSON.stringify(summary, null, 2),
    stdout: lines.join('\n'),
  };
}
