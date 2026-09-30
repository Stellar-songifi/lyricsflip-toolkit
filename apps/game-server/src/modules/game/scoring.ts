import { Difficulty } from '../lyrics/entities/lyric.entity';

export enum GuessOutcome {
  CORRECT = 'correct',
  PARTIAL = 'partial',
  MISS = 'miss',
}

export const BASE_POINTS = {
  [GuessOutcome.CORRECT]: 100,
  [GuessOutcome.PARTIAL]: 50,
  [GuessOutcome.MISS]: 0,
};

export const STREAK_BONUS = 25;

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  [Difficulty.EASY]: 1,
  [Difficulty.MEDIUM]: 1.5,
  [Difficulty.HARD]: 2,
};

/** A near-miss threshold: distance <= 20% of the target's length counts as partial. */
const PARTIAL_MATCH_RATIO = 0.2;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic edit distance — small strings only (song titles / artist names). */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[rows - 1][cols - 1];
}

export function classifyGuess(guess: string, target: string): GuessOutcome {
  const normalizedGuess = normalize(guess);
  const normalizedTarget = normalize(target);

  if (!normalizedGuess) {
    return GuessOutcome.MISS;
  }
  if (normalizedGuess === normalizedTarget) {
    return GuessOutcome.CORRECT;
  }

  const distance = levenshtein(normalizedGuess, normalizedTarget);
  const allowedDistance = Math.ceil(normalizedTarget.length * PARTIAL_MATCH_RATIO);

  if (distance <= allowedDistance) {
    return GuessOutcome.PARTIAL;
  }
  return GuessOutcome.MISS;
}

export interface ScoreResult {
  outcome: GuessOutcome;
  points: number;
}

export function scoreGuess(
  guess: string,
  target: string,
  difficulty: Difficulty,
  currentStreak: number,
): ScoreResult {
  const outcome = classifyGuess(guess, target);
  const base = BASE_POINTS[outcome];
  const streakBonus = outcome === GuessOutcome.CORRECT && currentStreak > 0 ? STREAK_BONUS : 0;
  const points = Math.round((base + streakBonus) * DIFFICULTY_MULTIPLIER[difficulty]);

  return { outcome, points };
}
