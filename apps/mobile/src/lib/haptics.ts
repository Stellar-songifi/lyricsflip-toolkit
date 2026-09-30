import * as Haptics from 'expo-haptics';
import type { GuessOutcome } from './api';

/** A success buzz on a correct guess, a light tap on a partial one. */
export function hapticForOutcome(outcome: GuessOutcome): void {
  if (outcome === 'correct') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } else if (outcome === 'partial') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}
