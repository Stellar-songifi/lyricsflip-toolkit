/** A finished head-to-head match: one winner, or a draw. */
export type HeadToHeadResult = { winnerId: string } | { draw: true };

/**
 * Decides a head-to-head match from the scores the server recorded. Only
 * the two session players count, and a player missing from `scores`
 * scored zero. Throws unless there are exactly two players.
 */
export function headToHeadResult(
  playerIds: string[],
  scores: Record<string, number>,
): HeadToHeadResult {
  if (playerIds.length !== 2) {
    throw new Error(`A head-to-head result needs two players, got ${playerIds.length}`);
  }
  const [a, b] = playerIds;
  const scoreA = scores[a] ?? 0;
  const scoreB = scores[b] ?? 0;
  if (scoreA === scoreB) return { draw: true };
  return { winnerId: scoreA > scoreB ? a : b };
}
