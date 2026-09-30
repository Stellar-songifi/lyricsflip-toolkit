/**
 * Deterministic daily picks. Ported from Stellar-songifi/Lyricsflip_server
 * `src/challenges/daily-seed.util.ts`, for string (UUID) lyric ids.
 */

/** 32-bit FNV-1a hash of a string, used to turn a date into a PRNG seed. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks `count` distinct ids, always the same ones for the same seed and
 * pool. The pool is sorted first so the caller's ordering can't matter.
 */
export function pickDeterministic(ids: string[], count: number, seed: string): string[] {
  const pool = [...ids].sort();
  const random = seededRandom(hashSeed(seed));
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/** The current UTC day as `YYYY-MM-DD`. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
