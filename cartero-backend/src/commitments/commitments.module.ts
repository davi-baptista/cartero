import { Module } from '@nestjs/common';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';

@Module({
  providers: [CommitmentsService],
  controllers: [CommitmentsController],
})
export class CommitmentsModule {}
