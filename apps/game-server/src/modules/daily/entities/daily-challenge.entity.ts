import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** The lyrics chosen for one UTC day, fixed once chosen. */
@Entity('daily_challenges')
export class DailyChallenge {
  /** UTC day, `YYYY-MM-DD`. */
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ type: 'uuid', array: true })
  lyricIds: string[];

  @CreateDateColumn()
  createdAt: Date;
}
