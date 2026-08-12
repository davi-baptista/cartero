import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';
import { CronSecretGuard } from './cron-secret.guard';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private configService: ConfigService,
  ) {}

  @Get('public-key')
  getPublicKey() {
    return { publicKey: this.configService.get<string>('VAPID_PUBLIC_KEY') };
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  subscribe(@CurrentUser() user: User, @Body() dto: SubscribeDto) {
    return this.notificationsService.subscribe(user.id, dto);
  }

  @Delete('subscribe')
  @UseGuards(JwtAuthGuard)
  unsubscribe(@CurrentUser() user: User, @Body() dto: UnsubscribeDto) {
    return this.notificationsService.unsubscribe(user.id, dto);
  }

  @Post('run')
  @UseGuards(CronSecretGuard)
  run() {
    return this.notificationsService.runDueDateCheck();
  }
}
