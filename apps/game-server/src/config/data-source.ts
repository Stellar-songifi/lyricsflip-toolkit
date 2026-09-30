import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Lyric } from '../modules/lyrics/entities/lyric.entity';
import { GameSession } from '../modules/game/entities/game-session.entity';
import { Wager } from '../modules/wager/entities/wager.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { Challenge } from '../modules/challenges/entities/challenge.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lyricflip',
  entities: [User, Lyric, GameSession, Wager, Notification, Challenge],
  migrations: [__dirname + '/../database/migrations/*.{ts,js}'],
  synchronize: false,
});
