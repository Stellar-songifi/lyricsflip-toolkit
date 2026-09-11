const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
};

export interface PublicLyric {
  id: string;
  snippet: string;
  genre: string;
  decade: number;
}

export type GameMode = 'solo' | 'room' | 'head_to_head';
export type GameSessionStatus = 'waiting' | 'active' | 'finished';

export interface GameSession {
  id: string;
  mode: GameMode;
  status: GameSessionStatus;
  playerIds: string[];
  currentLyricId: string | null;
  currentRound: number;
  scores: Record<string, number>;
}

export interface GuessResult {
  outcome: 'correct' | 'partial' | 'miss';
  pointsAwarded: number;
  streak: number;
  nextLyric: PublicLyric | null;
  sessionStatus: GameSessionStatus;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  xp: number;
  score: number;
  level: string;
}

export const gameApi = {
  createSession: (hostUserId: string, mode: GameMode) =>
    api.post<GameSession>('/game/sessions', { hostUserId, mode }),
  joinSession: (sessionId: string, userId: string) =>
    api.post<GameSession>(`/game/sessions/${sessionId}/join`, { userId }),
  getSession: (sessionId: string) => api.get<GameSession>(`/game/sessions/${sessionId}`),
  getCurrentLyric: (sessionId: string) =>
    api.get<PublicLyric>(`/game/sessions/${sessionId}/lyric`),
  submitGuess: (sessionId: string, userId: string, guess: string) =>
    api.post<GuessResult>('/game/guess', { sessionId, userId, guess }),
};

export const usersApi = {
  getLeaderboard: (limit = 20) => api.get<LeaderboardEntry[]>(`/users/leaderboard?limit=${limit}`),
};

export type WagerStatus =
  | 'pending'
  | 'awaiting_stakes'
  | 'staked'
  | 'settling'
  | 'won'
  | 'refunded'
  | 'failed';

export interface Wager {
  id: string;
  gameSessionId: string;
  playerAId: string;
  playerBId: string;
  stakeAmount: string;
  status: WagerStatus;
  playerAStaked: boolean;
  playerBStaked: boolean;
  winnerId: string | null;
  settlementTxHash: string | null;
  failureReason: string | null;
}

export const wagerApi = {
  getById: (wagerId: string) => api.get<Wager>(`/wagers/${wagerId}`),
  stake: (wagerId: string, playerId: string) =>
    api.post<Wager>(`/wagers/${wagerId}/stake`, { playerId }),
  settle: (wagerId: string, winnerId: string) =>
    api.post<Wager>(`/wagers/${wagerId}/settle`, { winnerId }),
  refund: (wagerId: string) => api.post<Wager>(`/wagers/${wagerId}/refund`),
};

export type ChallengeStatus = 'pending' | 'accepted' | 'expired';

export interface ChallengeSummary {
  code: string;
  status: ChallengeStatus;
  gameSessionId: string | null;
  wagerId: string | null;
  expiresAt: string;
}

export interface AcceptChallengeResult {
  gameSessionId: string;
  wagerId: string | null;
}

export const challengesApi = {
  create: (hostUserId: string, stakeAmount?: string) =>
    api.post<ChallengeSummary>('/challenges', { hostUserId, stakeAmount }),
  getByCode: (code: string) => api.get<ChallengeSummary>(`/challenges/${code}`),
  accept: (code: string, userId: string) =>
    api.post<AcceptChallengeResult>(`/challenges/${code}/accept`, { userId }),
};

/** The wager token uses 7 decimal places (stroops), same as the native XLM asset. */
const STROOPS_PER_XLM = 10_000_000;

export function xlmToStroops(xlm: number): string {
  return Math.round(xlm * STROOPS_PER_XLM).toString();
}

export function stroopsToXlm(stroops: string): number {
  return Number(stroops) / STROOPS_PER_XLM;
}
