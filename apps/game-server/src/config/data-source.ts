import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Lyric } from '../modules/lyrics/entities/lyric.entity';
import { GameSession } from '../modules/game/entities/game-session.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { Challenge } from '../modules/challenges/entities/challenge.entity';
import { PushToken } from '../modules/push/push-token.entity';
import { DailyChallenge } from '../modules/daily/entities/daily-challenge.entity';
import { DailyAttempt } from '../modules/daily/entities/daily-attempt.entity';
import { PVP_ENTITIES, PVP_MIGRATIONS } from '@lyricsflip-toolkit/server';
import { databaseConnectionOptions } from './database-options';

dotenv.config();

const database = databaseConnectionOptions();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: database.host,
  port: database.port,
  username: database.username,
  password: database.password,
  database: database.database,
  entities: [
    User,
    Lyric,
    GameSession,
    Notification,
    Challenge,
    PushToken,
    DailyChallenge,
    DailyAttempt,
    ...PVP_ENTITIES,
  ],
  // The game's own migrations, then the toolkit's (wagers, wallet links, mock pots).
  migrations: [__dirname + '/../database/migrations/*.{ts,js}', ...PVP_MIGRATIONS],
  synchronize: false,
});

// Default export so the TypeORM CLI (`typeorm-ts-node-commonjs -d src/config/data-source.ts`)
// can load this file directly for `migration:run`, `migration:generate`, and `schema:log`.
// This is what the CI drift check relies on: run all migrations against a fresh database,
// then run `schema:log` and fail if it proposes any further changes.
export default AppDataSource;
</｜｜DSML｜｜ parameter>