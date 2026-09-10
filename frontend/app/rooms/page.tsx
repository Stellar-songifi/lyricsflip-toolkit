'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWalletStore } from '@/store/walletStore';
import { gameApi, type PublicLyric } from '@/lib/api';
import { getGameSocket } from '@/lib/socket';
import { WalletConnect } from '@/components/WalletConnect';
import { LyricCard } from '@/components/LyricCard';
import { GuessForm } from '@/components/GuessForm';
import type { GuessOutcome } from '@/store/gameStore';

export default function RoomsPage() {
  const user = useWalletStore((s) => s.user);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [lyric, setLyric] = useState<PublicLyric | null>(null);
  const [outcome, setOutcome] = useState<GuessOutcome | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!sessionId) return;
    const socket = getGameSocket();

    socket.on('lyric', (payload: PublicLyric) => {
      setLyric(payload);
      setOutcome(null);
    });
    socket.on('guessResult', (payload: { outcome: GuessOutcome }) => setOutcome(payload.outcome));
    socket.on(
      'scoreUpdate',
      (payload: { userId: string; pointsAwarded: number }) =>
        void setScores((s) => ({ ...s, [payload.userId]: (s[payload.userId] ?? 0) + payload.pointsAwarded })),
    );

    socket.emit('requestLyric', { sessionId });

    return () => {
      socket.off('lyric');
      socket.off('guessResult');
      socket.off('scoreUpdate');
    };
  }, [sessionId]);

  async function createRoom() {
    if (!user) return;
    const session = await gameApi.createSession(user.id, 'room');
    setSessionId(session.id);
  }

  async function joinRoom() {
    if (!user || !joinCode.trim()) return;
    const session = await gameApi.joinSession(joinCode.trim(), user.id);
    setSessionId(session.id);
  }

  function submitGuess(guess: string) {
    if (!user || !sessionId) return;
    getGameSocket().emit('submitGuess', { sessionId, userId: user.id, guess });
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Rooms</h1>
        <p className="text-text-muted">Connect a wallet to create or join a room.</p>
        <WalletConnect />
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6">
        <h1 className="font-display text-2xl font-bold">Rooms</h1>
        <button
          onClick={createRoom}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium hover:bg-brand-400"
        >
          Create a room
        </button>
        <div className="flex w-full gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Room session ID"
            className="flex-1 rounded-lg border border-surface bg-surface px-4 py-2 text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={joinRoom}
            className="rounded-lg border border-brand-400 px-4 py-2 hover:bg-brand-600/20"
          >
            Join
          </button>
        </div>
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-8 px-6 py-12">
      <p className="text-sm text-text-muted">
        Room ID: <span className="font-mono">{sessionId}</span> — share it to invite others
      </p>

      {lyric && <LyricCard lyric={lyric} outcome={outcome} onExpire={() => submitGuess('')} />}
      {lyric && !outcome && <GuessForm onSubmit={submitGuess} />}

      <ul className="w-full text-sm text-text-muted">
        {Object.entries(scores).map(([userId, score]) => (
          <li key={userId} className="flex justify-between">
            <span className="font-mono">{userId.slice(0, 8)}</span>
            <span>{score}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
