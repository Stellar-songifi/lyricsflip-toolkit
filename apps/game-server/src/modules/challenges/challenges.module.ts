import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './entities/challenge.entity';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { GameModule } from '../game/game.module';

@Module({
  imports: [TypeOrmModule.forFeature([Challenge]), GameModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
