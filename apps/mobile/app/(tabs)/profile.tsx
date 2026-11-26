import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Body, Button, ErrorText, Screen, Title, styles as ui } from '../../src/components/ui';
import { useSession } from '../../src/lib/session';
import { getTestTokens } from '../../src/lib/test-tokens';
import { colors, spacing } from '../../src/lib/theme';

export default function Profile() {
  const { user, wallet, api, refreshUser, signOut } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState(user?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);

  if (!user) return null;
  const next = user.nextLevel;
  const progress = next ? Math.min(1, user.xp / next.minXp) : 1;

  async function claimTokens() {
    if (!wallet) return;
    setClaiming(true);
    setError(null);
    try {
      setTokens(`Received ${await getTestTokens(api, wallet)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  async function save() {
    setError(null);
    try {
      await api.users.rename(username.trim());
      await refreshUser();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Screen>
      <Title>{user.username}</Title>
      <Body>
        {user.level} · {user.xp} XP
      </Body>
      <View style={styles.track} accessibilityLabel={`XP progress ${Math.round(progress * 100)} percent`}>
        <View style={[styles.fill, { flex: progress }]} />
        <View style={{ flex: 1 - progress }} />
      </View>
      <Body muted>{next ? `${next.minXp - user.xp} XP to ${next.level}` : 'Top level reached'}</Body>
      <Body muted>
        {user.correctGuesses} correct · {user.gamesPlayed} games
      </Body>

      <Button label="Match history" variant="secondary" onPress={() => router.push('/match-history')} />
      <TextInput
        style={ui.input}
        accessibilityLabel="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <Button label="Change username" variant="secondary" onPress={save} />
      <ErrorText>{error}</ErrorText>

      {wallet ? (
        <Button
          label={`Copy wallet ${wallet.publicKey().slice(0, 6)}…`}
          variant="secondary"
          onPress={() => void Clipboard.setStringAsync(wallet.publicKey())}
        />
      ) : null}
      <Button label="Get free test tokens" variant="secondary" onPress={claimTokens} busy={claiming} />
      {tokens ? <Body muted>{tokens}</Body> : null}
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', height: 10, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden', marginVertical: spacing.xs },
  fill: { backgroundColor: colors.accent300 },
});
