import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Lyric } from '../modules/lyrics/entities/lyric.entity';
import { GameSession } from '../modules/game/entities/game-session.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { Challenge } from '../modules/challenges/entities/challenge.entity';
import { PushToken } from '../modules/push/push-token.entity';
import { PVP_ENTITIES, PVP_MIGRATIONS } from '@lyricsflip-toolkit/server';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lyricflip',
  entities: [User, Lyric, GameSession, Notification, Challenge, PushToken, ...PVP_ENTITIES],
  // The game's own migrations, then the toolkit's (wagers, wallet links, mock pots).
  migrations: [__dirname + '/../database/migrations/*.{ts,js}', ...PVP_MIGRATIONS],
  synchronize: false,
});
