#!/usr/bin/env node
'use strict';

/**
 * Test-only stand-in for the game server's Postgres state and the mock
 * settlement/indexer write path. The real toolkit exposes HTTP create/guess,
 * challenge and stake routes, but settlement and reconciliation are
 * in-process services (see WagerService / WagerReconcilerService), and there
 * is no HTTP admin trigger. This harness mirrors those state machines and
 * exposes a test-only sweep trigger so k6 can drive them concurrently.
 */

const http = require('node:http');
const { createHash, randomUUID } = require('node:crypto');

const PORT = Number.parseInt(process.env.MOCK_PORT || '4555', 10);
const BASE_LATENCY_MS = Number.parseInt(process.env.MOCK_LATENCY_MS || '5', 10);
const JITTER_MS = Number.parseInt(process.env.MOCK_JITTER_MS || '10', 10);
const MOCK_ROUNDS = Number.parseInt(process.env.MOCK_ROUNDS || '3', 10);
const MIN_AGE_MS = Number.parseInt(process.env.RECONCILE_MIN_AGE_MS || '60000', 10);
const MAX_ATTEMPTS = Number.parseInt(process.env.RECONCILE_MAX_ATTEMPTS || '8', 10);

const sessions = new Map();
const challenges = new Map();
const wagers = new Map();
const pots = new Map();
const lyrics = new Map();
const locks = new Map();
let lastReconciliation = null;
let requestCount = 0;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(res, status, message) {
  send(res, status, { statusCode: status, message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function simulateWork() {
  const wait = Math.max(0, BASE_LATENCY_MS + Math.floor(Math.random() * (JITTER_MS + 1)));
  await new Promise((resolve) => setTimeout(resolve, wait));
}

async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function playerId(token) {
  const hash = createHash('sha256').update(token || 'anonymous').digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function walletFor(token) {
  const hash = createHash('sha256').update(`wallet:${token || 'anonymous'}`).digest('hex');
  return `G${hash.slice(0, 55).toUpperCase()}`;
}

function requirePlayer(req, res) {
  const token = bearerToken(req);
  if (!token) {
    fail(res, 401, 'Bearer token required');
    return null;
  }
  return { token, id: playerId(token) };
}

function newLyric(index) {
  const id = randomUUID();
  const lyric = {
    id,
    snippet: `Load-test lyric snippet ${index + 1}`,
    title: `Load Test Song ${index + 1}`,
    artist: `Load Test Artist ${index + 1}`,
    genre: 'Pop',
    decade: 2010,
  };
  lyrics.set(id, lyric);
  return lyric;
}

function publicLyric(lyric) {
  // The real toPublicLyric() hides title and artist: guesses are scoring
  // attempts, not lookups of the answer.
  const { id, snippet, genre, decade } = lyric;
  return { id, snippet, genre, decade };
}

function sessionDto(session) {
  return {
    id: session.id,
    mode: session.mode,
    status: session.status,
    playerIds: [...session.playerIds],
    currentLyricId: session.currentLyricId,
    currentRound: session.currentRound,
    totalRounds: session.totalRounds,
    scores: { ...session.scores },
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function challengeDto(challenge) {
  return {
    code: challenge.code,
    status: challenge.status,
    hostUserId: challenge.hostUserId,
    stakeAmount: challenge.stakeAmount,
    gameSessionId: challenge.gameSessionId,
    wagerId: challenge.wagerId,
    expiresAt: challenge.expiresAt,
  };
}

function wagerDto(wager) {
  return { ...wager };
}

function newSession(userId, mode, status, totalRounds) {
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    mode,
    status,
    playerIds: [userId],
    currentLyricId: newLyric(0).id,
    currentRound: 1,
    totalRounds,
    scores: {},
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.id, session);
  return session;
}

function settleSession(session) {
  const wager = [...wagers.values()].find((entry) => entry.matchId === session.id);
  if (!wager || wager.status !== 'staked') return;
  const pot = pots.get(wager.id);
  const scoreA = session.scores[wager.playerAId] || 0;
  const scoreB = session.scores[wager.playerBId] || 0;
  const now = new Date().toISOString();

  if (scoreA === scoreB) {
    wager.status = 'refunded';
    wager.settlementKind = 'refund';
    wager.winnerId = null;
    if (pot) pot.status = 'refunded';
  } else {
    const winnerId = scoreA > scoreB ? wager.playerAId : wager.playerBId;
    wager.status = 'won';
    wager.settlementKind = 'payout';
    wager.winnerId = winnerId;
    if (pot) {
      pot.status = 'resolved';
      pot.winner = winnerId === wager.playerAId ? wager.playerAAddress : wager.playerBAddress;
    }
  }
  wager.updatedAt = now;
}

function countByStatus(entries) {
  const result = {};
  for (const entry of entries) result[entry.status] = (result[entry.status] || 0) + 1;
  return result;
}

async function handleGame(req, res, pathname) {
  const player = requirePlayer(req, res);
  if (!player) return;

  if (req.method === 'POST' && pathname === '/game/sessions') {
    await simulateWork();
    const body = await readBody(req);
    if (!['solo', 'room'].includes(body.mode)) {
      return fail(res, 400, 'Start head-to-head matches with POST /challenges');
    }
    const session = newSession(player.id, body.mode, 'active', MOCK_ROUNDS);
    return send(res, 201, sessionDto(session));
  }

  const sessionMatch = pathname.match(/^\/game\/sessions\/([^/]+)$/);
  if (req.method === 'GET' && sessionMatch) {
    const session = sessions.get(decodeURIComponent(sessionMatch[1]));
    if (!session) return fail(res, 404, 'Session not found');
    await simulateWork();
    return send(res, 200, sessionDto(session));
  }

  const lyricMatch = pathname.match(/^\/game\/sessions\/([^/]+)\/lyric$/);
  if (req.method === 'GET' && lyricMatch) {
    const session = sessions.get(decodeURIComponent(lyricMatch[1]));
    if (!session) return fail(res, 404, 'Session not found');
    await simulateWork();
    if (!session.currentLyricId) return fail(res, 400, 'Session has no active card');
    return send(res, 200, publicLyric(lyrics.get(session.currentLyricId)));
  }

  if (req.method === 'POST' && pathname === '/game/guess') {
    const body = await readBody(req);
    if (!body.sessionId || typeof body.guess !== 'string') {
      return fail(res, 400, 'sessionId and guess are required');
    }
    return withLock(`session:${body.sessionId}`, async () => {
      await simulateWork();
      const session = sessions.get(body.sessionId);
      if (!session) return fail(res, 404, 'Session not found');
      if (session.status !== 'active') return fail(res, 400, 'Session is not active');
      if (!session.currentLyricId) return fail(res, 400, 'Session has no active card');
      if (!session.playerIds.includes(player.id)) {
        return fail(res, 400, 'Player is not part of this session');
      }

      const lyric = lyrics.get(session.currentLyricId);
      const guess = body.guess.trim().toLowerCase();
      const correct =
        guess === lyric.title.toLowerCase() || guess === lyric.artist.toLowerCase();
      const points = correct ? 100 : 0;
      session.scores[player.id] = (session.scores[player.id] || 0) + points;
      session.updatedAt = new Date().toISOString();

      let nextLyric = null;
      if (session.currentRound >= session.totalRounds) {
        session.status = 'finished';
        session.currentLyricId = null;
        settleSession(session);
      } else {
        session.currentRound += 1;
        const next = newLyric(session.currentRound);
        session.currentLyricId = next.id;
        nextLyric = publicLyric(next);
      }

      return send(res, 201, {
        outcome: correct ? 'correct' : 'miss',
        pointsAwarded: points,
        streak: correct ? (session.scores[player.id] / 100) : 0,
        nextLyric,
        sessionStatus: session.status,
        totalRounds: session.totalRounds,
      });
    });
  }

  return fail(res, 404, 'Unknown game route');
}

async function handleChallenges(req, res, pathname) {
  const player = requirePlayer(req, res);
  if (!player) return;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  if (req.method === 'POST' && pathname === '/challenges') {
    await simulateWork();
    const body = await readBody(req);
    const stakeAmount = body.stakeAmount === undefined ? null : String(body.stakeAmount);
    if (stakeAmount !== null && !/^\d+$/.test(stakeAmount)) {
      return fail(res, 400, 'stakeAmount must be a string of digits');
    }
    let code;
    do {
      code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (challenges.has(code));
    const challenge = {
      code,
      status: 'pending',
      hostUserId: player.id,
      stakeAmount,
      gameSessionId: null,
      wagerId: null,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    challenges.set(code, challenge);
    return send(res, 201, challengeDto(challenge));
  }

  const previewMatch = pathname.match(/^\/challenges\/([^/]+)$/);
  if (req.method === 'GET' && previewMatch) {
    const challenge = challenges.get(decodeURIComponent(previewMatch[1]));
    if (!challenge) return fail(res, 404, 'Challenge not found');
    await simulateWork();
    return send(res, 200, challengeDto(challenge));
  }

  const acceptMatch = pathname.match(/^\/challenges\/([^/]+)\/accept$/);
  if (req.method === 'POST' && acceptMatch) {
    await simulateWork();
    const challenge = challenges.get(decodeURIComponent(acceptMatch[1]));
    if (!challenge) return fail(res, 404, 'Challenge not found');
    if (challenge.status !== 'pending') return fail(res, 400, 'Challenge is not pending');
    if (challenge.hostUserId === player.id) return fail(res, 400, 'Cannot accept your own challenge');

    const session = newSession(challenge.hostUserId, 'head_to_head', 'waiting', MOCK_ROUNDS);
    session.playerIds.push(player.id);
    const now = new Date().toISOString();
    const wager = {
      id: randomUUID(),
      matchId: session.id,
      playerAId: challenge.hostUserId,
      playerBId: player.id,
      stakeAmount: challenge.stakeAmount,
      status: 'awaiting_stakes',
      playerAAddress: walletFor(challenge.hostUserId),
      playerBAddress: walletFor(player.id),
      acceptedAt: now,
      potDeadlineLedger: null,
      playerAStakedAt: null,
      playerBStakedAt: null,
      settlementKind: null,
      winnerId: null,
      reconcileAttempts: 0,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };
    wagers.set(wager.id, wager);
    pots.set(wager.id, {
      id: wager.id,
      playerA: wager.playerAAddress,
      playerB: wager.playerBAddress,
      stakeAmount: wager.stakeAmount,
      status: 'open',
      playerAStaked: false,
      playerBStaked: false,
      winner: null,
    });

    challenge.status = 'accepted';
    challenge.gameSessionId = session.id;
    challenge.wagerId = wager.id;
    return send(res, 201, { gameSessionId: session.id, wagerId: wager.id });
  }

  return fail(res, 404, 'Unknown challenge route');
}

async function handleWagers(req, res, pathname) {
  const player = requirePlayer(req, res);
  if (!player) return;

  if (req.method === 'GET' && pathname === '/wagers') {
    await simulateWork();
    return send(res, 200, [...wagers.values()]
      .filter((wager) => wager.playerAId === player.id || wager.playerBId === player.id)
      .slice(0, 50)
      .map(wagerDto));
  }

  const routeMatch = pathname.match(/^\/wagers\/([^/]+)(?:\/(stake-transaction|stake))?$/);
  if (!routeMatch) return fail(res, 404, 'Unknown wager route');
  const wager = wagers.get(decodeURIComponent(routeMatch[1]));
  if (!wager) return fail(res, 404, 'Wager not found');
  if (wager.playerAId !== player.id && wager.playerBId !== player.id) {
    return fail(res, 403, 'Wager belongs to other players');
  }

  if (req.method === 'GET' && !routeMatch[2]) {
    await simulateWork();
    return send(res, 200, wagerDto(wager));
  }

  if (req.method === 'POST' && routeMatch[2] === 'stake-transaction') {
    await simulateWork();
    return send(res, 200, { transaction: null });
  }

  if (req.method === 'POST' && routeMatch[2] === 'stake') {
    return withLock(`wager:${wager.id}`, async () => {
      await simulateWork();
      if (wager.status !== 'awaiting_stakes') return fail(res, 400, 'Wager is not awaiting stakes');
      const pot = pots.get(wager.id);
      if (!pot || pot.status !== 'open') return fail(res, 400, 'Pot is not open');
      const isA = wager.playerAId === player.id;
      if (isA ? pot.playerAStaked : pot.playerBStaked) {
        return fail(res, 400, 'Player already staked');
      }
      if (isA) {
        pot.playerAStaked = true;
        wager.playerAStakedAt = new Date().toISOString();
      } else {
        pot.playerBStaked = true;
        wager.playerBStakedAt = new Date().toISOString();
      }
      if (pot.playerAStaked && pot.playerBStaked) {
        pot.status = 'staked';
        wager.status = 'staked';
        const session = sessions.get(wager.matchId);
        if (session && session.status === 'waiting') session.status = 'active';
      }
      wager.updatedAt = new Date().toISOString();
      return send(res, 200, wagerDto(wager));
    });
  }

  return fail(res, 404, 'Unknown wager route');
}

async function seedBacklog(req, res) {
  await simulateWork();
  const body = await readBody(req);
  const count = Math.min(Math.max(Number.parseInt(body.count, 10) || 0, 0), 10000);
  const status = body.status === 'pending' ? 'pending' : 'awaiting_stakes';
  const stakeAmount = String(body.stakeAmount || '50000000');
  const backdated = new Date(Date.now() - MIN_AGE_MS - 1000).toISOString();

  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const playerAId = playerId(`backlog-a-${index}`);
    const playerBId = playerId(`backlog-b-${index}`);
    wagers.set(id, {
      id,
      matchId: `backlog-${id}`,
      playerAId,
      playerBId,
      stakeAmount,
      status,
      playerAAddress: walletFor(`backlog-a-${index}`),
      playerBAddress: walletFor(`backlog-b-${index}`),
      acceptedAt: status === 'pending' ? null : backdated,
      potDeadlineLedger: null,
      playerAStakedAt: status === 'awaiting_stakes' ? backdated : null,
      playerBStakedAt: null,
      settlementKind: null,
      winnerId: null,
      reconcileAttempts: 0,
      failureReason: null,
      createdAt: backdated,
      updatedAt: backdated,
    });
    if (status === 'awaiting_stakes') {
      pots.set(id, {
        id,
        playerA: walletFor(`backlog-a-${index}`),
        playerB: walletFor(`backlog-b-${index}`),
        stakeAmount,
        status: 'open',
        playerAStaked: true,
        playerBStaked: false,
        winner: null,
        deadlineLedger: Math.floor(Date.now() / 5000) - 1,
      });
    }
  }

  const pending = [...wagers.values()].filter((wager) =>
    ['pending', 'awaiting_stakes', 'settling'].includes(wager.status),
  ).length;
  return send(res, 201, { created: count, pending, status });
}

async function sweepOnce() {
  const now = Date.now();
  const threshold = now - MIN_AGE_MS;
  const due = [...wagers.values()].filter(
    (wager) =>
      ['pending', 'awaiting_stakes', 'settling'].includes(wager.status) &&
      Date.parse(wager.updatedAt) < threshold,
  );
  const before = countByStatus(due);
  let swept = 0;

  for (const wager of due) {
    const statusBefore = wager.status;
    const attemptsBefore = wager.reconcileAttempts;
    const pot = pots.get(wager.id);

    if (wager.status === 'pending') {
      if (wager.acceptedAt) {
        wager.status = 'awaiting_stakes';
        if (pot) pot.status = 'open';
      } else {
        wager.status = 'cancelled';
      }
    } else if (wager.status === 'awaiting_stakes') {
      if (pot && pot.playerAStaked && pot.playerBStaked) {
        wager.status = 'staked';
        pot.status = 'staked';
      } else {
        wager.status = 'refunded';
        if (pot) pot.status = 'refunded';
      }
    } else if (wager.status === 'settling') {
      if (pot && pot.status === 'resolved') wager.status = 'won';
      else if (pot && pot.status === 'refunded') wager.status = 'refunded';
      else if (!pot || wager.reconcileAttempts + 1 >= MAX_ATTEMPTS) {
        wager.status = 'failed';
        wager.failureReason = 'Settlement did not land after retries';
      } else {
        wager.reconcileAttempts += 1;
      }
    }

    wager.updatedAt = new Date().toISOString();
    if (wager.status !== statusBefore || wager.reconcileAttempts !== attemptsBefore) swept += 1;
  }

  const remaining = [...wagers.values()].filter((wager) =>
    ['pending', 'awaiting_stakes', 'settling'].includes(wager.status),
  ).length;
  return {
    checkedAt: new Date().toISOString(),
    due: due.length,
    swept,
    remaining,
    matched: true,
    statusesBefore: before,
    statusesAfter: countByStatus(due),
    reconcileLockKey: 7139001,
  };
}

async function handleReconciliation(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/mock/reconcile') {
    return withLock('reconcile', async () => {
      await simulateWork();
      lastReconciliation = await sweepOnce();
      return send(res, 200, lastReconciliation);
    });
  }

  if (req.method === 'GET' && pathname === '/mock/reconcile/status') {
    if (!lastReconciliation) return fail(res, 404, 'No reconciliation result yet');
    return send(res, 200, lastReconciliation);
  }

  return fail(res, 404, 'Unknown reconciliation route');
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  requestCount += 1;
  if (requestCount === 1 || requestCount % 500 === 0) {
    process.stderr.write(`[load-harness] handled ${requestCount} requests\n`);
  }

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/health/live')) {
    return send(res, 200, {
      status: 'ok',
      service: 'lyricsflip-game-server',
      timestamp: new Date().toISOString(),
      mode: 'mock-settlement',
    });
  }
  if (pathname.startsWith('/game/')) return handleGame(req, res, pathname);
  if (pathname.startsWith('/challenges')) return handleChallenges(req, res, pathname);
  if (pathname.startsWith('/wagers')) return handleWagers(req, res, pathname);
  if (req.method === 'POST' && pathname === '/mock/wagers/backlog') return seedBacklog(req, res);
  if (pathname.startsWith('/mock/reconcile')) return handleReconciliation(req, res, pathname);
  return fail(res, 404, 'Unknown route');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    process.stderr.write(`[load-harness] ${error.stack || error.message}\n`);
    if (!res.headersSent) fail(res, 500, 'Internal mock harness error');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`[load-harness] mock settlement ready on http://127.0.0.1:${PORT}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
