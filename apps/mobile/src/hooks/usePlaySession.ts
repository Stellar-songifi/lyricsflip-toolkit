import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameSession, GuessOutcome, PublicLyric } from '../lib/api';
import { hapticForOutcome } from '../lib/haptics';
import { useSession } from '../lib/session';

/**
 * Drives one game session over REST: loads the current lyric, submits
 * guesses (with haptics), and polls the session so shared rooms and
 * head-to-head scores stay current. The server keeps score; this only shows it.
 */
export function usePlaySession(sessionId: string | undefined, pollMs = 2000) {
  const { api } = useSession();
  const [session, setSession] = useState<GameSession | null>(null);
  const [lyric, setLyric] = useState<PublicLyric | null>(null);
  const [outcome, setOutcome] = useState<GuessOutcome | null>(null);
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastRound = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await api.game.get(sessionId);
      setSession(next);
      if (next.status === 'active' && next.currentRound !== lastRound.current) {
        lastRound.current = next.currentRound;
        setLyric(await api.game.lyric(sessionId));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, sessionId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const guess = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setError(null);
      try {
        const result = await api.game.guess(sessionId, text);
        setOutcome(result.outcome);
        setStreak(result.streak);
        hapticForOutcome(result.outcome);
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

  return { session, lyric, outcome, streak, error, guess, refresh };
}
