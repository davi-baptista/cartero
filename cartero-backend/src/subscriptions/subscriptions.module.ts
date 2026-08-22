import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { CommonModule } from 'src/common/common.module';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';

@Module({
  imports: [CommonModule],
  // O guard só depende do ConfigService (global), então declará-lo aqui basta.
  providers: [SubscriptionsService, CronSecretGuard],
  exports: [SubscriptionsService],
  controllers: [SubscriptionsController],
})
export class SubscriptionsModule {}
