import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fromStroops, multiplyStroops } from '@lyricsflip-toolkit/sdk';
import { Body, Button, Screen, Title } from '../../src/components/ui';
import type { GameSession, Wager } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';

const SETTLED = new Set(['won', 'refunded', 'failed', 'cancelled']);

export default function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api, user, refreshUser } = useSession();
  const [session, setSession] = useState<GameSession | null>(null);
  const [wager, setWager] = useState<Wager | null>(null);

  useEffect(() => {
    void refreshUser();
    let stop = false;
    async function poll() {
      const [s, wagers] = await Promise.all([api.game.get(id), api.wagers.list().catch(() => [] as Wager[])]);
      if (stop) return;
      setSession(s);
      const w = wagers.find((x) => x.matchId === id) ?? null;
      setWager(w);
      // Settlement is asynchronous on the server; keep checking until it lands.
      if (w && !SETTLED.has(w.status)) setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      stop = true;
    };
  }, [api, id, refreshUser]);

  if (!session || !user) return <Screen><Body muted>Loading…</Body></Screen>;
  const mine = session.scores[user.id] ?? 0;
  const theirs = session.playerIds.filter((p) => p !== user.id).map((p) => session.scores[p] ?? 0)[0];

  return (
    <Screen>
      <Title>{session.mode === 'solo' ? `${mine} points` : mine > (theirs ?? 0) ? 'You won' : mine === theirs ? 'Draw' : 'You lost'}</Title>
      {theirs !== undefined ? <Body>{mine} – {theirs}</Body> : null}
      {wager ? (
        <Body muted>
          {wager.status === 'won'
            ? wager.winnerId === user.id
              ? `You won the pot: ${fromStroops(multiplyStroops(wager.stakeAmount, 2))} test tokens.`
              : 'Your opponent took the pot.'
            : wager.status === 'refunded'
              ? 'Stakes were returned.'
              : wager.status === 'failed'
                ? 'Settlement needs an operator; your stake is safe in escrow.'
                : 'Settling the stakes…'}
        </Body>
      ) : null}
      <Button label="Home" onPress={() => router.replace('/')} />
    </Screen>
  );
}
