/**
 * Typed client for apps/game-server. Every call but sign-in sends the JWT.
 *
 * Request/response types are generated from the server's OpenAPI document
 * (see `api-types.ts`, produced by `npm run openapi:types`). Do not hand-edit
 * those shapes here — change the server DTOs and regenerate instead.
 */

import type { components } from './api-types';

type Schemas = components['schemas'];

export type User = Schemas['UserDto'];
export type PublicLyric = Schemas['PublicLyricDto'];
export type GuessOutcome = Schemas['GuessResultDto']['outcome'];
export type GuessResult = Schemas['GuessResultDto'];
export type GameSession = Schemas['GameSessionDto'];
export type Challenge = Schemas['ChallengeDto'];
export type WagerStatus = Schemas['WagerDto']['status'];
export type Wager = Schemas['WagerDto'];
export type DailyView = Schemas['DailyViewDto'];
export type Notification = Schemas['NotificationDto'];
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
  createdAt?: string;
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
  expiresAt: string | null;
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

/** GET /notifications is an array today; #108 will add cursor pagination. */
export type NotificationPage = Notification[] | { items: Notification[]; nextCursor: string | null };

export interface LeaderboardEntry {
  id?: string;
  userId?: string;
  username: string;
  level?: string;
  xp?: number;
  points?: number;
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

/** A non-idempotent request was blocked because the device has no connectivity. */
export function isOfflineError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 0;
}

export interface ApiHooks {
  /** Report every final ApiError (used for crash reporting). */
  reportError?: (error: ApiError) => void;
  /** Called on 401, before the error reaches the calling screen. */
  onUnauthorized?: () => void;
  /** When false, writes are blocked rather than sent into a dead connection. */
  isOnline?: () => boolean;
}

const MAX_READ_RETRIES = 2;
const RETRY_BASE_MS = 250;

export function createApi(
  baseUrl: string,
  getToken: () => string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = 30_000,
  hooks: ApiHooks = {},
) {
  async function request<T>(method: string, path: string, body?: unknown, customTimeoutMs?: number): Promise<T> {
    if (method !== 'GET' && hooks.isOnline && !hooks.isOnline()) {
      throw new ApiError(0, 'You are offline. This action was not sent; try again when you are back online.');
    }

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const effectiveTimeout = customTimeoutMs ?? timeoutMs;
      const timer = setTimeout(() => controller.abort(), effectiveTimeout);
      let retry = false;

      try {
        const token = getToken();
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
        const failure =
          err instanceof ApiError
            ? err
            : err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)
              ? new ApiError(408, 'Request timed out')
              : err;
        if (failure instanceof ApiError && failure.status === 401) hooks.onUnauthorized?.();
        // Only idempotent reads are retried; timeouts and 4xx failures are not.
        const retryable =
          failure instanceof ApiError ? failure.status >= 500 : failure instanceof Error;
        if (method === 'GET' && attempt < MAX_READ_RETRIES && retryable) {
          retry = true;
        } else {
          if (failure instanceof ApiError) hooks.reportError?.(failure);
          throw failure;
        }
      } finally {
        clearTimeout(timer);
      }

      if (retry) await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt));
    }
  }

  return {
    auth: {
      challenge: (walletAddress: string) =>
        request<Schemas['AuthChallengeResponseDto']>('POST', '/auth/stellar/challenge', {
          walletAddress,
        }),
      verify: (walletAddress: string, signedTransactionXdr: string) =>
        request<Schemas['AuthVerifyResponseDto']>('POST', '/auth/stellar/verify', {
          walletAddress,
          signedTransactionXdr,
        }),
    },
    users: {
      me: () => request<User>('GET', '/users/me'),
      rename: (username: string) => request<User>('PATCH', '/users/me', { username }),
      leaderboard: () => request<LeaderboardEntry[]>('GET', '/users/leaderboard'),
    },
    game: {
      create: (mode: 'solo' | 'room') => request<GameSession>('POST', '/game/sessions', { mode }),
      join: (id: string) => request<GameSession>('POST', `/game/sessions/${id}/join`),
      get: (id: string) => request<GameSession>('GET', `/game/sessions/${id}`),
      lyric: (id: string) => request<PublicLyric>('GET', `/game/sessions/${id}/lyric`),
      guess: (sessionId: string, guess: string) =>
        request<GuessResult>('POST', '/game/guess', { sessionId, guess }),
      history: () => request<GameSession[]>('GET', '/game/history'),
    },
    daily: {
      today: () => request<DailyView>('GET', '/daily'),
      guess: (lyricId: string, guess: string) =>
        request<Schemas['DailyGuessResultDto']>('POST', '/daily/guess', {
          lyricId,
          guess,
        }),
      /** Today's board until the weekly endpoint (#104) lands. */
      leaderboard: () => request<LeaderboardEntry[]>('GET', '/daily/leaderboard'),
    },
    challenges: {
      create: (stakeAmount?: string, opponentUsername?: string) =>
        request<Challenge>('POST', '/challenges', {
          ...(stakeAmount ? { stakeAmount } : {}),
          ...(opponentUsername ? { opponentUsername } : {}),
        }),
      get: (code: string) => request<Challenge>('GET', `/challenges/${encodeURIComponent(code)}`),
      accept: (code: string) =>
        request<Schemas['AcceptChallengeResponseDto']>(
          'POST',
          `/challenges/${encodeURIComponent(code)}/accept`,
        ),
    },
    wagers: {
      list: () => request<Wager[]>('GET', '/wagers'),
      get: (id: string) => request<Wager>('GET', `/wagers/${id}`),
      stakeTransaction: (id: string) =>
        request<Schemas['StakeTransactionResponseDto']>(
          'POST',
          `/wagers/${id}/stake-transaction`,
        ),
      stake: (id: string, signedTransactionXdr?: string) =>
        request<Wager>('POST', `/wagers/${id}/stake`, signedTransactionXdr ? { signedTransactionXdr } : {}),
      cancel: (id: string) => request<Wager>('POST', `/wagers/${id}/cancel`),
    },
    faucet: {
      info: () =>
        request<Schemas['FaucetInfoDto']>(
          'GET',
          '/faucet',
          undefined,
          10_000,
        ),
      claim: () => request<Schemas['FaucetClaimResponseDto']>('POST', '/faucet', undefined, 10_000),
    },
    notifications: {
      /** Query params are ignored by today's server; #108 can page/filter them. */
      list: (params?: { cursor?: string; unreadOnly?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.cursor) query.set('cursor', params.cursor);
        if (params?.unreadOnly) query.set('unread', 'true');
        const suffix = query.toString();
        return request<NotificationPage>('GET', `/notifications${suffix ? `?${suffix}` : ''}`);
      },
      markRead: (id: string) => request<{ id: string; read: boolean }>('POST', `/notifications/${id}/read`),
    },
    push: {
      register: (token: string, platform: 'ios' | 'android') =>
        request<Schemas['PushTokenResponseDto']>('POST', '/push-tokens', { token, platform }),
        request<{ token: string }>('POST', '/push-tokens', { token, platform }),
      unregister: (token: string) =>
        request<void>('DELETE', `/push-tokens/${encodeURIComponent(token)}`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
