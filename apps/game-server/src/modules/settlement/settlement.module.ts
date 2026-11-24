import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { PvpSettlementModule } from '@lyricsflip-toolkit/server';
import { AuthModule } from '../auth/auth.module';
import { GameModule } from '../game/game.module';
import { SettlementListener } from './settlement.listener';
import { settlementOptions } from './settlement.options';
import { SettlementSweeperService } from './settlement-sweeper.service';

@Module({
  imports: [
    PvpSettlementModule.forRootAsync({
      imports: [AuthModule],
      inject: [ConfigService, JwtService, EventEmitter2],
      useFactory: settlementOptions,
    }),
    GameModule,
  ],
  providers: [SettlementListener, SettlementSweeperService],
  exports: [SettlementSweeperService],
})
export class SettlementModule {}
