import { create } from 'zustand';
import type { GameSession, PublicLyric } from '@/lib/api';

export type GuessOutcome = 'correct' | 'partial' | 'miss';

interface GameState {
  session: GameSession | null;
  currentLyric: PublicLyric | null;
  streak: number;
  lastOutcome: GuessOutcome | null;
  setSession: (session: GameSession) => void;
  setLyric: (lyric: PublicLyric | null) => void;
  recordGuess: (outcome: GuessOutcome, streak: number) => void;
  clearOutcome: () => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  session: null,
  currentLyric: null,
  streak: 0,
  lastOutcome: null,
  setSession: (session) => set({ session }),
  setLyric: (currentLyric) => set({ currentLyric }),
  recordGuess: (outcome, streak) => set({ lastOutcome: outcome, streak }),
  clearOutcome: () => set({ lastOutcome: null }),
  reset: () => set({ session: null, currentLyric: null, streak: 0, lastOutcome: null }),
}));
