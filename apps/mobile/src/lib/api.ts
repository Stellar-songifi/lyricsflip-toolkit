/** Typed client for apps/game-server. Every call but sign-in sends the JWT. */

export interface User {
  id: string;
  username: string;
  walletAddress: string | null;
  xp: number;
  level: string;
  correctGuesses: number;
  gamesPlayed: number;
  nextLevel?: { level: string; minXp: number } | null;
}

export interface PublicLyric {
  id: string;
  snippet: string;
  genre: string;
  decade: number;
}

export type GuessOutcome = 'correct' | 'partial' | 'miss';

export interface GuessResult {
  outcome: GuessOutcome;
  pointsAwarded: number;
  streak: number;
  nextLyric: PublicLyric | null;
  sessionStatus: 'waiting' | 'active' | 'finished' | 'cancelled';
}

export interface GameSession {
  id: string;
  mode: 'solo' | 'room' | 'head_to_head';
  status: 'waiting' | 'active' | 'finished' | 'cancelled';
  playerIds: string[];
  currentRound: number;
  scores: Record<string, number>;
}

export interface Challenge {
  code: string;
  status: 'pending' | 'accepted' | 'expired';
  hostUserId: string;
  stakeAmount: string | null;
  gameSessionId: string | null;
  wagerId: string | null;
  expiresAt: string;
}

export type WagerStatus =
  | 'pending'
  | 'awaiting_stakes'
  | 'staked'
  | 'settling'
  | 'won'
  | 'refunded'
  | 'cancelled'
  | 'failed';

export interface Wager {
  id: string;
  matchId: string;
  playerAId: string;
  playerBId: string;
  stakeAmount: string;
  status: WagerStatus;
  playerAStakedAt: string | null;
  playerBStakedAt: string | null;
  winnerId: string | null;
  settlementTxHash: string | null;
}

export interface DailyView {
  date: string;
  totalPoints: number;
  complete: boolean;
  lyrics: Array<
    PublicLyric & { attempt: { outcome: GuessOutcome; points: number; title: string; artist: string } | null }
  >;
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApi(
  baseUrl: string,
  getToken: () => string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = 30_000,
) {
  async function request<T>(method: string, path: string, body?: unknown, customTimeoutMs?: number): Promise<T> {
    const token = getToken();
    const controller = new AbortController();
    const effectiveTimeout = customTimeoutMs ?? timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const message = Array.isArray(json?.message) ? json.message.join(', ') : json?.message;
        throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
      }
      return json as T;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }
      if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) {
        throw new ApiError(408, 'Request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    auth: {
      challenge: (walletAddress: string) =>
        request<{ transactionXdr: string; networkPassphrase: string }>('POST', '/auth/stellar/challenge', {
          walletAddress,
        }),
      verify: (walletAddress: string, signedTransactionXdr: string) =>
        request<{ accessToken: string; user: User }>('POST', '/auth/stellar/verify', {
          walletAddress,
          signedTransactionXdr,
        }),
    },
    users: {
      me: () => request<User>('GET', '/users/me'),
      rename: (username: string) => request<User>('PATCH', '/users/me', { username }),
      leaderboard: () => request<User[]>('GET', '/users/leaderboard'),
    },
    game: {
      create: (mode: 'solo' | 'room') => request<GameSession>('POST', '/game/sessions', { mode }),
      join: (id: string) => request<GameSession>('POST', `/game/sessions/${id}/join`),
      get: (id: string) => request<GameSession>('GET', `/game/sessions/${id}`),
      lyric: (id: string) => request<PublicLyric>('GET', `/game/sessions/${id}/lyric`),
      guess: (sessionId: string, guess: string) =>
        request<GuessResult>('POST', '/game/guess', { sessionId, guess }),
    },
    daily: {
      today: () => request<DailyView>('GET', '/daily'),
      guess: (lyricId: string, guess: string) =>
        request<{ outcome: GuessOutcome; points: number; title: string; artist: string }>('POST', '/daily/guess', {
          lyricId,
          guess,
        }),
    },
    challenges: {
      create: (stakeAmount?: string, opponentUsername?: string) =>
        request<Challenge>('POST', '/challenges', {
          ...(stakeAmount ? { stakeAmount } : {}),
          ...(opponentUsername ? { opponentUsername } : {}),
        }),
      get: (code: string) => request<Challenge>('GET', `/challenges/${encodeURIComponent(code)}`),
      accept: (code: string) =>
        request<{ gameSessionId: string; wagerId: string | null }>(
          'POST',
          `/challenges/${encodeURIComponent(code)}/accept`,
        ),
    },
    wagers: {
      list: () => request<Wager[]>('GET', '/wagers'),
      get: (id: string) => request<Wager>('GET', `/wagers/${id}`),
      stakeTransaction: (id: string) =>
        request<{ transaction: { transactionXdr: string; networkPassphrase: string } | null }>(
          'POST',
          `/wagers/${id}/stake-transaction`,
        ),
      stake: (id: string, signedTransactionXdr?: string) =>
        request<Wager>('POST', `/wagers/${id}/stake`, signedTransactionXdr ? { signedTransactionXdr } : {}),
    },
    faucet: {
      info: () =>
        request<{ enabled: boolean; asset: string | null; amount: string | null; rpcUrl: string | null; networkPassphrase: string | null }>(
          'GET',
          '/faucet',
          undefined,
          10_000,
        ),
      claim: () => request<{ txHash: string; amount: string }>('POST', '/faucet', undefined, 10_000),
    },
    notifications: {
      list: () => request<Notification[]>('GET', '/notifications'),
    },
    push: {
      register: (token: string, platform: 'ios' | 'android') =>
        request<{ token: string }>('POST', '/push-tokens', { token, platform }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
