import { AccessibilityInfo } from 'react-native';
import type { GuessOutcome } from './api';

const OUTCOME_TEXT: Record<GuessOutcome, string> = {
  correct: 'Correct',
  partial: 'Partial match',
  miss: 'Miss',
};

/** Screen-reader feedback for a scored guess, alongside the existing haptic. */
export function announceGuessResult(outcome: GuessOutcome, points = 0, streak = 0): void {
  const detail = outcome === 'miss' ? 'No points' : `+${points} points`;
  const streakText = outcome === 'correct' && streak > 1 ? ` Streak ${streak}.` : '';
  AccessibilityInfo.announceForAccessibility(`${OUTCOME_TEXT[outcome]}. ${detail}.${streakText}`);
}

/** Screen-reader feedback when a shared session's scores change. */
export function announceScoreUpdate(scores: Record<string, number>, myId?: string): void {
  const mine = myId ? (scores[myId] ?? 0) : 0;
  const theirs = Object.entries(scores)
    .filter(([id]) => id !== myId)
    .map(([, value]) => value)[0] ?? 0;
  AccessibilityInfo.announceForAccessibility(myId ? `Score update: you ${mine}, opponent ${theirs}.` : `Score update: ${mine} points.`);
}
