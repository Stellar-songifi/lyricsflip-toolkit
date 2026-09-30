import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration, { AppConfig } from './config/configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LyricsModule } from './modules/lyrics/lyrics.module';
import { GameModule } from './modules/game/game.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { DailyModule } from './modules/daily/daily.module';
import { PushModule } from './modules/push/push.module';
import { PVP_ENTITIES } from '@lyricsflip-toolkit/server';
import { User } from './modules/users/entities/user.entity';
import { Lyric } from './modules/lyrics/entities/lyric.entity';
import { GameSession } from './modules/game/entities/game-session.entity';
import { Notification } from './modules/notifications/entities/notification.entity';
import { Challenge } from './modules/challenges/entities/challenge.entity';
import { PushToken } from './modules/push/push-token.entity';
import { DailyChallenge } from './modules/daily/entities/daily-challenge.entity';
import { DailyAttempt } from './modules/daily/entities/daily-attempt.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const db = configService.get('database', { infer: true });
        return {
          type: 'postgres' as const,
          host: db.primary.host,
          port: db.primary.port,
          username: db.primary.username,
          password: db.primary.password,
          database: db.primary.name,
          entities: [User, Lyric, GameSession, Notification, Challenge, PushToken, DailyChallenge, DailyAttempt, ...PVP_ENTITIES],
          synchronize: false,
          replication: db.replica
            ? {
                master: {
                  host: db.primary.host,
                  port: db.primary.port,
                  username: db.primary.username,
                  password: db.primary.password,
                  database: db.primary.name,
                },
                slaves: [
                  {
                    host: db.replica.host,
                    port: db.replica.port,
                    username: db.replica.username,
                    password: db.replica.password,
                    database: db.replica.name,
                  },
                ],
              }
            : undefined,
        };
      },
    }),
    AuthModule,
    UsersModule,
    LyricsModule,
    GameModule,
    SettlementModule,
    DailyModule,
    PushModule,
    NotificationsModule,
    ChallengesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
