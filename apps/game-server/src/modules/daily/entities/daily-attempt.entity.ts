import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** A player's one attempt at one lyric of a day's challenge. */
@Entity('daily_attempts')
@Unique('UQ_daily_attempt_user_day_lyric', ['userId', 'challengeDate', 'lyricId'])
@Index('IDX_daily_attempt_day', ['challengeDate'])
export class DailyAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'date' })
  challengeDate: string;

  @Column({ type: 'uuid' })
  lyricId: string;

  @Column({ type: 'varchar', length: 16 })
  outcome: string;

  @Column({ type: 'int' })
  points: number;

  @CreateDateColumn()
  createdAt: Date;
}
