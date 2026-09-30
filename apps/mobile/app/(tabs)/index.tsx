import { useRouter } from 'expo-router';
import { Body, Button, Screen, Title } from '../../src/components/ui';
import { useSession } from '../../src/lib/session';

export default function Home() {
  const router = useRouter();
  const { user } = useSession();
  return (
    <Screen>
      <Title>Hi, {user?.username ?? 'player'}</Title>
      <Body muted>
        {user?.level} · {user?.xp ?? 0} XP
      </Body>
      <Button label="Solo" onPress={() => router.push('/solo')} />
      <Button label="Rooms" onPress={() => router.push('/rooms')} />
      <Button label="Head-to-head" onPress={() => router.push('/head-to-head')} />
      <Button label="Daily challenge" variant="secondary" onPress={() => router.push('/daily')} />
    </Screen>
  );
}
