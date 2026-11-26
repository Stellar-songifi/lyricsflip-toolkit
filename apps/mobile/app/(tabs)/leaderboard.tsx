import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, ErrorText, Screen, Title } from '../../src/components/ui';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import type { LeaderboardEntry } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { colors, spacing } from '../../src/lib/theme';

export default function Leaderboard() {
  const { api, user } = useSession();
  const { online } = useNetworkStatus();
  const wasOnline = useRef(online);
  const [period, setPeriod] = useState<'all' | 'today'>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // GET /daily/leaderboard is today's board; swap in the weekly endpoint
      // from #104 when it ships.
      setEntries(period === 'all' ? await api.users.leaderboard() : await api.daily.leaderboard());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (online && !wasOnline.current) void load();
    wasOnline.current = online;
  }, [online, load]);

  return (
    <Screen>
      <Title>Leaderboard</Title>
      <Button
        label={period === 'all' ? 'Show today' : 'Show all time'}
        variant="secondary"
        onPress={() => setPeriod((value) => (value === 'all' ? 'today' : 'all'))}
      />
      <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
        {entries.length === 0 ? <Body muted>No ranked players yet.</Body> : null}
        {entries.map((entry, index) => {
          const mine = Boolean(user && (entry.id === user.id || entry.userId === user.id));
          const score = period === 'all' ? (entry.xp ?? 0) : (entry.points ?? 0);
          return (
            <View
              key={entry.id ?? entry.userId ?? `${entry.username}-${index}`}
              style={[styles.row, mine && styles.mine]}
              accessibilityLabel={`Rank ${index + 1}, ${entry.username}, ${score} ${period === 'all' ? 'XP' : 'points'}${mine ? ', you' : ''}`}
            >
              <Text style={styles.rank}>#{index + 1}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{entry.username}{mine ? ' (you)' : ''}</Text>
                <Body muted>{entry.level ?? (period === 'all' ? 'XP' : 'Points')}</Body>
              </View>
              <Text style={styles.score}>{score}</Text>
            </View>
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
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  mine: { borderWidth: 2, borderColor: colors.accent300 },
  rank: { color: colors.muted, fontSize: 16, fontWeight: '700', width: 40 },
  rowBody: { flex: 1, gap: spacing.xs },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  score: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
