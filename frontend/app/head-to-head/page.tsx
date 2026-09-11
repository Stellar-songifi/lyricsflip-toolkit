'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useWalletStore } from '@/store/walletStore';
import {
  challengesApi,
  gameApi,
  wagerApi,
  xlmToStroops,
  stroopsToXlm,
  type PublicLyric,
  type Wager,
} from '@/lib/api';
import { getGameSocket } from '@/lib/socket';
import { WalletConnect } from '@/components/WalletConnect';
import { LyricCard } from '@/components/LyricCard';
import { GuessForm } from '@/components/GuessForm';
import type { GuessOutcome } from '@/store/gameStore';

type Phase = 'idle' | 'waiting-for-opponent' | 'staking' | 'playing' | 'finished';

export default function HeadToHeadPage() {
  const user = useWalletStore((s) => s.user);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stakeXlm, setStakeXlm] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wagerId, setWagerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lyric, setLyric] = useState<PublicLyric | null>(null);
  const [outcome, setOutcome] = useState<GuessOutcome | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [settlement, setSettlement] = useState<Wager | null>(null);

  // Host side: poll the challenge until the opponent accepts it.
  const { data: challenge } = useQuery({
    queryKey: ['challenge', code],
    queryFn: () => challengesApi.getByCode(code as string),
    enabled: phase === 'waiting-for-opponent' && !!code,
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (challenge?.status === 'accepted' && challenge.gameSessionId) {
      setSessionId(challenge.gameSessionId);
      setWagerId(challenge.wagerId);
      setPhase(challenge.wagerId ? 'staking' : 'playing');
    }
  }, [challenge]);

  // Staking: poll the wager until both players have staked.
  const { data: wager } = useQuery({
    queryKey: ['wager', wagerId],
    queryFn: () => wagerApi.getById(wagerId as string),
    enabled: phase === 'staking' && !!wagerId,
    refetchInterval: 1500,
  });

  useEffect(() => {
    if (wager?.status === 'staked') {
      setPhase('playing');
    }
  }, [wager]);

  // Socket wiring, once the match is live.
  useEffect(() => {
    if (phase !== 'playing' || !sessionId) return;
    const socket = getGameSocket();

    socket.on('lyric', (payload: PublicLyric) => {
      setLyric(payload);
      setOutcome(null);
    });
    socket.on('guessResult', (payload: { outcome: GuessOutcome; sessionStatus: string }) => {
      setOutcome(payload.outcome);
      if (payload.sessionStatus === 'finished') {
        setTimeout(() => setPhase('finished'), 1200);
      }
    });
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
  }, [phase, sessionId]);

  // Settlement, once the match is over.
  useEffect(() => {
    if (phase !== 'finished' || !user) return;

    async function settleMatch() {
      if (!wagerId) return;
      const session = await gameApi.getSession(sessionId as string);
      const [playerA, playerB] = session.playerIds;
      const scoreA = scores[playerA] ?? 0;
      const scoreB = scores[playerB] ?? 0;

      try {
        if (scoreA === scoreB) {
          setSettlement(await wagerApi.refund(wagerId));
        } else {
          const winnerId = scoreA > scoreB ? playerA : playerB;
          setSettlement(await wagerApi.settle(wagerId, winnerId));
        }
      } catch {
        // The other player's client may have already settled this wager —
        // fetch the resulting state instead of treating it as a failure.
        setSettlement(await wagerApi.getById(wagerId));
      }
    }

    void settleMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function createChallenge() {
    if (!user) return;
    setError(null);
    try {
      const stakeAmount = stakeXlm.trim() ? xlmToStroops(Number(stakeXlm)) : undefined;
      const challenge = await challengesApi.create(user.id, stakeAmount);
      setCode(challenge.code);
      setPhase('waiting-for-opponent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a challenge');
    }
  }

  async function acceptChallenge() {
    if (!user || !joinCode.trim()) return;
    setError(null);
    try {
      const result = await challengesApi.accept(joinCode.trim().toUpperCase(), user.id);
      setSessionId(result.gameSessionId);
      setWagerId(result.wagerId);
      setPhase(result.wagerId ? 'staking' : 'playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join that challenge');
    }
  }

  async function stakeMine() {
    if (!user || !wagerId) return;
    try {
      await wagerApi.stake(wagerId, user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Staking failed');
    }
  }

  function submitGuess(guess: string) {
    if (!user || !sessionId) return;
    getGameSocket().emit('submitGuess', { sessionId, userId: user.id, guess });
  }

  function playAgain() {
    setPhase('idle');
    setCode(null);
    setSessionId(null);
    setWagerId(null);
    setLyric(null);
    setOutcome(null);
    setScores({});
    setSettlement(null);
    setError(null);
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Head-to-head</h1>
        <p className="text-text-muted">Connect a wallet to challenge another player.</p>
        <WalletConnect />
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </main>
    );
  }

  if (phase === 'idle') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6">
        <h1 className="font-display text-2xl font-bold">Head-to-head</h1>

        <div className="flex w-full flex-col gap-2 rounded-2xl bg-surface p-4">
          <label className="text-sm text-text-muted">Stake (XLM, optional)</label>
          <input
            value={stakeXlm}
            onChange={(e) => setStakeXlm(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 5"
            className="rounded-lg border border-canvas bg-canvas px-4 py-2 text-text-primary placeholder:text-text-muted focus:border-brand-400 focus:outline-none"
          />
          <button
            onClick={createChallenge}
            className="mt-2 rounded-lg bg-brand-600 px-4 py-3 font-medium hover:bg-brand-400"
          >
            Create a challenge
          </button>
        </div>

        <div className="flex w-full gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Enter a code"
            className="flex-1 rounded-lg border border-surface bg-surface px-4 py-2 text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={acceptChallenge}
            className="rounded-lg border border-brand-400 px-4 py-2 hover:bg-brand-600/20"
          >
            Join
          </button>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </main>
    );
  }

  if (phase === 'waiting-for-opponent') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Waiting for an opponent</h1>
        <p className="text-text-muted">Share this code:</p>
        <p className="font-mono text-4xl tracking-widest text-accent-300">{code}</p>
        {stakeXlm && <p className="text-sm text-text-muted">Stake: {stakeXlm} XLM each</p>}
      </main>
    );
  }

  if (phase === 'staking') {
    const iAmPlayerA = wager?.playerAId === user.id;
    const iHaveStaked = iAmPlayerA ? wager?.playerAStaked : wager?.playerBStaked;
    const stakeXlmDisplay = wager ? stroopsToXlm(wager.stakeAmount) : 0;

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Stake to start</h1>
        <p className="text-text-muted">Each player stakes {stakeXlmDisplay} XLM.</p>
        {iHaveStaked ? (
          <p className="text-text-muted">Waiting for your opponent to stake…</p>
        ) : (
          <button
            onClick={stakeMine}
            className="rounded-lg bg-brand-600 px-6 py-3 font-medium hover:bg-brand-400"
          >
            Stake {stakeXlmDisplay} XLM
          </button>
        )}
        {error && <p className="text-sm text-error">{error}</p>}
      </main>
    );
  }

  if (phase === 'finished') {
    const iWon = settlement?.status === 'won' && settlement.winnerId === user.id;
    const wasRefunded = settlement?.status === 'refunded';

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Match over</h1>
        <ul className="w-full text-sm text-text-muted">
          {Object.entries(scores).map(([userId, score]) => (
            <li key={userId} className="flex justify-between">
              <span className="font-mono">{userId === user.id ? 'You' : userId.slice(0, 8)}</span>
              <span>{score}</span>
            </li>
          ))}
        </ul>
        {settlement && (
          <p className={iWon ? 'text-success' : wasRefunded ? 'text-text-muted' : 'text-error'}>
            {wasRefunded && 'It was a tie — stakes refunded.'}
            {!wasRefunded && iWon && `You won the pot — ${stroopsToXlm(settlement.stakeAmount) * 2} XLM.`}
            {!wasRefunded && !iWon && 'Your opponent took the pot this time.'}
          </p>
        )}
        <button
          onClick={playAgain}
          className="rounded-lg bg-brand-600 px-4 py-2 font-medium hover:bg-brand-400"
        >
          Play again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-8 px-6 py-12">
      {lyric && <LyricCard lyric={lyric} outcome={outcome} onExpire={() => submitGuess('')} />}
      {lyric && !outcome && <GuessForm onSubmit={submitGuess} />}

      <ul className="w-full text-sm text-text-muted">
        {Object.entries(scores).map(([userId, score]) => (
          <li key={userId} className="flex justify-between">
            <span className="font-mono">{userId === user.id ? 'You' : userId.slice(0, 8)}</span>
            <span>{score}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
