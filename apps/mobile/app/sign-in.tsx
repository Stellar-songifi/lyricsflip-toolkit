import { useState } from 'react';
import { Body, Button, ErrorText, Screen, Title } from '../src/components/ui';
import { useSession } from '../src/lib/session';

export default function SignIn() {
  const { signIn, wallet } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPress() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Title>LyricsFlip</Title>
      <Body muted>Guess the song from the lyric. Play solo, in rooms, or head-to-head.</Body>
      <Body muted>
        Your wallet lives on this phone and works on the Stellar testnet only. Stakes use a free test token.
      </Body>
      {wallet ? <Body muted>Wallet {wallet.publicKey().slice(0, 8)}…</Body> : null}
      <Button label="Sign in with your wallet" onPress={onPress} busy={busy} />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
