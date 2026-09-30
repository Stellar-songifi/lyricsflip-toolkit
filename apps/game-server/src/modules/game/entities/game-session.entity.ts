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
  WAITING = 'waiting',
  ACTIVE = 'active',
  FINISHED = 'finished',
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

  @Column({ type: 'jsonb', default: () => "'{}'" })
  scores: Record<string, number>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
