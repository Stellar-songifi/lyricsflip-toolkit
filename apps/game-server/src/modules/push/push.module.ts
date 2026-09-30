import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/configuration';
import { ExpoPushTransport, PushTransport, RecordingPushTransport } from './expo-push.client';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushToken } from './push-token.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PushToken])],
  controllers: [PushController],
  providers: [
    PushService,
    {
      provide: PushTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const push = config.get('push', { infer: true });
        return push.enabled ? new ExpoPushTransport(push.accessToken || undefined) : new RecordingPushTransport();
      },
    },
  ],
  exports: [PushService, PushTransport],
})
export class PushModule {}
