import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum PlayerLevel {
  GOSSIP_ROOKIE = 'Gossip Rookie',
  GOSSIP_REGULAR = 'Gossip Regular',
  GOSSIP_INSIDER = 'Gossip Insider',
  GOSSIP_VIRTUOSO = 'Gossip Virtuoso',
  GOSSIP_GURU = 'Gossip Guru',
}

/** XP thresholds a player must reach to hold each level. */
export const LEVEL_THRESHOLDS: { level: PlayerLevel; minXp: number }[] = [
  { level: PlayerLevel.GOSSIP_ROOKIE, minXp: 0 },
  { level: PlayerLevel.GOSSIP_REGULAR, minXp: 500 },
  { level: PlayerLevel.GOSSIP_INSIDER, minXp: 1500 },
  { level: PlayerLevel.GOSSIP_VIRTUOSO, minXp: 3500 },
  { level: PlayerLevel.GOSSIP_GURU, minXp: 7500 },
];

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  walletAddress: string | null;

  @Index({ unique: true })
  @Column()
  username: string;

  @Column({ default: 0 })
  xp: number;

  @Column({ default: 0 })
  score: number;

  @Column({ default: 0 })
  correctGuesses: number;

  @Column({ default: 0 })
  gamesPlayed: number;

  @Column({ type: 'enum', enum: PlayerLevel, default: PlayerLevel.GOSSIP_ROOKIE })
  level: PlayerLevel;

  @Column({ type: 'timestamp', nullable: true })
  walletVerifiedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
