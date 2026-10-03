import { Module } from '@nestjs/common';
import { ObligationsController } from './obligations.controller';
import { ObligationsService } from './obligations.service';

@Module({
  controllers: [ObligationsController],
  providers: [ObligationsService],
})
export class ObligationsModule {}
