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
   * Lyric ids this session has already presented. Persisted so a restart can
   * never re-show a lyric within the same session (issue #2).
   */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  seenLyricIds: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
