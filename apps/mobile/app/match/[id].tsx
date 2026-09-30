import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fromStroops } from '@lyricsflip-toolkit/sdk';
import { Body, Button, ErrorText, Screen, Title } from '../../src/components/ui';
import { GuessForm } from '../../src/components/GuessForm';
import { LyricCard } from '../../src/components/LyricCard';
import { usePlaySession } from '../../src/hooks/usePlaySession';
import type { Wager } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { signEnvelope } from '../../src/lib/wallet';

/**
 * A head-to-head match. If it's staked, each player stakes first (signing
 * with the device wallet); play starts once the server confirms both stakes.
 * The server decides the winner and settles; this screen only shows it.
 */
export default function Match() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api, user, wallet } = useSession();
  const { session, lyric, outcome, error, guess } = usePlaySession(id, 1500);
  const [wager, setWager] = useState<Wager | null>(null);
  const [staking, setStaking] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);

  const loadWager = useCallback(async () => {
    const res = await api.wagers.list().catch(() => [] as Wager[]);
    setWager(res.find((w) => w.matchId === id) ?? null);
  }, [api, id]);

  useEffect(() => {
    void loadWager();
    if (session?.status !== 'waiting') return;
    const timer = setInterval(() => void loadWager(), 1500);
    return () => clearInterval(timer);
  }, [loadWager, session?.status]);

  useEffect(() => {
    if (session?.status === 'finished') router.replace(`/results/${id}`);
  }, [session?.status, id, router]);

  const iAmA = wager && user ? wager.playerAId === user.id : false;
  const iStaked = wager ? Boolean(iAmA ? wager.playerAStakedAt : wager.playerBStakedAt) : false;

  async function stake() {
    if (!wager || !wallet) return;
    setStaking(true);
    setStakeError(null);
    try {
      const { transaction } = await api.wagers.stakeTransaction(wager.id);
      const signed = transaction
        ? signEnvelope(wallet, transaction.transactionXdr, transaction.networkPassphrase)
        : undefined;
      setWager(await api.wagers.stake(wager.id, signed));
    } catch (err) {
      setStakeError((err as Error).message);
    } finally {
      setStaking(false);
    }
  }

  if (session?.status === 'waiting' || session?.status === 'cancelled') {
    return (
      <Screen>
        <Title>Stakes</Title>
        {wager ? (
          <Body>
            {fromStroops(wager.stakeAmount)} test tokens each · {wager.status.replace('_', ' ')}
          </Body>
        ) : null}
        {session.status === 'cancelled' ? (
          <Body muted>The match was cancelled. Any stake was returned.</Body>
        ) : iStaked ? (
          <Body muted>You're in. Waiting for your opponent's stake…</Body>
        ) : (
          <Button label="Stake and ready up" onPress={stake} busy={staking} disabled={!wager} />
        )}
        <ErrorText>{stakeError}</ErrorText>
      </Screen>
    );
  }

  const [a, b] = session?.playerIds ?? [];
  return (
    <Screen>
      <Title>Round {session?.currentRound ?? '–'} / 10</Title>
      <Body muted>
        You {session && user ? (session.scores[user.id] ?? 0) : 0} · Opponent{' '}
        {session && user ? (session.scores[user.id === a ? b : a] ?? 0) : 0}
      </Body>
      {lyric ? <LyricCard lyric={lyric} outcome={outcome} /> : <Body muted>Loading…</Body>}
      <GuessForm onGuess={guess} disabled={session?.status !== 'active'} />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
