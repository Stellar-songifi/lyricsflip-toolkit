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
        request<Schemas['DailyGuessResultDto']>('POST', '/daily/guess', {
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
      list: () => request<Notification[]>('GET', '/notifications'),
    },
    push: {
      register: (token: string, platform: 'ios' | 'android') =>
        request<Schemas['PushTokenResponseDto']>('POST', '/push-tokens', { token, platform }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
