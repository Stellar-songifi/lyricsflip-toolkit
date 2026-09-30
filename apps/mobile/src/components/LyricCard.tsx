import { StyleSheet, Text, View } from 'react-native';
import type { GuessOutcome, PublicLyric } from '../lib/api';
import { colors, spacing } from '../lib/theme';

const OUTCOME_COLOR: Record<GuessOutcome, string> = {
  correct: colors.success,
  close: colors.accent300,
  miss: colors.error,
};

export function LyricCard({ lyric, outcome }: { lyric: PublicLyric; outcome?: GuessOutcome | null }) {
  return (
    <View
      style={[styles.card, outcome && { borderColor: OUTCOME_COLOR[outcome] }]}
      accessibilityLabel={`Lyric: ${lyric.snippet}`}
    >
      <Text style={styles.snippet}>“{lyric.snippet}”</Text>
      <Text style={styles.meta}>
        {lyric.genre} · {lyric.decade}s
      </Text>
      {outcome ? <Text style={[styles.outcome, { color: OUTCOME_COLOR[outcome] }]}>{outcome}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  snippet: { color: colors.text, fontSize: 22, fontWeight: '700', lineHeight: 30 },
  meta: { color: colors.muted, fontSize: 14 },
  outcome: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase' },
});
