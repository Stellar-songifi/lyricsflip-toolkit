import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

@Entity('lyrics')
export class Lyric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  snippet: string;

  @Column()
  artist: string;

  @Column()
  title: string;

  @Column()
  genre: string;

  @Column()
  decade: number;

  @Column({ type: 'enum', enum: Difficulty, default: Difficulty.MEDIUM })
  difficulty: Difficulty;

  @CreateDateColumn()
  createdAt: Date;
}
