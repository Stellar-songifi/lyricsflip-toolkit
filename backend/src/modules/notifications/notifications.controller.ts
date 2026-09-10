import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('user/:userId')
  findForUser(@Param('userId') userId: string) {
    return this.notificationsService.findForUser(userId);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    this.notificationsService.markRead(id);
    return { id, read: true };
  }
}
