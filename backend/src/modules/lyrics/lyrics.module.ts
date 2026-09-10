import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lyric } from './entities/lyric.entity';
import { LyricsService } from './lyrics.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lyric])],
  providers: [LyricsService],
  exports: [LyricsService],
})
export class LyricsModule {}
