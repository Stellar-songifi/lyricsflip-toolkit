import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wager } from './entities/wager.entity';
import { WagerService } from './wager.service';
import { WagerController } from './wager.controller';
import { UsersModule } from '../users/users.module';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [TypeOrmModule.forFeature([Wager]), UsersModule, StellarModule],
  controllers: [WagerController],
  providers: [WagerService],
  exports: [WagerService],
})
export class WagerModule {}
