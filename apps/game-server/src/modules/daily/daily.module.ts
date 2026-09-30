import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyChallenge } from './entities/daily-challenge.entity';
import { DailyAttempt } from './entities/daily-attempt.entity';
import { Lyric } from '../lyrics/entities/lyric.entity';
import { LyricsModule } from '../lyrics/lyrics.module';
import { UsersModule } from '../users/users.module';
import { DailyService } from './daily.service';
import { DailyController } from './daily.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DailyChallenge, DailyAttempt, Lyric]), LyricsModule, UsersModule],
  controllers: [DailyController],
  providers: [DailyService],
})
export class DailyModule {}
