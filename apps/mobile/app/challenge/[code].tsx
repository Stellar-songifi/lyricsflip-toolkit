import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fromStroops } from '@lyricsflip-toolkit/sdk';
import { Body, Button, ErrorText, Screen, Title } from '../../src/components/ui';
import type { Challenge } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';

/** Where an invite link lands: shows the stake before the player agrees to it. */
export default function ChallengeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { api, user } = useSession();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.challenges.get(code).then(setChallenge, (err: Error) => setError(err.message));
  }, [api, code]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { gameSessionId } = await api.challenges.accept(code);
      router.replace(`/match/${gameSessionId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const own = challenge && user && challenge.hostUserId === user.id;
  return (
    <Screen>
      <Title>Challenge {code}</Title>
      {challenge ? (
        <>
          <Body>
            {challenge.stakeAmount
              ? `Stake: ${fromStroops(challenge.stakeAmount)} test tokens each. Winner takes both.`
              : 'A friendly match, no stake.'}
          </Body>
          {challenge.status !== 'pending' ? (
            <Body muted>This challenge is {challenge.status}.</Body>
          ) : own ? (
            <Body muted>This is your challenge. Share the code with your opponent.</Body>
          ) : (
            <Button label={challenge.stakeAmount ? 'Accept the stake and play' : 'Accept and play'} onPress={accept} busy={busy} />
          )}
        </>
      ) : (
        <Body muted>Loading…</Body>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
