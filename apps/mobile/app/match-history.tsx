import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, ErrorText, Screen, Title } from '../src/components/ui';
import { ApiError, type GameSession } from '../src/lib/api';
import { useSession } from '../src/lib/session';
import { colors, spacing } from '../src/lib/theme';

const MODE_LABEL: Record<GameSession['mode'], string> = {
  solo: 'Solo',
  room: 'Room',
  head_to_head: 'Head-to-head',
};

export default function MatchHistory() {
  const { api, user } = useSession();
  const router = useRouter();
  const [matches, setMatches] = useState<GameSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMatches(await api.game.history());
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'This server does not expose match history yet.'
          : (err as Error).message,
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function result(match: GameSession): string {
    if (match.status === 'cancelled') return 'Cancelled';
    if (match.mode !== 'head_to_head' || !user) return match.status;
    const mine = match.scores[user.id] ?? 0;
    const theirs = match.playerIds
      .filter((id) => id !== user.id)
      .map((id) => match.scores[id] ?? 0)[0] ?? 0;
    return mine > theirs ? 'Won' : mine < theirs ? 'Lost' : 'Draw';
  }

  return (
    <Screen>
      <Title>Match history</Title>
      <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
        {matches.length === 0 ? <Body muted>No finished matches yet.</Body> : null}
        {matches.map((match) => {
          const score = user ? (match.scores[user.id] ?? 0) : 0;
          return (
            <Pressable
              key={match.id}
              onPress={() => router.push(`/results/${match.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${MODE_LABEL[match.mode]}, ${result(match)}, ${score} points. View results.`}
              style={styles.row}
            >
              <View style={styles.rowBody}>
                <Text style={styles.title}>{MODE_LABEL[match.mode]}</Text>
                <Body muted>{match.createdAt ? new Date(match.createdAt).toLocaleDateString() : ''}</Body>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.score}>{score} pts</Text>
                <Body muted>{result(match)}</Body>
              </View>
            </Pressable>
          );
        })}
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  rowBody: { gap: spacing.xs },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  score: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
