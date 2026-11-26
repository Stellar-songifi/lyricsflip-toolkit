import {
  baseOptions,
  baseSetup,
  envInt,
  expect,
  expectStatus,
  gameRequest,
  jsonOf,
  pollUntil,
  rampingScenario,
  recordOutcome,
  SCENARIOS,
  scenarioTags,
  settlementWait,
  tokenAt,
  wagerRequest,
  writeSummary,
} from './common.js';

const NAME = SCENARIOS.wager;

export const options = baseOptions({
  [NAME]: rampingScenario(NAME, 'headToHeadStaking'),
});

export function setup() {
  return baseSetup({ requireTwoTokens: true });
}

/**
 * Two pre-provisioned users create and accept a staked challenge, both stake
 * in mock settlement mode, play the resulting head-to-head session, then wait
 * for the server-side settlement listener to reach a terminal wager state.
 */
export function headToHeadStaking(data) {
  const tags = scenarioTags(NAME, { endpoint: 'match_lifecycle' });
  const tokens = data.tokens || [];
  const pairCount = Math.floor(tokens.length / 2);
  const pairIndex = (__ITER || 0) % pairCount;
  const hostToken = tokenAt(data, pairIndex * 2);
  const guestToken = tokenAt(data, pairIndex * 2 + 1);
  const stakeAmount = String(__ENV.WAGER_STAKE || '50000000');
  const pollTimeoutMs = envInt('SETTLEMENT_POLL_TIMEOUT_MS', 10000);

  const createTags = scenarioTags(NAME, { endpoint: 'create_challenge' });
  const created = gameRequest(
    'POST',
    '/challenges',
    { stakeAmount },
    createTags,
    data,
    hostToken,
  );
  let ok = expectStatus(created, [200, 201], createTags);
  const challenge = jsonOf(created);
  if (!ok || !challenge.code) {
    recordOutcome(false, tags);
    return;
  }

  const previewTags = scenarioTags(NAME, { endpoint: 'preview_challenge' });
  const preview = gameRequest(
    'GET',
    `/challenges/${challenge.code}`,
    undefined,
    previewTags,
    data,
    guestToken,
  );
  ok =
    expectStatus(preview, 200, previewTags) &&
    expect(jsonOf(preview).stakeAmount === stakeAmount, 'stake shown before acceptance', previewTags) &&
    ok;

  const acceptTags = scenarioTags(NAME, { endpoint: 'accept_challenge' });
  const accepted = gameRequest(
    'POST',
    `/challenges/${challenge.code}/accept`,
    {},
    acceptTags,
    data,
    guestToken,
  );
  const match = jsonOf(accepted);
  ok =
    expectStatus(accepted, [200, 201], acceptTags) &&
    expect(Boolean(match.wagerId && match.gameSessionId), 'staked match and wager created', acceptTags) &&
    ok;
  if (!ok || !match.wagerId || !match.gameSessionId) {
    recordOutcome(false, tags);
    return;
  }

  for (const [label, token] of [
    ['host', hostToken],
    ['guest', guestToken],
  ]) {
    const txTags = scenarioTags(NAME, { endpoint: 'stake_transaction' });
    const tx = wagerRequest(
      'POST',
      `/wagers/${match.wagerId}/stake-transaction`,
      {},
      txTags,
      data,
      token,
    );
    ok =
      expectStatus(tx, 200, txTags) &&
      expect(jsonOf(tx).transaction === null, `${label} needs no signature in mock mode`, txTags) &&
      ok;
  }

  for (const [label, token] of [
    ['host', hostToken],
    ['guest', guestToken],
  ]) {
    const stakeTags = scenarioTags(NAME, { endpoint: 'stake' });
    const staked = wagerRequest('POST', `/wagers/${match.wagerId}/stake`, {}, stakeTags, data, token);
    ok =
      expectStatus(staked, 200, stakeTags) &&
      expect(Boolean(jsonOf(staked).id), `${label} stake recorded`, stakeTags) &&
      ok;
  }

  const activationTags = scenarioTags(NAME, { endpoint: 'wait_for_active' });
  const active = pollUntil(() => {
    const response = gameRequest(
      'GET',
      `/game/sessions/${match.gameSessionId}`,
      undefined,
      activationTags,
      data,
      hostToken,
    );
    return expectStatus(response, 200, activationTags) && jsonOf(response).status === 'active'
      ? jsonOf(response)
      : null;
  }, pollTimeoutMs);
  ok = expect(Boolean(active), 'match activated after both stakes', activationTags) && ok;
  if (!active) {
    recordOutcome(false, tags);
    return;
  }

  const totalRounds = Number(active.totalRounds || envInt('GAME_ROUNDS', 10));
  const winningGuess = __ENV.LOAD_WINNING_GUESS || 'load test guess';
  const losingGuess = __ENV.LOAD_LOSING_GUESS || 'wrong answer';
  const settleStart = Date.now();

  for (let round = 0; round < totalRounds; round += 1) {
    const hostTurn = round % 2 === 0;
    const guessTags = scenarioTags(NAME, { endpoint: 'submit_guess' });
    const result = gameRequest(
      'POST',
      '/game/guess',
      {
        sessionId: match.gameSessionId,
        guess: hostTurn ? winningGuess : losingGuess,
      },
      guessTags,
      data,
      hostTurn ? hostToken : guestToken,
    );
    ok = expectStatus(result, [200, 201], guessTags) && ok;
    if (jsonOf(result).sessionStatus === 'finished') break;
  }

  const finishedTags = scenarioTags(NAME, { endpoint: 'read_finished_session' });
  const finished = gameRequest(
    'GET',
    `/game/sessions/${match.gameSessionId}`,
    undefined,
    finishedTags,
    data,
    hostToken,
  );
  ok =
    expectStatus(finished, 200, finishedTags) &&
    expect(jsonOf(finished).status === 'finished', 'match finished', finishedTags) &&
    ok;

  const terminalTags = scenarioTags(NAME, { endpoint: 'wait_for_settlement' });
  const settled = pollUntil(() => {
    const response = wagerRequest(
      'GET',
      `/wagers/${match.wagerId}`,
      undefined,
      terminalTags,
      data,
      guestToken,
    );
    if (!expectStatus(response, 200, terminalTags)) return null;
    const wager = jsonOf(response);
    return ['won', 'refunded'].includes(wager.status) ? wager : null;
  }, pollTimeoutMs);

  settlementWait.add(Date.now() - settleStart, tags);
  ok =
    expect(Boolean(settled), 'wager reached a terminal settlement state', terminalTags) &&
    expect(
      settled ? ['payout', 'refund'].includes(settled.settlementKind) : false,
      'settlement kind recorded',
      terminalTags,
    ) &&
    ok;

  recordOutcome(ok, tags);
}

export function handleSummary(data) {
  return writeSummary(data, [NAME]);
}
