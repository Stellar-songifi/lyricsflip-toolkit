import { BadRequestException, Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';
import { PushService } from './push.service';

class RegisterPushTokenDto {
  @IsString()
  @MaxLength(255)
  token: string;

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

@ApiTags('push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push-tokens')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  async register(@CurrentUserId() userId: string, @Body() dto: RegisterPushTokenDto) {
    if (!PushService.isExpoToken(dto.token)) {
      throw new BadRequestException('Expected an Expo push token');
    }
    const saved = await this.push.register(userId, dto.token, dto.platform);
    return { token: saved.token, platform: saved.platform };
  }

  @Delete(':token')
  @HttpCode(204)
  async unregister(@CurrentUserId() userId: string, @Param('token') token: string) {
    await this.push.unregister(userId, token);
  }
}
