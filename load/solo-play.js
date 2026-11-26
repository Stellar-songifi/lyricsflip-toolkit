import {
  baseOptions,
  baseSetup,
  envInt,
  expect,
  expectStatus,
  gameRequest,
  jsonOf,
  rampingScenario,
  recordOutcome,
  SCENARIOS,
  scenarioTags,
  tokenAt,
  writeSummary,
} from './common.js';

const NAME = SCENARIOS.solo;

export const options = baseOptions({
  [NAME]: rampingScenario(NAME, 'soloPlay'),
});

export function setup() {
  return baseSetup();
}

/**
 * Real HTTP game loop: create a solo session, fetch each public card and POST
 * a guess. `submitGuess` takes a pessimistic row lock, so this exercises the
 * lock-contention path described in issue #147.
 */
export function soloPlay(data) {
  const tags = scenarioTags(NAME, { endpoint: 'solo_round' });
  const token = tokenAt(data, __VU || 1);
  const fallbackRounds = envInt('GAME_ROUNDS', 3);
  const guess = __ENV.LOAD_GUESS || 'load test guess';

  const startTags = scenarioTags(NAME, { endpoint: 'create_session' });
  const start = gameRequest(
    'POST',
    '/game/sessions',
    { mode: 'solo' },
    startTags,
    data,
    token,
  );
  let ok = expectStatus(start, [200, 201], startTags);
  const session = jsonOf(start);
  if (!ok || !session.id) {
    recordOutcome(false, tags);
    return;
  }
  const totalRounds = Number(session.totalRounds || fallbackRounds);

  for (let round = 0; round < totalRounds; round += 1) {
    const lyricTags = scenarioTags(NAME, { endpoint: 'current_lyric' });
    const lyricResponse = gameRequest(
      'GET',
      `/game/sessions/${session.id}/lyric`,
      undefined,
      lyricTags,
      data,
      token,
    );
    const lyric = jsonOf(lyricResponse);
    ok =
      expectStatus(lyricResponse, 200, lyricTags) &&
      expect(Boolean(lyric.id && lyric.snippet), 'public lyric returned', lyricTags) &&
      ok;
    if (!lyric.id) break;

    const guessTags = scenarioTags(NAME, { endpoint: 'submit_guess' });
    const guessResponse = gameRequest(
      'POST',
      '/game/guess',
      { sessionId: session.id, guess },
      guessTags,
      data,
      token,
    );
    const result = jsonOf(guessResponse);
    ok = expectStatus(guessResponse, [200, 201], guessTags) && ok;
    if (result.sessionStatus === 'finished') break;
  }

  const summaryTags = scenarioTags(NAME, { endpoint: 'read_session' });
  const read = gameRequest(
    'GET',
    `/game/sessions/${session.id}`,
    undefined,
    summaryTags,
    data,
    token,
  );
  const final = jsonOf(read);
  ok =
    expectStatus(read, 200, summaryTags) &&
    expect(final.status === 'finished', 'session finished', summaryTags) &&
    ok;

  recordOutcome(ok, tags);
}

export function handleSummary(data) {
  return writeSummary(data, [NAME]);
}
