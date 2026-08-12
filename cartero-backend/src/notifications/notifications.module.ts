import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { CronSecretGuard } from './cron-secret.guard';

@Module({
  providers: [NotificationsService, CronSecretGuard],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
