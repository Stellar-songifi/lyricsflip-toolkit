'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWalletStore } from '@/store/walletStore';
import { useGameStore } from '@/store/gameStore';
import { gameApi } from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';
import { LyricCard } from '@/components/LyricCard';
import { GuessForm } from '@/components/GuessForm';

export default function SoloPage() {
  const user = useWalletStore((s) => s.user);
  const {
    session,
    currentLyric,
    lastOutcome,
    setSession,
    setLyric,
    recordGuess,
    clearOutcome,
    reset,
  } = useGameStore();
  const [totalScore, setTotalScore] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!user || session) return;
    setStarting(true);
    gameApi
      .createSession(user.id, 'solo')
      .then(async (newSession) => {
        setSession(newSession);
        const lyric = await gameApi.getCurrentLyric(newSession.id);
        setLyric(lyric);
      })
      .finally(() => setStarting(false));

    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleGuess(guess: string) {
    if (!user || !session) return;
    const result = await gameApi.submitGuess(session.id, user.id, guess);
    recordGuess(result.outcome, result.streak);
    setTotalScore((s) => s + result.pointsAwarded);

    setTimeout(() => {
      if (result.sessionStatus === 'finished' || !result.nextLyric) {
        setLyric(null);
      } else {
        setLyric(result.nextLyric);
        clearOutcome();
      }
    }, 1500);
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Solo play</h1>
        <p className="text-text-muted">Connect a wallet to start earning XP.</p>
        <WalletConnect />
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-8 px-6 py-12">
      <div className="flex w-full items-center justify-between">
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
        <span className="font-mono text-sm text-text-muted">Score: {totalScore}</span>
      </div>

      {starting && <p className="text-text-muted">Starting a round…</p>}

      {currentLyric && (
        <LyricCard lyric={currentLyric} outcome={lastOutcome} onExpire={() => handleGuess('')} />
      )}

      {currentLyric && !lastOutcome && <GuessForm onSubmit={handleGuess} />}

      {!currentLyric && !starting && (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-display text-xl">Round over — final score: {totalScore}</p>
          <button
            onClick={() => {
              reset();
              setTotalScore(0);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium hover:bg-brand-400"
          >
            Play again
          </button>
        </div>
      )}
    </main>
  );
}
