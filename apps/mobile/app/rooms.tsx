import { useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Button, ErrorText, Screen, Title, styles } from '../src/components/ui';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

export default function Rooms() {
  const { api } = useSession();
  const router = useRouter();
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    try {
      const session = await api.game.create('room');
      router.push(`/play/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function join() {
    try {
      const session = await api.game.join(roomId.trim());
      router.push(`/play/${session.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Screen>
      <Title>Rooms</Title>
      <Body muted>Everyone plays the same lyrics. Share the room id so friends can join.</Body>
      <Button label="Create a room" onPress={create} />
      <TextInput
        style={styles.input}
        placeholder="Room id"
        placeholderTextColor={colors.muted}
        value={roomId}
        onChangeText={setRoomId}
        autoCapitalize="none"
      />
      <Button label="Join" variant="secondary" onPress={join} disabled={!roomId.trim()} />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
