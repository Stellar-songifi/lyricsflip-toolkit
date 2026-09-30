import { useEffect } from 'react';
import { Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Body, Button, ErrorText, Screen, Title } from '../../src/components/ui';
import { GuessForm } from '../../src/components/GuessForm';
import { LyricCard } from '../../src/components/LyricCard';
import { usePlaySession } from '../../src/hooks/usePlaySession';
import { useSession } from '../../src/lib/session';

/** Solo and room play. */
export default function Play() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, refreshUser } = useSession();
  const { session, lyric, outcome, streak, error, guess } = usePlaySession(id);

  useEffect(() => {
    if (session?.status === 'finished') {
      void refreshUser();
      router.replace(`/results/${session.id}`);
    }
  }, [session?.status, session?.id, router, refreshUser]);

  const myScore = user && session ? (session.scores[user.id] ?? 0) : 0;

  return (
    <Screen>
      <Title>
        Round {session?.currentRound ?? '–'} / 10
      </Title>
      <Body muted>
        {myScore} points{streak > 1 ? ` · streak ${streak}` : ''}
        {session?.mode === 'room' ? ` · ${session.playerIds.length} players` : ''}
      </Body>
      {lyric ? <LyricCard lyric={lyric} outcome={outcome} /> : <Body muted>Loading…</Body>}
      <GuessForm onGuess={guess} disabled={session?.status !== 'active'} />
      {session?.mode === 'room' ? (
        <Button label="Share room id" variant="secondary" onPress={() => void Share.share({ message: session.id })} />
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
