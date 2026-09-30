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
import { WagerModule } from './modules/wager/wager.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { User } from './modules/users/entities/user.entity';
import { Lyric } from './modules/lyrics/entities/lyric.entity';
import { GameSession } from './modules/game/entities/game-session.entity';
import { Wager } from './modules/wager/entities/wager.entity';
import { Notification } from './modules/notifications/entities/notification.entity';
import { Challenge } from './modules/challenges/entities/challenge.entity';

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
          entities: [User, Lyric, GameSession, Wager, Notification, Challenge],
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
    WagerModule,
    StellarModule,
    NotificationsModule,
    ChallengesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
