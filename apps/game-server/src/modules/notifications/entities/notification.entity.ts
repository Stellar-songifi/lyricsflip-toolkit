import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  type: string;

  @Column()
  message: string;

  /** Extra payload for the app, e.g. `{ url: 'lyricsflip://challenge/ABC123' }`. */
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
