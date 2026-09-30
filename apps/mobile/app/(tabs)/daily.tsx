import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Body, ErrorText, Screen, Title } from '../../src/components/ui';
import { GuessForm } from '../../src/components/GuessForm';
import { LyricCard } from '../../src/components/LyricCard';
import type { DailyView } from '../../src/lib/api';
import { hapticForOutcome } from '../../src/lib/haptics';
import { useSession } from '../../src/lib/session';
import { spacing } from '../../src/lib/theme';

export default function Daily() {
  const { api, refreshUser } = useSession();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDaily(await api.daily.today());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const next = daily?.lyrics.find((l) => !l.attempt);

  async function onGuess(guess: string) {
    if (!next) return;
    try {
      const result = await api.daily.guess(next.id, guess);
      hapticForOutcome(result.outcome);
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md }}>
        <Title>Daily challenge</Title>
        <Body muted>
          {daily ? `${daily.date} · ${daily.totalPoints} points` : 'Loading…'} · Five lyrics, one guess each.
        </Body>
        {next ? (
          <>
            <LyricCard lyric={next} />
            <GuessForm onGuess={onGuess} />
          </>
        ) : daily?.complete ? (
          <Body>Done for today. Come back tomorrow.</Body>
        ) : null}
        <ErrorText>{error}</ErrorText>
        {daily?.lyrics
          .filter((l) => l.attempt)
          .map((l) => (
            <View key={l.id}>
              <LyricCard lyric={l} outcome={l.attempt!.outcome} />
              <Body muted>
                {l.attempt!.title} — {l.attempt!.artist} · +{l.attempt!.points}
              </Body>
            </View>
          ))}
      </ScrollView>
    </Screen>
  );
}
