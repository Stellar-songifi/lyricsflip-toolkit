import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** An Expo push token for one of a user's devices. */
@Entity('push_tokens')
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** `ExponentPushToken[...]`. Unique: a device belongs to one signed-in user at a time. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  token: string;

  @Column({ type: 'varchar', length: 16 })
  platform: string;

  @CreateDateColumn()
  createdAt: Date;
}
