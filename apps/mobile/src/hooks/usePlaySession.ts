import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameSession, GuessOutcome, PublicLyric } from '../lib/api';
import { announceGuessResult, announceScoreUpdate } from '../lib/a11y';
import { hapticForOutcome } from '../lib/haptics';
import { isOnline } from '../lib/network';
import { useSession } from '../lib/session';
import { useNetworkStatus } from './useNetworkStatus';

function scoresChanged(a: Record<string, number>, b: Record<string, number>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((id) => (a[id] ?? 0) !== (b[id] ?? 0));
}

/**
 * Drives one game session over REST: loads the current lyric, submits
 * guesses (with haptics), and polls the session so shared rooms and
 * head-to-head scores stay current. The server keeps score; this only shows it.
 * While offline it keeps the last-known state and polls again on reconnect.
 */
export function usePlaySession(sessionId: string | undefined, pollMs = 2000) {
  const { api, user } = useSession();
  const { online } = useNetworkStatus();
  const [session, setSession] = useState<GameSession | null>(null);
  const [lyric, setLyric] = useState<PublicLyric | null>(null);
  const [outcome, setOutcome] = useState<GuessOutcome | null>(null);
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastRound = useRef<number | null>(null);
  const lastScores = useRef<Record<string, number> | null>(null);
  const wasOnline = useRef(online);

  const refresh = useCallback(async () => {
    if (!sessionId || !isOnline()) return;
    try {
      const next = await api.game.get(sessionId);
      if (lastScores.current && scoresChanged(lastScores.current, next.scores)) {
        announceScoreUpdate(next.scores, user?.id);
      }
      lastScores.current = next.scores;
      setSession(next);
      if (next.status === 'active' && next.currentRound !== lastRound.current) {
        lastRound.current = next.currentRound;
        setLyric(await api.game.lyric(sessionId));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, sessionId, user?.id]);

  useEffect(() => {
    if (!online) return;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, online]);

  useEffect(() => {
    if (online && !wasOnline.current) void refresh();
    wasOnline.current = online;
  }, [online, refresh]);

  const guess = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setError(null);
      try {
        const result = await api.game.guess(sessionId, text);
        setOutcome(result.outcome);
        setStreak(result.streak);
        hapticForOutcome(result.outcome);
        announceGuessResult(result.outcome, result.pointsAwarded, result.streak);
        if (result.nextLyric) {
          lastRound.current = (lastRound.current ?? 0) + 1;
          setLyric(result.nextLyric);
        }
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [api, sessionId, refresh],
  );

  return { session, lyric, outcome, streak, error, guess, refresh, online };
}
