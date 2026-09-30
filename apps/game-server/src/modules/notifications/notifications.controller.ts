import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(@CurrentUserId() userId: string) {
    return this.notificationsService.findForUser(userId);
  }

  @Post(':id/read')
  async markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUserId() userId: string) {
    await this.notificationsService.markRead(id, userId);
    return { id, read: true };
  }
}
