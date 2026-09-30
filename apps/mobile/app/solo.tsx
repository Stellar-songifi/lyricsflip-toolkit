import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Body, Button, ErrorText, Screen, Title } from '../src/components/ui';
import { useSession } from '../src/lib/session';

export default function Solo() {
  const { api } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    try {
      const session = await api.game.create('solo');
      router.replace(`/play/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Solo</Title>
      <Body muted>Ten lyrics. Name the song or the artist. Streaks earn bonus points.</Body>
      <Button label="Start" onPress={start} busy={busy} />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
