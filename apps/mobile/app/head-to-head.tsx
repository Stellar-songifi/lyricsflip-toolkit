import { useEffect, useState } from 'react';
import { Share, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { toStroops } from '@lyricsflip-toolkit/sdk';
import { Body, Button, ErrorText, Screen, Title, styles } from '../src/components/ui';
import type { Challenge } from '../src/lib/api';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

export default function HeadToHead() {
  const { api } = useSession();
  const router = useRouter();
  const [stake, setStake] = useState('');
  const [opponent, setOpponent] = useState('');
  const [code, setCode] = useState('');
  const [mine, setMine] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Host: wait for the opponent to accept, then go to the match.
  useEffect(() => {
    if (!mine) return;
    const timer = setInterval(async () => {
      const latest = await api.challenges.get(mine.code).catch(() => null);
      if (latest?.status === 'accepted' && latest.gameSessionId) {
        clearInterval(timer);
        router.replace(`/match/${latest.gameSessionId}`);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [mine, api, router]);

  async function create() {
    setError(null);
    try {
      const stakeAmount = stake.trim() ? toStroops(stake.trim()) : undefined;
      setMine(await api.challenges.create(stakeAmount, opponent.trim() || undefined));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (mine) {
    const link = Linking.createURL(`challenge/${mine.code}`);
    return (
      <Screen>
        <Title>Code {mine.code}</Title>
        <Body muted>Waiting for your opponent to accept…</Body>
        <Button label="Share invite" onPress={() => void Share.share({ message: `Play me on LyricsFlip: ${link}` })} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Head-to-head</Title>
      <Body muted>Stakes use a free testnet token. Leave the stake empty for a friendly match.</Body>
      <TextInput
        style={styles.input}
        placeholder="Stake (test tokens), optional"
        placeholderTextColor={colors.muted}
        keyboardType="decimal-pad"
        value={stake}
        onChangeText={setStake}
      />
      <TextInput
        style={styles.input}
        placeholder="Opponent username, optional"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        value={opponent}
        onChangeText={setOpponent}
      />
      <Button label="Create challenge" onPress={create} />
      <TextInput
        style={styles.input}
        placeholder="Have a code?"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
      />
      <Button
        label="Open challenge"
        variant="secondary"
        disabled={!code.trim()}
        onPress={() => router.push(`/challenge/${code.trim().toUpperCase()}`)}
      />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
