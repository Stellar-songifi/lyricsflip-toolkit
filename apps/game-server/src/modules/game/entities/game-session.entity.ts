import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum GameMode {
  SOLO = 'solo',
  ROOM = 'room',
  HEAD_TO_HEAD = 'head_to_head',
}

export enum GameSessionStatus {
  /** Created, but not playable yet (a staked match waits for both stakes). */
  WAITING = 'waiting',
  ACTIVE = 'active',
  FINISHED = 'finished',
  /** Never played: the stakes weren't made, or the match was abandoned. */
  CANCELLED = 'cancelled',
}

/**
 * A single player's answer for one round. `outcome` mirrors the guess result
 * (`correct` / `wrong` / `timeout`); `points` is what the answer scored.
 */
export interface RoundAnswer {
  outcome: string;
  points: number;
}

/**
 * A game session. Rounds live only in Postgres — there is no on-chain copy
 * of game state; the chain only holds stakes (see `contracts/pvp-escrow`).
 */
@Entity('game_sessions')
export class GameSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: GameMode })
  mode: GameMode;

  @Column({ type: 'enum', enum: GameSessionStatus, default: GameSessionStatus.WAITING })
  status: GameSessionStatus;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  playerIds: string[];

  @Column({ type: 'uuid', nullable: true })
  currentLyricId: string | null;

  @Column({ default: 0 })
  currentRound: number;

  /**
   * Rounds this session runs for before it finishes. Fixed at creation: the
   * configured `ROUNDS_PER_SESSION`, or a caller's per-session override. Stored
   * rather than read from config so a mid-flight config change can't move the
   * finishing line of a session already in progress.
   */
  @Column({ default: 10 })
  totalRounds: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  scores: Record<string, number>;

  /**
   * Per-player consecutive-correct-answer count, keyed by userId. Reset to 0
   * on a miss. Persisted so a restart mid-session keeps the streak that feeds
   * `STREAK_BONUS` (issue #2).
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  currentStreak: Record<string, number>;

  /**
   * Per-player answer state, keyed by round then userId. Lets a head-to-head
   * (or room) round advance only once every player has answered, and lets a
   * second guess by the same player in the same round be rejected (issue #26).
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  roundAnswers: Record<string, Record<string, RoundAnswer>>;

  /**
   * Lyric ids this session has already presented. Persisted so a restart can
   * never re-show a lyric within the same session (issue #2).
   */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  seenLyricIds: string[];

  /**
   * When the current round's card was first shown. Used with `roundSeconds` to
   * compute the deadline. `null` before the first card is dealt and after the
   * session finishes.
   */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  roundStartedAt: Date | null;

  /**
   * Per-round time budget in seconds. Fixed at session creation from
   * `ROUND_SECONDS`, or a per-session override. Stored so a config change
   * can't silently shift the deadline of a session already in progress.
   */
  @Column({ default: 20 })
  roundSeconds: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
