import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, styles } from './ui';
import { colors, spacing } from '../lib/theme';

/** A song title or artist guess. Clears itself after each submit. */
export function GuessForm({ onGuess, disabled }: { onGuess: (guess: string) => Promise<void>; disabled?: boolean }) {
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = guess.trim();
    if (!text) return;
    setBusy(true);
    try {
      await onGuess(text);
      setGuess('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput
        style={styles.input}
        placeholder="Song title or artist"
        placeholderTextColor={colors.muted}
        value={guess}
        onChangeText={setGuess}
        onSubmitEditing={submit}
        editable={!disabled && !busy}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        accessibilityLabel="Your guess"
      />
      <Button label="Guess" onPress={submit} busy={busy} disabled={disabled || !guess.trim()} />
    </View>
  );
}
